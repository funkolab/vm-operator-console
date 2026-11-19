// Design-review helper: captures arbitrary pages in light/dark and desktop/mobile.
// Usage: bun shoot.ts <baseUrl> <outDir> <name=path> [name=path...]
//   Options via env: SCHEMES=light,dark  VIEWPORTS=desktop,mobile  FULL=1  WAIT=1200
import { chromium } from "@playwright/test";

const [base = "http://127.0.0.1:8091", out = "/out", ...targets] = process.argv.slice(2);
const schemes = (process.env.SCHEMES ?? "light").split(",") as ("light" | "dark")[];
const viewports = (process.env.VIEWPORTS ?? "desktop").split(",");
const sizes: Record<string, { width: number; height: number }> = {
  desktop: { width: 1440, height: 900 },
  laptop: { width: 1280, height: 800 },
  mobile: { width: 390, height: 844 },
};

const browser = await chromium.launch();
for (const vp of viewports)
  for (const scheme of schemes) {
    const ctx = await browser.newContext({ viewport: sizes[vp], colorScheme: scheme, deviceScaleFactor: vp === "mobile" ? 2 : 1 });
    await ctx.addInitScript(() => localStorage.setItem("console.namespace", localStorage.getItem("console.namespace") ?? "_all"));
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    for (const t of targets) {
      const [name, path] = t.split("=") as [string, string];
      errors.length = 0;
      await page.goto(base + path, { waitUntil: "networkidle" }).catch((e: Error) => errors.push(`goto: ${e.message}`));
      await page.waitForTimeout(Number(process.env.WAIT ?? 1200));
      const file = `${out}/${name}-${vp}-${scheme}.png`;
      await page.screenshot({ path: file, fullPage: process.env.FULL === "1" });
      console.log(`${file} ${errors.length ? `ERRORS: ${errors.join(" | ").slice(0, 300)}` : "ok"}`);
    }
    await ctx.close();
  }
await browser.close();
