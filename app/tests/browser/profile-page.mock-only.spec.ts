// Mock-only: proves the Profile page layout rules (one title, checklist on top, sticky actions), not backend behavior.
import { expect, test, type BrowserContext } from "@playwright/test";

const origin = "http://127.0.0.1:8086";
const profile = (over: Record<string, unknown> = {}) => ({
  profileRevision: 3, criticalIdentityVersion: 1, reviewedIdentityVersion: null, identityStatus: "draft", latestCorrectionReason: null,
  firstName: "Maya", lastName: "Chen", dateOfBirth: "1990-04-14", identity: "woman", openTo: ["man"], matchAgeMin: 28, matchAgeMax: 45,
  neighborhood: "Inman Park", nights: [], lookingFor: "Open", surpriseGame: "Yes, surprise me", phone: null, oneLiner: null,
  files: [], missingFields: ["photo", "selfie"], ...over,
});
async function mock(context: BrowserContext, p: unknown) {
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname === "/api/member/profile") return route.fulfill({ json: { ok: true, data: p } });
    if (url.pathname.startsWith("/api/")) return route.fulfill({ status: 404, json: {} });
    return route.continue();
  });
}

test("draft: one title, no repeated status, checklist above the form, section titles without numbering", async ({ page, context }) => {
  await mock(context, profile());
  await page.goto("/account/profile");
  await expect(page.getByRole("heading", { name: "Your profile", level: 1 })).toBeVisible();
  await expect(page.getByText("Only you and the Fifth Wheel team can see this.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Not submitted" })).toBeVisible();
  const checklist = page.locator("#profile-missing");
  await expect(checklist).toBeVisible();
  expect(await page.evaluate(() => document.querySelector("#profile-missing")!.compareDocumentPosition(document.querySelector("form.profile-form")!) & Node.DOCUMENT_POSITION_FOLLOWING)).toBeTruthy();
  for (const name of ["About you", "Who you’d like to meet", "More about you (optional)", "Photos for review"]) await expect(page.getByRole("heading", { name, level: 2, exact: true })).toBeVisible();
  await expect(page.getByText(/0\d \/ /)).toHaveCount(0);
  await expect(page.getByText("Changing your date of birth")).toHaveCount(0);
});

test("the action bar stays visible, says why Submit is disabled, and links to the checklist", async ({ page, context }) => {
  await mock(context, profile());
  await page.goto("/account/profile");
  await expect(page.getByRole("button", { name: "Submit for review" })).toBeDisabled();
  const link = page.getByRole("link", { name: "2 items still needed" });
  await link.scrollIntoViewIfNeeded();
  await expect(link).toBeInViewport();
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(page.getByRole("button", { name: "Submit for review" })).toBeInViewport();
  await link.click();
  await expect(page.locator("#profile-missing")).toBeFocused();
});

test("approved: the re-review rule appears, with no checklist", async ({ page, context }) => {
  await mock(context, profile({ identityStatus: "approved", reviewedIdentityVersion: 1, missingFields: [] }));
  await page.goto("/account/profile");
  await expect(page.getByRole("heading", { name: "Approved" })).toBeVisible();
  await expect(page.getByText("Changing your date of birth")).toBeVisible();
  await expect(page.locator("#profile-missing")).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
