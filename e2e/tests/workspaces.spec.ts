import { expect, test } from "@playwright/test";
import { ALICE, cleanup, pageAs, pickRef, uniq } from "./helpers";

test.describe("Workspaces", () => {
  test("the selector lists workspaces only, by display name", async ({ browser, baseURL }) => {
    const page = await pageAs(browser, ALICE, baseURL);
    await page.goto("/vms");
    await page.getByRole("button", { name: "Select workspace" }).click();
    const options = page.getByRole("option");
    await expect(options).toHaveText([/All workspaces/, /Team A/, /Team B/]);
    // Namespace names never show up in the selector.
    await expect(page.getByRole("option", { name: /^team-a$/ })).toHaveCount(0);
    await page.getByRole("option", { name: /Team B/ }).click();
    await expect(page.getByRole("link", { name: "win-jump" })).toBeVisible();
    await expect(page.getByRole("link", { name: "web-01", exact: true })).toHaveCount(0);
  });

  test("a VM created in the selected workspace lands in its namespace without asking for one", async ({ browser, request, baseURL }) => {
    const name = uniq("ws-vm");
    const page = await pageAs(browser, ALICE, baseURL);
    await page.goto("/vms");
    await page.getByRole("button", { name: "Select workspace" }).click();
    await page.getByRole("option", { name: /Team A/ }).click();
    await page.goto("/vms/new");
    await expect(page.locator("#identity").getByText("Team A")).toBeVisible();
    await expect(page.locator("#identity").getByRole("combobox")).toHaveCount(0);
    await page.getByPlaceholder("web-01").fill(name);
    await pickRef(page.locator("#general"), "cluster", "PE-Paris-01");
    await pickRef(page.locator("#boot"), "image", "ubuntu-24.04-cloud");
    await pickRef(page.locator("#network"), "subnet", "vlan-100-prod");
    await page.getByRole("button", { name: "Review" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Create VM" }).click();
    await expect(page).toHaveURL(new RegExp(`/vms/team-a/${name}$`));
    const res = await request.get(`/api/namespaces/team-a/vms/${name}`, { headers: ALICE });
    expect(res.status()).toBe(200);
    await cleanup(request, `/namespaces/team-a/vms/${name}`);
  });

  test("a read-only workspace explains that creation is not allowed", async ({ browser, baseURL }) => {
    const page = await pageAs(browser, ALICE, baseURL);
    await page.goto("/vms");
    await page.getByRole("button", { name: "Select workspace" }).click();
    await page.getByRole("option", { name: /Team B/ }).click();
    await page.goto("/vms/new");
    await expect(page.getByText("Read-only workspace")).toBeVisible();
  });
});
