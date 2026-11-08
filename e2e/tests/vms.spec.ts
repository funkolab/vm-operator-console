import { expect, test } from "@playwright/test";
import { ALICE, cleanup, ORIGIN, pageAs, uniq } from "./helpers";

test.describe("Virtual machines", () => {
  test("list, filter and open a VM", async ({ browser, baseURL }) => {
    const page = await pageAs(browser, ALICE, baseURL);
    await page.goto("/vms");
    await expect(page.getByRole("link", { name: "web-01", exact: true })).toBeVisible();
    await page.getByRole("textbox", { name: "Search" }).fill("postgres");
    await expect(page.getByRole("link", { name: "db-01" })).toBeVisible();
    await expect(page.getByRole("link", { name: "web-01", exact: true })).toHaveCount(0);
    await expect(page).toHaveURL(/q=postgres/);
    await page.getByRole("link", { name: "db-01" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("db-01");
    await page.getByRole("tab", { name: /Drift/ }).click();
    await expect(page.getByText("spec.compute.memorySize")).toBeVisible();
  });

  test("create a VM with the form, power it off, edit it, clone it and delete it", async ({ browser, request, baseURL }) => {
    const name = uniq("e2e-vm");
    const page = await pageAs(browser, ALICE, baseURL);
    await page.goto("/vms/new");
    await page.getByPlaceholder("web-01").fill(name);
    await page.locator("#general").getByPlaceholder("cluster name").fill("PE-Paris-01");
    await page.locator("#boot").getByPlaceholder("image name").fill("ubuntu-24.04-cloud");
    await page.locator("#network").getByPlaceholder("subnet name").fill("vlan-100-prod");
    // Client-side rule: SCSI.0 is reserved for the boot disk
    await page.locator("#storage").getByRole("button", { name: "Add disk" }).click();
    await page.locator("#storage").getByLabel("Device index").first().fill("0");
    await page.getByRole("button", { name: "Review" }).click();
    await expect(page.getByText(/SCSI.0 is reserved/)).toBeVisible();
    await page.locator("#storage").getByLabel("Device index").first().fill("1");
    await page.getByRole("button", { name: "Review" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Create VM" }).click();
    await expect(page).toHaveURL(new RegExp(`/vms/team-a/${name}$`));

    // Power off (desired state)
    await page.getByRole("button", { name: "Power off" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Power off" }).click();
    await expect(page.getByRole("button", { name: "Power on" })).toBeVisible();
    let vm = await (await request.get(`/api/namespaces/team-a/vms/${name}`, { headers: ALICE })).json();
    expect(vm.spec.powerState).toBe("Off");

    // Edit: change memory
    await page.getByRole("link", { name: "Edit" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Edit");
    const mem = page.locator("#compute").getByLabel("Memory");
    await mem.fill("12");
    await page.getByRole("button", { name: "Review" }).click();
    await expect(page.getByRole("dialog")).toContainText("12Gi");
    await page.getByRole("dialog").getByRole("button", { name: "Apply changes" }).click();
    await expect(page).toHaveURL(new RegExp(`/vms/team-a/${name}$`));
    vm = await (await request.get(`/api/namespaces/team-a/vms/${name}`, { headers: ALICE })).json();
    expect(vm.spec.compute.memorySize).toBe("12Gi");

    // Clone
    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Clone" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Clone", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/vms/team-a/${name}-clone$`));
    const clone = await (await request.get(`/api/namespaces/team-a/vms/${name}-clone`, { headers: ALICE })).json();
    expect(clone.metadata.annotations["console.nutanix.com/cloned-from"]).toBe(`team-a/${name}`);
    await cleanup(request, `/namespaces/team-a/vms/${name}-clone`);

    // Delete with type-to-confirm
    await page.goto(`/vms/team-a/${name}`);
    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    const confirm = page.getByRole("alertdialog");
    await expect(confirm.getByRole("button", { name: "Delete VM" })).toBeDisabled();
    await confirm.getByRole("textbox").fill(name);
    await confirm.getByRole("button", { name: "Delete VM" }).click();
    await expect(page).toHaveURL(/\/vms$/);
  });

  test("memory decrease on a running VM is blocked until power off is chosen", async ({ request }) => {
    const vm = await (await request.get("/api/namespaces/team-a/vms/web-01", { headers: ALICE })).json();
    vm.spec.compute.memorySize = "4Gi";
    const res = await request.put("/api/namespaces/team-a/vms/web-01", {
      headers: { ...ALICE, origin: ORIGIN },
      data: vm,
      params: { dryRun: "true" },
    });
    expect(res.status()).toBe(422);
    expect((await res.json()).error.details[0].message).toMatch(/powered off/);
  });

  test("live updates refresh the list without reload", async ({ browser, request, baseURL }) => {
    const page = await pageAs(browser, ALICE, baseURL);
    await page.goto("/vms");
    await expect(page.getByText("Live updates", { exact: true })).toBeVisible();
    const name = uniq("live");
    const vm = await (await request.get("/api/namespaces/team-a/vms/web-02", { headers: ALICE })).json();
    const res = await request.post(`/api/namespaces/team-a/vms/web-02/clone`, { headers: { ...ALICE, origin: ORIGIN }, data: { name } });
    expect(res.status(), JSON.stringify(vm.metadata.name)).toBe(201);
    await expect(page.getByRole("link", { name, exact: true })).toBeVisible({ timeout: 15_000 });
    await cleanup(request, `/namespaces/team-a/vms/${name}`);
    await expect(page.getByRole("link", { name, exact: true })).toHaveCount(0, { timeout: 15_000 });
  });
});
