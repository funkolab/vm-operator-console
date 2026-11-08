import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import type { Hono } from "hono";
import type { AppEnv } from "./auth/identity";
import { log } from "./log";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json",
  ".webmanifest": "application/manifest+json",
};

/**
 * Serves the built SPA: hashed assets with immutable caching, everything else
 * falls back to index.html (no-cache) so client-side routes work. The base
 * path is injected into index.html at runtime so one image can be published
 * under any prefix.
 */
export function serveSpa(app: Hono<AppEnv>, dir: string, basePath: string) {
  const root = resolve(dir);
  const indexPath = join(root, "index.html");
  if (!existsSync(indexPath)) {
    log.warn("Static directory has no index.html; UI will not be served", { dir: root });
    return;
  }
  const base = `${basePath}/`;
  const rawIndex = readFileSync(indexPath, "utf8");
  const index = rawIndex.replaceAll('="./', `="${base}`).replace("<!--BASE_CONFIG-->", `<meta name="console-base-path" content="${basePath}">`);

  app.get("*", async (c) => {
    let rel = c.req.path;
    if (basePath && rel.startsWith(basePath)) rel = rel.slice(basePath.length);
    const file = normalize(join(root, decodeURIComponent(rel)));
    if (file.startsWith(root) && file !== root && existsSync(file) && statSync(file).isFile() && !file.endsWith("index.html")) {
      const ext = extname(file);
      const immutable = rel.startsWith("/assets/");
      return new Response(Bun.file(file), {
        headers: {
          "content-type": MIME[ext] ?? "application/octet-stream",
          "cache-control": immutable ? "public, max-age=31536000, immutable" : "public, max-age=300",
        },
      });
    }
    if (rel.startsWith("/assets/")) return c.text("Not found", 404);
    return c.html(index, 200, { "cache-control": "no-cache" });
  });
}
