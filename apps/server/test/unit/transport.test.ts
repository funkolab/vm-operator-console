import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import http2 from "node:http2";
import type { ClusterConnection } from "../../src/k8s/kubeconfig";
import { Transport } from "../../src/k8s/transport";

// Local h2c server that, like kube-apiserver, caps the concurrent streams per
// connection. Paths containing "watch" stay open, like Kubernetes watches.
let server: http2.Http2Server;
let url: string;

beforeAll(async () => {
  server = http2.createServer({ settings: { maxConcurrentStreams: 3 } });
  server.on("stream", (stream: http2.ServerHttp2Stream, headers) => {
    stream.respond({ ":status": 200, "content-type": "application/json" });
    if (String(headers[":path"]).includes("watch")) {
      stream.write('{"type":"ADDED"}\n');
      return;
    }
    stream.end('{"ok":true}');
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(() => server.close());

const conn = (): ClusterConnection => ({ mode: "kubeconfig", server: url });
const get = (t: Transport) => t.request({ method: "GET", path: "/api/v1/namespaces", timeoutMs: 2000 });

describe("Transport", () => {
  test("opens another connection when watches fill the server's stream limit", async () => {
    const t = new Transport(conn());
    try {
      const watches = await Promise.all(Array.from({ length: 5 }, () => t.stream({ method: "GET", path: "/watch" }, () => {})));
      const res = await get(t);
      expect(res.status).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ ok: true });
      expect(t.sessionCount).toBe(2);
      for (const w of watches) w.close();
    } finally {
      t.close();
    }
  });

  test("reuses one connection while it has free streams", async () => {
    const t = new Transport(conn());
    try {
      for (let i = 0; i < 10; i++) expect((await get(t)).status).toBe(200);
      expect(t.sessionCount).toBe(1);
    } finally {
      t.close();
    }
  });

  test("closes extra connections once their streams end", async () => {
    const t = new Transport(conn(), { idleCloseMs: 50 });
    try {
      const watches = await Promise.all(Array.from({ length: 4 }, () => t.stream({ method: "GET", path: "/watch" }, () => {})));
      expect(t.sessionCount).toBe(2);
      for (const w of watches) w.close();
      await Bun.sleep(300);
      expect(t.sessionCount).toBe(1);
      expect((await get(t)).status).toBe(200);
    } finally {
      t.close();
    }
  });
});
