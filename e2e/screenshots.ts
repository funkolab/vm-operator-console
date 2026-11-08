// Captures the main console screens for documentation.
// Usage: bun screenshots.ts [baseUrl] [outDir]
import { chromium } from "@playwright/test";

type Shot = { name: string; path: string; scheme: "light" | "dark" };

const base = process.argv[2] ?? "http://127.0.0.1:8092";
const out = process.argv[3] ?? "/out";
const shots: Shot[] = [
  { name: "dashboard", path: "/", scheme: "light" },
  { name: "vms", path: "/vms", scheme: "light" },
  { name: "vm-detail", path: "/vms/team-a/web-01", scheme: "light" },
  { name: "templates", path: "/templates", scheme: "light" },
  { name: "deploy-template", path: "/templates/team-a/ubuntu-medium", scheme: "light" },
  { name: "dashboard-dark", path: "/", scheme: "dark" },
];

const browser = await chromium.launch();
for (const { name, path, scheme } of shots) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: scheme });
  const page = await ctx.newPage();
  await page.addInitScript(() => localStorage.setItem("console.namespace", "_all"));
  await page.goto(base + path, { waitUntil: "networkidle" });
  if (name === "deploy-template") {
    await page.getByRole("button", { name: "Deploy" }).click();
    await page.getByRole("dialog").getByLabel("VM name").fill("web-{01..03}");
  }
  // Let chart animations settle.
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log(`saved ${name}.png`);
  await ctx.close();
}
await browser.close();
