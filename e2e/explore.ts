// Visual smoke exploration: visits each page, collects console errors and screenshots.
// Usage: bun explore.ts [baseUrl] [outDir]
import { chromium } from "@playwright/test";

const base = process.argv[2] ?? "http://127.0.0.1:8091";
const out = process.argv[3] ?? "/tmp/opencode/shots";

const pages: [name: string, path: string][] = [
  ["dashboard", "/"],
  ["vms", "/vms"],
  ["vm-detail", "/vms/team-a/web-01"],
  ["vm-hardware", "/vms/team-a/db-01?tab=hardware"],
  ["vm-drift", "/vms/team-a/db-01?tab=drift"],
  ["vm-edit", "/vms/team-a/web-01/edit"],
  ["vm-new", "/vms/new"],
  ["templates", "/templates"],
  ["template-detail", "/templates/team-a/ubuntu-medium"],
  ["template-edit", "/templates/team-a/ubuntu-medium/edit"],
  ["contexts", "/contexts"],
  ["context-detail", "/contexts/team-a/pc-prod"],
  ["context-new", "/contexts/new"],
  ["services", "/services"],
  ["service-detail", "/services/team-a/web"],
  ["events", "/events"],
];
const mobilePages = new Set(["dashboard", "vms", "vm-detail", "templates", "vm-new"]);

const viewports = [
  { label: "desktop", viewport: { width: 1440, height: 900 }, scheme: "light" },
  { label: "mobile", viewport: { width: 390, height: 844 }, scheme: "dark" },
] as const;

const browser = await chromium.launch();
for (const { label, viewport, scheme } of viewports) {
  const ctx = await browser.newContext({ viewport, colorScheme: scheme });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  for (const [name, path] of pages) {
    if (label === "mobile" && !mobilePages.has(name)) continue;
    errors.length = 0;
    await page.goto(base + path, { waitUntil: "networkidle" }).catch((e: Error) => errors.push(`goto: ${e.message}`));
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${out}/${label}-${name}.png`, fullPage: label === "desktop" });
    const h1 = await page
      .locator("h1")
      .first()
      .textContent()
      .catch(() => "(no h1)");
    console.log(`${label.padEnd(7)} ${name.padEnd(16)} h1=${JSON.stringify(h1)} ${errors.length ? `ERRORS: ${errors.join(" | ").slice(0, 400)}` : "ok"}`);
  }
  await ctx.close();
}
await browser.close();
