import type { APIRequestContext, Browser, Locator, Page } from "@playwright/test";

/** Same-origin header for API mutations (CSRF protection). */
export const ORIGIN = new URL(process.env.BASE_URL ?? "http://127.0.0.1:8091").origin;

export const ALICE = { "x-dev-user": "alice", "x-dev-groups": "team-a-admins", "x-act-as": "alice" };
export const BOB = { "x-dev-user": "bob", "x-dev-groups": "team-b-ops", "x-act-as": "bob" };
export const CAROL = { "x-dev-user": "carol", "x-dev-groups": "", "x-act-as": "carol" };

export async function pageAs(browser: Browser, headers: Record<string, string>, baseURL?: string): Promise<Page> {
  const ctx = await browser.newContext({ extraHTTPHeaders: headers, baseURL });
  const page = await ctx.newPage();
  await page.addInitScript(() => localStorage.setItem("console.namespace", "_all"));
  return page;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Sets a Nutanix reference field (cluster, image, subnet…) through its picker:
 * the catalog entry when Prism Central answers, else the typed name.
 */
export async function pickRef(scope: Locator, kind: string, name: string) {
  await scope
    .getByRole("combobox", { name: new RegExp(`^Select an? ${escapeRe(kind)}`) })
    .first()
    .click();
  const page = scope.page();
  await page.locator("[cmdk-input]").fill(name);
  await page
    .getByRole("option", { name: new RegExp(`^(Use “)?${escapeRe(name)}`) })
    .first()
    .click();
}

export function uniq(prefix: string) {
  return `${prefix}-${Date.now().toString(36).slice(-5)}`;
}

/** Deletes a resource through the API, ignoring 404s. */
export async function cleanup(request: APIRequestContext, path: string, headers = ALICE) {
  await request.delete(`/api${path}`, { headers: { ...headers, origin: ORIGIN } }).catch(() => {});
}
