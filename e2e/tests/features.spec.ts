import { expect, test } from "@playwright/test";
import { ALICE, BOB, ORIGIN, pageAs } from "./helpers";

const office = {
  enabled: true,
  timezone: "Europe/Paris",
  rules: [
    { action: "start", at: "08:00", days: ["mon", "tue", "wed", "thu", "fri"] },
    { action: "stop", at: "20:00", days: ["mon", "tue", "wed", "thu", "fri"] },
  ],
};

test.describe("Productivity features", () => {
  test("power schedules are saved under the user identity and shown on the VM", async ({ browser, request, baseURL }) => {
    const path = "/api/namespaces/team-a/vms/web-01/schedule";
    const bad = await request.put(path, { headers: { ...ALICE, origin: ORIGIN }, data: { ...office, timezone: "Mars/Olympus" } });
    expect(bad.status()).toBe(422);
    const denied = await request.put(path, { headers: { ...BOB, origin: ORIGIN }, data: office });
    expect(denied.status()).toBe(403);
    const ok = await request.put(path, { headers: { ...ALICE, origin: ORIGIN }, data: office });
    expect(ok.status()).toBe(200);

    const page = await pageAs(browser, ALICE, baseURL);
    await page.goto("/vms/team-a/web-01");
    await expect(page.getByText("Power on at 08:00, weekdays")).toBeVisible();
    await expect(page.getByText("Power off at 20:00, weekdays")).toBeVisible();
    await page.getByRole("button", { name: "Remove", exact: true }).click();
    await expect(page.getByText("Power schedule removed")).toBeVisible();
    await expect(page.getByText("Power on at 08:00, weekdays")).toHaveCount(0);
  });

  test("command palette offers contextual VM actions", async ({ browser, baseURL }) => {
    const page = await pageAs(browser, ALICE, baseURL);
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.keyboard.press("Control+k");
    await page.getByPlaceholder(/Search VMs/).fill("db-01");
    await page.getByRole("option", { name: /db-01/ }).first().click();
    await expect(page.getByRole("option", { name: "Edit configuration" })).toBeVisible();
    await page.getByRole("option", { name: "Open details" }).click();
    await expect(page).toHaveURL(/\/vms\/team-a\/db-01/);
  });

  test("keyboard shortcuts navigate and compare shows a diff", async ({ browser, baseURL }) => {
    const page = await pageAs(browser, ALICE, baseURL);
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.keyboard.press("g");
    await page.keyboard.press("v");
    await expect(page).toHaveURL(/\/vms$/);
    await page.keyboard.press("Shift+?");
    await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
    await page.keyboard.press("Escape");
    const boxes = page.getByRole("checkbox", { name: "Select row" });
    await boxes.nth(0).check();
    await boxes.nth(1).check();
    await page.getByRole("button", { name: "Compare" }).click();
    await expect(page.getByRole("dialog", { name: "Compare configurations" }).locator(".cm-mergeView, .cm-editor").first()).toBeVisible();
  });
});
