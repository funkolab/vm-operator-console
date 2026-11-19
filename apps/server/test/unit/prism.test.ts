import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { loadConfig } from "../../src/config";
import { setLogLevel } from "../../src/log";
import { PrismClient } from "../../src/prism/client";
import { PrismService } from "../../src/prism/service";
import { FakeKube } from "./fake-kube";

// Minimal mock of the Prism Central v4 REST API over TLS (self-signed).
let server: ReturnType<typeof Bun.serve>;
const seen: { path: string; auth: string | null; apiKey: string | null }[] = [];

beforeAll(async () => {
  const { execSync } = await import("node:child_process");
  const dir = execSync("mktemp -d").toString().trim();
  execSync(`openssl req -x509 -newkey rsa:2048 -nodes -keyout ${dir}/k.pem -out ${dir}/c.pem -days 1 -subj /CN=localhost 2>/dev/null`);
  server = Bun.serve({
    port: 0,
    tls: { key: Bun.file(`${dir}/k.pem`), cert: Bun.file(`${dir}/c.pem`) },
    fetch(req) {
      const url = new URL(req.url);
      seen.push({ path: url.pathname + url.search, auth: req.headers.get("authorization"), apiKey: req.headers.get("x-ntnx-api-key") });
      if (req.headers.get("authorization") === `Basic ${btoa("admin:wrong")}`) return new Response("unauthorized", { status: 401 });
      // An API key of "old-pc" simulates a PC older than 2024.3 (no domain manager API).
      if (url.pathname === "/api/prism/v4.0/config/domain-managers" && req.headers.get("x-ntnx-api-key") !== "old-pc")
        return Response.json({ data: [{ config: { buildInfo: { version: "pc.7.6" } } }] });
      if (url.pathname === "/api/clustermgmt/v4.0/config/clusters")
        return Response.json({
          data: [
            { extId: "c1", name: "PE-01", nodes: { numberOfNodes: 3 } },
            { extId: "pc", name: "PC", config: { clusterFunction: ["PRISM_CENTRAL"], buildInfo: { version: "pc.2024.2" } } },
          ],
          metadata: { totalAvailableResults: 2 },
        });
      if (url.pathname === "/api/networking/v4.0/config/subnets")
        return Response.json({ data: [{ extId: "s1", name: "vlan-100", subnetType: "VLAN", networkId: 100 }], metadata: { totalAvailableResults: 1 } });
      return new Response("not found", { status: 404 });
    },
  });
});
afterAll(() => server.stop(true));

const creds = (extra: object = {}) => ({ address: "localhost", port: server.port as number, insecure: true, username: "admin", password: "pw", ...extra });

describe("PrismClient", () => {
  test("reads the PC version with basic auth", async () => {
    expect(await new PrismClient(creds()).version()).toBe("pc.7.6");
    expect(seen.at(-1)?.auth).toBe(`Basic ${btoa("admin:pw")}`);
  });

  test("falls back to the cluster list on PCs without the domain manager API", async () => {
    expect(await new PrismClient(creds({ username: undefined, apiKey: "old-pc" })).version()).toBe("pc.2024.2");
    expect(seen.at(-2)?.path).toBe("/api/prism/v4.0/config/domain-managers");
    expect(seen.at(-1)?.path).toBe("/api/clustermgmt/v4.0/config/clusters");
  });

  test("uses the API key header", async () => {
    await new PrismClient(creds({ username: undefined, apiKey: "k" })).version();
    expect(seen.at(-1)?.apiKey).toBe("k");
  });

  test("lists clusters without the Prism Central itself, with paging params", async () => {
    const items = await new PrismClient(creds()).catalog("clusters");
    expect(items).toEqual([{ extId: "c1", name: "PE-01", info: { nodes: "3" } }]);
    expect(seen.at(-1)?.path).toContain("$limit=100");
  });

  test("maps subnets with VLAN info", async () => {
    const items = await new PrismClient(creds()).catalog("subnets");
    expect(items[0]?.info).toEqual({ type: "VLAN", vlan: "100" });
  });

  test("reports authentication failures clearly", async () => {
    await expect(new PrismClient(creds({ password: "wrong" })).version()).rejects.toThrow(/Authentication failed/);
  });

  test("verifies TLS in Secure mode", async () => {
    await expect(new PrismClient(creds({ insecure: false })).version()).rejects.toThrow(/Cannot reach Prism Central/);
  });
});

describe("PrismService minimum version", () => {
  setLogLevel("error");
  const kube = new FakeKube();
  const service = new PrismService(kube, loadConfig({ AUTH_MODE: "traefik" }));
  const account = (credential: object) => ({
    name: "pc",
    address: "localhost",
    port: server.port as number,
    tlsMode: "Insecure" as const,
    credential: credential as { mode: "basic"; username: string; password: string },
  });

  test("accepts a Prism Central 7.6", async () => {
    expect(await service.assertSupported(kube, "team-a", account({ mode: "basic", username: "admin", password: "pw" }))).toBe("pc.7.6");
  });

  test("refuses an older Prism Central", async () => {
    await expect(service.assertSupported(kube, "team-a", account({ mode: "apiKey", apiKey: "old-pc" }))).rejects.toThrow(/pc\.2024\.2 is not supported/);
  });

  test("checks the version with an existing credential Secret", async () => {
    kube.seed("secrets", { metadata: { name: "old-creds", namespace: "team-a" }, data: { apiKey: btoa("old-pc") } });
    await expect(service.assertSupported(kube, "team-a", account({ mode: "existing", secretName: "old-creds" }))).rejects.toThrow(/not supported/);
  });

  test("refuses when the version cannot be verified", async () => {
    await expect(service.assertSupported(kube, "team-a", account({ mode: "basic", username: "admin", password: "wrong" }))).rejects.toThrow(
      /Cannot verify the Prism Central version/,
    );
  });

  test("connection tests report unsupported versions", async () => {
    const res = await service.test(creds({ username: undefined, apiKey: "old-pc" }));
    expect(res).toMatchObject({ ok: false, pcVersion: "pc.2024.2" });
  });
});
