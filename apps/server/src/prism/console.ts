import { log } from "../log";
import type { ResolvedVM } from "./insights";

const SESSION_TTL_MS = 10 * 60_000;

/**
 * Bridges a browser websocket (noVNC) to the Prism Central VNC proxy of a VM.
 * The Prism session cookie is obtained server-side from the context
 * credentials and never reaches the browser.
 */
export class ConsoleProxy {
  private sessions = new Map<string, { cookie: string; expires: number }>();

  private async cookie(r: ResolvedVM, refresh = false): Promise<string> {
    const key = `${r.ctx.metadata.namespace}/${r.ctx.metadata.name}@${r.ctx.metadata.resourceVersion}`;
    const hit = this.sessions.get(key);
    if (!refresh && hit && hit.expires > Date.now()) return hit.cookie;
    const cookie = await r.client.sessionCookie();
    this.sessions.set(key, { cookie, expires: Date.now() + SESSION_TTL_MS });
    return cookie;
  }

  async upstreamUrl(r: ResolvedVM, clusterExtId?: string): Promise<string> {
    const base = r.client.baseUrl.replace(/^http/, "ws");
    return `${base}/vnc/vm/${encodeURIComponent(r.extId)}/proxy${clusterExtId ? `?proxyClusterUuid=${encodeURIComponent(clusterExtId)}` : ""}`;
  }

  /** Opens the upstream websocket; resolves once it is open. */
  async open(r: ResolvedVM, clusterExtId: string | undefined): Promise<WebSocket> {
    const url = await this.upstreamUrl(r, clusterExtId);
    const attempt = async (refresh: boolean) => {
      const cookie = await this.cookie(r, refresh);
      return new Promise<WebSocket>((resolve, reject) => {
        const ws = new WebSocket(url, {
          headers: { ...r.client.authHeaders, cookie, origin: r.client.baseUrl },
          tls: r.client.tls,
          protocols: ["binary"],
        } as unknown as string[]);
        ws.binaryType = "arraybuffer";
        const timer = setTimeout(() => {
          ws.close();
          reject(new Error("Timed out opening the Prism Central console"));
        }, 15_000);
        ws.onopen = () => {
          clearTimeout(timer);
          resolve(ws);
        };
        ws.onerror = (e) => {
          clearTimeout(timer);
          reject(new Error((e as ErrorEvent).message || "Prism Central refused the console connection"));
        };
      });
    };
    try {
      return await attempt(false);
    } catch (e) {
      log.debug("Retrying console connection with a fresh Prism session", { error: String(e) });
      return attempt(true);
    }
  }
}

/** Same-origin check for websocket upgrades (prevents cross-site websocket hijacking). */
export function isSameOrigin(origin: string | undefined, host: string | undefined, forwardedHost: string | undefined): boolean {
  if (!origin) return false;
  try {
    const o = new URL(origin);
    const expected = (forwardedHost ?? host ?? "").split(",")[0]?.trim().toLowerCase();
    return !!expected && o.host.toLowerCase() === expected;
  } catch {
    return false;
  }
}
