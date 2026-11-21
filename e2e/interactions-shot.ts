// Exercises interactive features (palette, compare, shortcuts, completion toast) and captures them.
// Usage: bun interactions-shot.ts <baseUrl> <outDir>
import { chromium } from "@playwright/test";

const [base = "http://127.0.0.1:8091", out = "/out"] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.addInitScript(() => localStorage.setItem("console.workspace", "_all"));

// 1. Command palette: search a VM, then open its contextual actions.
await page.goto(`${base}/`, { waitUntil: "networkidle" });
await page.keyboard.press("Control+k");
await page.getByPlaceholder(/Search VMs/).fill("api-01");
await page.waitForTimeout(400);
await page.screenshot({ path: `${out}/palette-search.png` });
await page.keyboard.press("Enter");
await page.waitForTimeout(400);
await page.screenshot({ path: `${out}/palette-actions.png` });
await page.keyboard.press("Escape");
await page.waitForTimeout(600);

// 2. Keyboard shortcuts: g v then ?
await page.keyboard.press("g");
await page.keyboard.press("v");
await page.waitForURL(/\/vms/);
await page.keyboard.press("Shift+?");
await page.waitForTimeout(400);
await page.screenshot({ path: `${out}/shortcuts.png` });
await page.keyboard.press("Escape");
await page.waitForTimeout(600);

// 3. Compare two VMs.
await page.waitForTimeout(500);
const boxes = page.getByRole("checkbox", { name: "Select row" });
await boxes.nth(0).check();
await boxes.nth(2).check();
await page.getByRole("button", { name: "Compare" }).click();
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/compare.png` });
await page.keyboard.press("Escape");

// 4. Restart a VM and wait for the completion toast.
if (process.env.RESTART) {
  await page.goto(`${base}/vms/vmc-demo/${process.env.RESTART}`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Restart" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Restart" }).click();
  await page.waitForTimeout(4000);
  await page.screenshot({ path: `${out}/restart-progress.png` });
  const done = await page
    .getByText(/restart completed/i)
    .waitFor({ timeout: 150_000 })
    .then(() => true)
    .catch(() => false);
  await page.screenshot({ path: `${out}/restart-done.png` });
  console.log("completion toast:", done);
}
console.log(JSON.stringify({ errors }));
await browser.close();
