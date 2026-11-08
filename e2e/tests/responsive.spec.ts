import { expect, test } from "@playwright/test";
import { ALICE, pageAs } from "./helpers";

test("mobile layout uses cards and an off-canvas sidebar", async ({ browser, baseURL }) => {
  const page = await pageAs(browser, ALICE, baseURL);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/vms");
  await expect(page.getByRole("table")).toBeHidden();
  await expect(page.getByText("web-01").first()).toBeVisible();
  await page.getByRole("button", { name: "Toggle Sidebar" }).click();
  await page.getByRole("link", { name: "Templates" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Templates");
});
