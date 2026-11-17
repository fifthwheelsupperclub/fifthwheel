// Mock-only: proves the Profile page layout and save flow (one title, plain sections, Save changes), not backend behavior.
import { expect, test, type BrowserContext } from "@playwright/test";

const origin = "http://127.0.0.1:8086";
const profile = (over: Record<string, unknown> = {}) => ({
  profileRevision: 3, firstName: "Maya", lastName: "Chen", dateOfBirth: "1990-04-14", identity: "woman", openTo: ["man"], matchAgeMin: 28, matchAgeMax: 45,
  neighborhood: "Inman Park", nights: [], lookingFor: "Open", surpriseGame: "Yes, surprise me", phone: null, oneLiner: null, ...over,
});
async function mock(context: BrowserContext, p: unknown, saved: unknown[] = []) {
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname === "/api/member/profile" && route.request().method() === "PUT") {
      const body = JSON.parse(route.request().postData() ?? "{}") as Record<string, unknown>;
      saved.push(body);
      return route.fulfill({ json: { ok: true, data: profile({ profileRevision: 4, firstName: body.firstName }), correlationId: "mock" } });
    }
    if (url.pathname === "/api/member/profile") return route.fulfill({ json: { ok: true, data: p } });
    if (url.pathname.startsWith("/api/")) return route.fulfill({ status: 404, json: {} });
    return route.continue();
  });
}

test("one title, section titles without numbering, and no photo, review or approval UI", async ({ page, context }) => {
  await mock(context, profile());
  await page.goto("/account/profile");
  await expect(page.getByRole("heading", { name: "Your profile", level: 1 })).toBeVisible();
  await expect(page.getByText("Only you and the Fifth Wheel team can see this.")).toBeVisible();
  for (const name of ["About you", "Who you’d like to meet", "More about you (optional)"]) await expect(page.getByRole("heading", { name, level: 2, exact: true })).toBeVisible();
  await expect(page.getByText(/0\d \/ /)).toHaveCount(0);
  await expect(page.getByText(/Photos for review|selfie|Submit for review|Not submitted|Approved/i)).toHaveCount(0);
  await expect(page.locator("#profile-missing")).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("Save changes is disabled until something changes, then saves with the expected revision", async ({ page, context }) => {
  const saved: unknown[] = [];
  await mock(context, profile(), saved);
  await page.goto("/account/profile");
  const save = page.getByRole("button", { name: "Save changes" });
  await expect(save).toBeDisabled();
  await page.getByLabel("First name").fill("Mia");
  await expect(save).toBeEnabled();
  await save.click();
  await expect(page.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();
  expect(saved).toHaveLength(1);
  expect(saved[0]).toMatchObject({ expectedProfileRevision: 3, firstName: "Mia" });
  expect(typeof (saved[0] as { operationId?: unknown }).operationId).toBe("string");
});
