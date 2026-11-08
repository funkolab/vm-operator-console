import http2, { type ClientHttp2Session, type IncomingHttpHeaders, type OutgoingHttpHeaders } from "node:http2";
import type { ClusterConnection } from "./kubeconfig";

export interface RawRequest {
  method: string;
  path: string;
  headers?: Record<string, string | string[]>;
  body?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface RawResponse {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
}

export interface StreamHandle {
  status: Promise<number>;
  /** Resolves when the stream ends; rejects on transport error. */
  done: Promise<void>;
  close(): void;
}

/**
 * HTTP/2 transport to the kube-apiserver. node:http2 is used because Bun's
 * fetch cannot send client certificates from a kubeconfig and folds repeated
 * headers, while multiple Impersonate-Group headers must be sent as distinct
 * header fields. A single multiplexed session serves all requests.
 */
export class Transport {
  private session?: ClientHttp2Session;
  private connecting?: Promise<ClientHttp2Session>;

  constructor(private readonly conn: ClusterConnection) {}

  get server() {
    return this.conn.server;
  }

  private getSession(): Promise<ClientHttp2Session> {
    if (this.session && !this.session.closed && !this.session.destroyed) return Promise.resolve(this.session);
    if (this.connecting) return this.connecting;
    this.connecting = new Promise<ClientHttp2Session>((resolve, reject) => {
      const s = http2.connect(this.conn.server, {
        ca: this.conn.ca,
        cert: this.conn.cert,
        key: this.conn.key,
        rejectUnauthorized: !this.conn.insecureSkipTLSVerify,
      });
      const onError = (err: Error) => {
        this.connecting = undefined;
        reject(err);
      };
      s.once("error", onError);
      s.once("connect", () => {
        s.off("error", onError);
        s.on("error", () => {
          if (this.session === s) this.session = undefined;
        });
        s.on("close", () => {
          if (this.session === s) this.session = undefined;
        });
        s.on("goaway", () => {
          if (this.session === s) this.session = undefined;
        });
        s.setTimeout(0);
        this.session = s;
        this.connecting = undefined;
        resolve(s);
      });
    });
    return this.connecting;
  }

  private async authHeaders(): Promise<OutgoingHttpHeaders> {
    const h: OutgoingHttpHeaders = {};
    const token = await this.conn.token?.();
    if (token) h.authorization = `Bearer ${token}`;
    else if (this.conn.basic) h.authorization = `Basic ${Buffer.from(`${this.conn.basic.username}:${this.conn.basic.password}`).toString("base64")}`;
    return h;
  }

  private async open(req: RawRequest) {
    const session = await this.getSession();
    const headers: OutgoingHttpHeaders = {
      ":method": req.method,
      ":path": req.path,
      accept: "application/json",
      ...(await this.authHeaders()),
    };
    for (const [k, v] of Object.entries(req.headers ?? {})) headers[k.toLowerCase()] = v;
    if (req.body !== undefined) headers["content-length"] = Buffer.byteLength(req.body);
    return session.request(headers, { endStream: req.body === undefined });
  }

  async request(req: RawRequest, retry = true): Promise<RawResponse> {
    let stream: Awaited<ReturnType<Transport["open"]>>;
    try {
      stream = await this.open(req);
    } catch (e) {
      if (retry) {
        this.session = undefined;
        return this.request(req, false);
      }
      throw e;
    }
    return new Promise<RawResponse>((resolve, reject) => {
      let status = 0;
      let headers: IncomingHttpHeaders = {};
      const chunks: Buffer[] = [];
      const timer = setTimeout(() => {
        stream.close(http2.constants.NGHTTP2_CANCEL);
        reject(new Error(`Kubernetes API request timed out: ${req.method} ${req.path}`));
      }, req.timeoutMs ?? 30_000);
      const abort = () => {
        clearTimeout(timer);
        stream.close(http2.constants.NGHTTP2_CANCEL);
        reject(new DOMException("Aborted", "AbortError"));
      };
      req.signal?.addEventListener("abort", abort, { once: true });
      stream.on("response", (h) => {
        status = Number(h[":status"]);
        headers = h;
      });
      stream.on("data", (c: Buffer) => chunks.push(c));
      stream.on("end", () => {
        clearTimeout(timer);
        req.signal?.removeEventListener("abort", abort);
        resolve({ status, headers, body: Buffer.concat(chunks).toString("utf8") });
      });
      stream.on("error", (err) => {
        clearTimeout(timer);
        req.signal?.removeEventListener("abort", abort);
        reject(err);
      });
      if (req.body !== undefined) stream.end(req.body);
    });
  }

  /** Opens a long-lived streaming request (watch), emitting newline-delimited lines. */
  async stream(req: RawRequest, onLine: (line: string) => void): Promise<StreamHandle> {
    const stream = await this.open(req);
    let buf = "";
    let resolveStatus!: (n: number) => void;
    const status = new Promise<number>((r) => {
      resolveStatus = r;
    });
    const done = new Promise<void>((resolve, reject) => {
      stream.on("response", (h) => resolveStatus(Number(h[":status"])));
      stream.setEncoding("utf8");
      stream.on("data", (chunk: string) => {
        buf += chunk;
        let idx = buf.indexOf("\n");
        while (idx >= 0) {
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          if (line) onLine(line);
          idx = buf.indexOf("\n");
        }
      });
      stream.on("end", () => {
        if (buf.trim()) onLine(buf.trim());
        resolve();
      });
      stream.on("close", () => resolve());
      stream.on("error", (e) => {
        resolveStatus(0);
        reject(e);
      });
    });
    return {
      status,
      done,
      close: () => {
        if (!stream.closed) stream.close(http2.constants.NGHTTP2_CANCEL);
      },
    };
  }

  close() {
    this.session?.close();
    this.session = undefined;
  }
}
