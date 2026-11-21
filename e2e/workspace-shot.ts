// Captures the workspace selector and the VM creation form scoped to a workspace.
// Usage: bun workspace-shot.ts <baseUrl> <outDir>
import { chromium } from "@playwright/test";

const [base = "http://127.0.0.1:8093", out = "/out"] = process.argv.slice(2);
const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  extraHTTPHeaders: { "x-dev-user": "alice", "x-dev-groups": "team-a-admins", "x-act-as": "alice" },
});
const page = await ctx.newPage();
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));

await page.goto(`${base}/vms`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Select workspace" }).click();
await page.waitForTimeout(400);
await page.screenshot({ path: `${out}/ws-switcher.png` });
await page.getByRole("option", { name: /Team A/ }).click();
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/ws-vms-team-a.png` });

await page.goto(`${base}/vms/new`, { waitUntil: "networkidle" });
await page.waitForTimeout(1000);
await page.screenshot({ path: `${out}/ws-new-vm.png` });

// Read-only workspace: creation is refused with a clear message.
await page.getByRole("button", { name: "Select workspace" }).click();
await page.getByRole("option", { name: /Team B/ }).click();
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}/ws-new-vm-denied.png` });

// All workspaces: the form offers a workspace choice.
await page.getByRole("button", { name: "Select workspace" }).click();
await page.getByRole("option", { name: /All workspaces/ }).click();
await page.goto(`${base}/vms`, { waitUntil: "networkidle" });
await page.waitForTimeout(1200);
await page.screenshot({ path: `${out}/ws-vms-all.png` });
console.log(JSON.stringify({ errors }));
await browser.close();
