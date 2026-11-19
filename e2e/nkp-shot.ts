// Logs in through NKP (Traefik forward-auth + Dex) and exercises the deployed console.
// Usage: NKP_USER=… NKP_PASSWORD=… bun nkp-shot.ts <consoleUrl> <outDir> <ns/vm>
import { chromium } from "@playwright/test";

const [url = "https://nkp1.nxlab.fr/dkp/vm-console/", out = "/out", vm = "vmc-demo/web-01"] = process.argv.slice(2);
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true });
const page = await ctx.newPage();
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
const wsUrls: string[] = [];
page.on("websocket", (ws) => wsUrls.push(ws.url()));

await page.goto(url, { waitUntil: "domcontentloaded" });
// Dex: pick the static password connector when a chooser is shown, then log in.
const local = page.getByRole("link", { name: /email|password|local/i });
if (
  await local
    .first()
    .isVisible({ timeout: 5000 })
    .catch(() => false)
)
  await local.first().click();
await page
  .locator("input[name=login], input#login, input[type=email]")
  .first()
  .fill(process.env.NKP_USER ?? "");
await page
  .locator("input[type=password]")
  .first()
  .fill(process.env.NKP_PASSWORD ?? "");
await page.locator("button[type=submit], #submit-login").first().click();
await page.waitForURL(/\/dkp\/vm-console\//, { timeout: 60_000 });
await page.getByRole("heading", { level: 1 }).waitFor({ timeout: 30_000 });
await page.waitForTimeout(4000);
await page.screenshot({ path: `${out}/nkp-dashboard.png` });

const me = await page.evaluate(async () => (await fetch("api/me")).json());
console.log("user:", me.user, "authMode:", me.authMode, "namespaces:", me.namespaces?.length);

const [ns, name] = vm.split("/");
await page.goto(new URL(`vms/${ns}/${name}?tab=console`, url).toString(), { waitUntil: "networkidle" });
await page
  .getByRole("button", { name: /^Connect$/ })
  .first()
  .click();
const connected = await page
  .getByText("Connected", { exact: true })
  .waitFor({ timeout: 25_000 })
  .then(() => true)
  .catch(() => false);
await page.waitForTimeout(2500);
await page
  .locator("canvas")
  .click()
  .catch(() => {});
await page.keyboard.press("Enter");
await page.waitForTimeout(2000);
await page.screenshot({ path: `${out}/nkp-console.png` });
console.log(
  "console connected:",
  connected,
  "ws:",
  wsUrls.filter((u) => u.includes("/console")).map((u) => new URL(u).pathname),
);

await page.goto(new URL("infrastructure", url).toString(), { waitUntil: "networkidle" });
await page.waitForTimeout(3000);
await page.screenshot({ path: `${out}/nkp-infrastructure.png` });
console.log(JSON.stringify({ errors }));
await browser.close();
