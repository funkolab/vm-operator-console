import { expect, test } from "@playwright/test";
import { ALICE, BOB, CAROL, pageAs } from "./helpers";

test.describe("Impersonation and RBAC", () => {
  test("bob only sees team-b and cannot author templates", async ({ browser, request, baseURL }) => {
    const me = await (await request.get("/api/me", { headers: BOB })).json();
    expect(me.user).toBe("bob");
    expect(me.namespaces.map((n: { name: string }) => n.name)).toEqual(["team-b"]);

    const page = await pageAs(browser, BOB, baseURL);
    await page.goto("/vms");
    await expect(page.getByRole("link", { name: "win-jump" })).toBeVisible();
    await expect(page.getByRole("link", { name: "web-01", exact: true })).toHaveCount(0);

    await page.goto("/templates");
    await expect(page.getByRole("button", { name: "New template" })).toBeDisabled();

    // Direct API access to another namespace is denied by the API server
    const res = await request.get("/api/namespaces/team-a/vms/web-01", { headers: BOB });
    expect(res.status()).toBe(403);
    expect((await res.json()).error.message).toContain('User "bob"');
  });

  test("alice has read-only access to team-b", async ({ browser, baseURL }) => {
    const page = await pageAs(browser, ALICE, baseURL);
    await page.goto("/vms/team-b/win-jump");
    await expect(page.getByRole("button", { name: "Power off" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Edit" })).toBeDisabled();
  });

  test("a user without any binding gets an explanatory empty state", async ({ browser, baseURL }) => {
    const page = await pageAs(browser, CAROL, baseURL);
    await page.goto("/");
    await expect(page.getByText("No accessible namespaces")).toBeVisible();
  });

  test("cross-origin mutations are rejected (CSRF)", async ({ request }) => {
    const res = await request.post("/api/namespaces/team-a/vms/web-01/actions/stop", {
      headers: { ...ALICE, origin: "https://evil.example", "content-type": "application/x-www-form-urlencoded" },
    });
    expect(res.status()).toBe(403);
  });
});
