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

export interface TransportOptions {
  /** Interval between liveness pings on each session. */
  pingIntervalMs?: number;
  /** A session whose ping is not answered within this delay is dropped. */
  pingTimeoutMs?: number;
  /** Extra sessions left without streams are closed after this delay. */
  idleCloseMs?: number;
}

interface Slot {
  session: ClientHttp2Session;
  /** Streams opened on the session and not yet closed. */
  active: number;
  /** Streams the server accepts concurrently (SETTINGS_MAX_CONCURRENT_STREAMS). */
  max: number;
  /** No new streams: the session is closing, received a GOAWAY or failed a ping. */
  draining: boolean;
  pinger: ReturnType<typeof setInterval>;
  idleTimer?: ReturnType<typeof setTimeout>;
}

/** kube-apiserver accepts 100 concurrent streams per connection by default. */
const DEFAULT_MAX_STREAMS = 100;

/**
 * HTTP/2 transport to the kube-apiserver. node:http2 is used because Bun's
 * fetch cannot send client certificates from a kubeconfig and folds repeated
 * headers, while multiple Impersonate-Group headers must be sent as distinct
 * header fields.
 *
 * Watches are long-lived streams, and the server caps the concurrent streams
 * of a connection: once a session is full, further requests would wait for a
 * free stream forever. Requests therefore go to a session with free capacity,
 * and a new session is opened when all are full. Sessions are pinged so that
 * a dead connection is replaced instead of stalling every request.
 */
export class Transport {
  private slots: Slot[] = [];
  private connecting?: Promise<void>;
  private readonly opts: Required<TransportOptions>;

  constructor(
    private readonly conn: ClusterConnection,
    opts: TransportOptions = {},
  ) {
    this.opts = { pingIntervalMs: 30_000, pingTimeoutMs: 10_000, idleCloseMs: 60_000, ...opts };
  }

  get server() {
    return this.conn.server;
  }

  /** Number of open sessions (for tests and diagnostics). */
  get sessionCount() {
    return this.slots.length;
  }

  private usable(slot: Slot) {
    return !slot.draining && !slot.session.closed && !slot.session.destroyed;
  }

  /** Reserves a stream on a session with free capacity, opening a session when all are full. */
  private async acquire(): Promise<Slot> {
    for (;;) {
      const slot = this.slots.find((s) => this.usable(s) && s.active < s.max);
      if (slot) {
        if (slot.idleTimer) clearTimeout(slot.idleTimer);
        slot.idleTimer = undefined;
        slot.active++;
        return slot;
      }
      this.connecting ??= this.connect().finally(() => {
        this.connecting = undefined;
      });
      await this.connecting;
    }
  }

  private release(slot: Slot) {
    slot.active = Math.max(0, slot.active - 1);
    if (slot.active > 0) return;
    if (slot.draining) return this.drop(slot);
    // Keep the first session for reuse; close extra ones once they stay empty.
    if (this.slots[0] !== slot && !slot.idleTimer) {
      slot.idleTimer = setTimeout(() => {
        if (slot.active === 0) this.drop(slot);
      }, this.opts.idleCloseMs);
      slot.idleTimer.unref?.();
    }
  }

  private drop(slot: Slot, destroy = false) {
    slot.draining = true;
    clearInterval(slot.pinger);
    if (slot.idleTimer) clearTimeout(slot.idleTimer);
    this.slots = this.slots.filter((s) => s !== slot);
    if (destroy) slot.session.destroy();
    else if (!slot.session.closed) slot.session.close();
  }

  private connect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const session = http2.connect(this.conn.server, {
        ca: this.conn.ca,
        cert: this.conn.cert,
        key: this.conn.key,
        rejectUnauthorized: !this.conn.insecureSkipTLSVerify,
      });
      const slot: Slot = {
        session,
        active: 0,
        max: DEFAULT_MAX_STREAMS,
        draining: false,
        pinger: setInterval(() => this.ping(slot), this.opts.pingIntervalMs),
      };
      slot.pinger.unref?.();
      let ready = false;
      const onError = (err: Error) => {
        clearInterval(slot.pinger);
        reject(err);
      };
      session.once("error", onError);
      // The server's first SETTINGS frame announces its stream limit.
      session.once("remoteSettings", (settings) => {
        if (ready) return;
        ready = true;
        const max = settings.maxConcurrentStreams;
        if (max && max < 2 ** 31) slot.max = Math.max(1, max);
        session.off("error", onError);
        session.on("error", () => this.drop(slot, true));
        session.on("close", () => this.drop(slot));
        session.on("goaway", () => {
          slot.draining = true;
          if (slot.active === 0) this.drop(slot);
        });
        session.setTimeout(0);
        this.slots.push(slot);
        resolve();
      });
    });
  }

  private ping(slot: Slot) {
    if (!this.usable(slot)) return;
    const timer = setTimeout(() => this.drop(slot, true), this.opts.pingTimeoutMs);
    timer.unref?.();
    try {
      slot.session.ping((err) => {
        clearTimeout(timer);
        if (err) this.drop(slot, true);
      });
    } catch {
      clearTimeout(timer);
      this.drop(slot, true);
    }
  }

  private async authHeaders(): Promise<OutgoingHttpHeaders> {
    const h: OutgoingHttpHeaders = {};
    const token = await this.conn.token?.();
    if (token) h.authorization = `Bearer ${token}`;
    else if (this.conn.basic) h.authorization = `Basic ${Buffer.from(`${this.conn.basic.username}:${this.conn.basic.password}`).toString("base64")}`;
    return h;
  }

  private async open(req: RawRequest, retry = true): Promise<{ stream: ReturnType<ClientHttp2Session["request"]>; slot: Slot }> {
    const headers: OutgoingHttpHeaders = {
      ":method": req.method,
      ":path": req.path,
      accept: "application/json",
      ...(await this.authHeaders()),
    };
    for (const [k, v] of Object.entries(req.headers ?? {})) headers[k.toLowerCase()] = v;
    if (req.body !== undefined) headers["content-length"] = Buffer.byteLength(req.body);
    const slot = await this.acquire();
    let stream: ReturnType<ClientHttp2Session["request"]>;
    try {
      stream = slot.session.request(headers, { endStream: req.body === undefined });
    } catch (e) {
      // The session closed between acquire and request: drop it and try another one.
      this.release(slot);
      this.drop(slot, true);
      if (retry) return this.open(req, false);
      throw e;
    }
    let released = false;
    stream.once("close", () => {
      if (released) return;
      released = true;
      this.release(slot);
    });
    return { stream, slot };
  }

  async request(req: RawRequest): Promise<RawResponse> {
    const { stream, slot } = await this.open(req);
    return new Promise<RawResponse>((resolve, reject) => {
      let status = 0;
      let headers: IncomingHttpHeaders = {};
      const chunks: Buffer[] = [];
      const timer = setTimeout(() => {
        stream.close(http2.constants.NGHTTP2_CANCEL);
        // A stalled request may mean a dead connection: check it now rather than at the next ping.
        this.ping(slot);
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
    const { stream } = await this.open(req);
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
    for (const slot of [...this.slots]) this.drop(slot);
  }
}
