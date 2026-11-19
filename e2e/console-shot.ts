// Opens a VM console in the browser and captures it once the VNC canvas is drawn.
// Usage: bun console-shot.ts <baseUrl> <outDir> <ns/name>
import { chromium } from "@playwright/test";

const [base = "http://127.0.0.1:8091", out = "/out", vm = "vmc-demo/web-01"] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, colorScheme: "dark" });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(`${base}/vms/${vm}?tab=console`, { waitUntil: "networkidle" });
await page
  .getByRole("button", { name: /^Connect$/ })
  .first()
  .click();
await page.getByText("Connected", { exact: true }).waitFor({ timeout: 20_000 });
await page.waitForTimeout(3000);
// Wake the screen up (a login prompt may be blanked).
await page.locator("canvas").click();
await page.keyboard.press("Enter");
await page.waitForTimeout(2500);
const painted = await page.evaluate(() => {
  const c = document.querySelector("canvas") as HTMLCanvasElement | null;
  if (!c) return { w: 0, h: 0, nonBlack: 0 };
  const ctx = c.getContext("2d");
  const d = ctx?.getImageData(0, 0, c.width, c.height).data;
  let nonBlack = 0;
  if (d) for (let i = 0; i < d.length; i += 4 * 97) if ((d[i] ?? 0) + (d[i + 1] ?? 0) + (d[i + 2] ?? 0) > 60) nonBlack++;
  return { w: c.width, h: c.height, nonBlack };
});
await page.screenshot({ path: `${out}/console.png` });
console.log(JSON.stringify({ painted, errors }));
await browser.close();
