import { expect, test } from "@playwright/test";
import { ALICE, cleanup, ORIGIN, pageAs, uniq } from "./helpers";

test.describe("VM templates", () => {
  test("create a template in the UI, deploy two VMs from it, then delete it", async ({ browser, request, baseURL }) => {
    const id = uniq("e2e-tpl");
    const page = await pageAs(browser, ALICE, baseURL);

    await page.goto("/templates/new");
    await page.getByLabel("Display name").first().fill(`E2E ${id}`);
    await page.getByLabel("Template ID").fill(id);
    // Fixed values in the VM definition
    await page.locator("#boot").getByPlaceholder("image name").fill("ubuntu-24.04-cloud");
    await page.locator("#network").getByPlaceholder("subnet name").fill("vlan-100-prod");
    await page.getByRole("button", { name: "Create template" }).click();

    await expect(page).toHaveURL(new RegExp(`/templates/team-a/${id}$`));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(`E2E ${id}`);
    await expect(page.getByText("/spec/placement/cluster")).toBeVisible();

    // Deploy: the required cluster parameter must be provided
    await page.getByRole("button", { name: "Deploy" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("VM name").fill(`${id}-{1..2}`);
    await dialog.getByRole("button", { name: "Deploy" }).click();
    await expect(dialog.getByText("Required").first()).toBeVisible();
    await dialog.getByPlaceholder("cluster name").fill("PE-Paris-01");
    await expect(dialog.getByText(`${id}-1, ${id}-2`)).toBeVisible();
    await dialog.getByRole("button", { name: "Deploy" }).click();

    await expect(page).toHaveURL(/\/vms/);
    await expect(page.getByRole("link", { name: `${id}-1` }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: `${id}-2` }).first()).toBeVisible();

    // Traceability: the VM links back to its template
    const res = await request.get(`/api/namespaces/team-a/vms/${id}-1`, { headers: ALICE });
    const vm = await res.json();
    expect(vm.metadata.labels["console.nutanix.com/template"]).toBe(id);
    expect(vm.metadata.annotations["console.nutanix.com/source-template"]).toBe(`team-a/vmt-${id}`);
    expect(vm.spec.placement.cluster).toEqual({ type: "name", name: "PE-Paris-01" });

    // Template is stored as a labelled ConfigMap
    const list = await (await request.get("/api/namespaces/team-a/templates", { headers: ALICE })).json();
    const tpl = list.items.find((t: { name: string }) => t.name === id);
    expect(tpl.usageCount).toBe(2);

    await cleanup(request, `/namespaces/team-a/vms/${id}-1`);
    await cleanup(request, `/namespaces/team-a/vms/${id}-2`);

    // Delete from the library
    await page.goto(`/templates/team-a/${id}`);
    await page.goto("/templates");
    const card = page.locator("div.rounded-xl", { hasText: `E2E ${id}` }).first();
    await card.getByRole("button", { name: `Actions for E2E ${id}` }).click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete template" }).click();
    await expect(page.getByText(`E2E ${id}`)).toHaveCount(0);
  });

  test("save an existing VM as a template", async ({ browser, request, baseURL }) => {
    const id = uniq("from-vm");
    const page = await pageAs(browser, ALICE, baseURL);
    await page.goto("/vms/team-a/web-01");
    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Save as template" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Template ID").fill(id);
    await dialog.getByRole("button", { name: "Save template" }).click();
    await expect(page).toHaveURL(new RegExp(`/templates/team-a/${id}/edit$`));
    const t = await (await request.get(`/api/namespaces/team-a/templates/${id}`, { headers: ALICE })).json();
    expect(t.vm.spec.biosUUID).toBeUndefined();
    expect(t.vm.spec.compute.memorySize).toBe("8Gi");
    await cleanup(request, `/namespaces/team-a/templates/${id}`);
  });

  test("server rejects an invalid template", async ({ request }) => {
    const res = await request.post("/api/namespaces/team-a/templates", {
      headers: { ...ALICE, origin: ORIGIN },
      data: {
        name: "invalid-one",
        displayName: "Invalid",
        vm: {
          spec: {
            placement: { cluster: { type: "name", name: "x" } },
            compute: { numSockets: 1, memorySize: "1Gi" },
            bootConfiguration: { bootDisk: { source: { type: "Image", image: { type: "name", name: "img" } } } },
            network: {},
            storage: { dataDisks: [{ diskSize: "1Gi", storageConfig: { diskMode: "Flash" }, deviceProperties: { adapterType: "SCSI", deviceIndex: 1 } }] },
          },
        },
      },
    });
    expect(res.status()).toBe(422);
    const body = await res.json();
    expect(body.error.details[0].message).toMatch(/Flash/);
  });
});
