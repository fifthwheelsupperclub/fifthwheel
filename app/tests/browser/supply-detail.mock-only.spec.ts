// Mock-only: proves the supply detail header, plain-language change list, sticky save bar and danger zone, not backend behavior.
import { expect, test } from "@playwright/test";

const origin = "http://127.0.0.1:8086";
const tableId = "a1000000-0000-4000-8000-000000000001";
const revId = "a1000000-0000-4000-8000-000000000011";
const stop = (role: string, minutes: number) => ({ role, venueId: `v-${role}`, venueName: `${role} venue`, venueAddress: "1 Main St", minutesFromStart: minutes, publicNotes: "" });
const content = { title: "Garden Table", localDate: "2026-12-12", startLocalTime: "19:00", neighborhood: "Inman Park", hostNotes: "", stops: [stop("drinks", 0), stop("dinner", 45), stop("dessert", 115)] };
const rev = (state: string) => ({ revisionId: revId, revision: 2, state, createdAt: "2026-11-10T15:00:00Z", updatedAt: "2026-11-12T15:00:00Z", content });
const detail = { providerState: "fixture", mutationsEnabled: true, tableId, lifecycle: "draft", draft: rev("draft"), accepted: null, published: null, syncState: "current", currentSyncState: "current", canEditDraft: true, canAccept: true, canPublish: false };
const preview = { tableId, draftRevision: 2, valid: false, startsAt: "2026-12-13T00:00:00Z", canAccept: false, canPublish: false, providerState: "fixture",
  changes: [{ field: "title", before: "Old", after: "Garden Table" }, { field: "stops.drinks.venueId", before: "a", after: "b" }, { field: "new_table", before: null, after: "Garden Table" }],
  issues: [{ field: "schedule", code: "invalid_date", message: "Enter a real Atlanta local date and time." }, { field: "venue", code: "missing_venue", stopRole: "dinner", message: "Select a valid venue for the dinner stop." }] };
const ok = (data: unknown) => ({ json: { ok: true, data, correlationId: "m" } });

test("supply detail: status badge title, plain-language changes, sticky save bar, danger zone", async ({ page, context }) => {
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname === `/api/supply/tables/${tableId}`) return route.fulfill(ok(detail));
    if (url.pathname === "/api/supply/venues") return route.fulfill(ok({ providerState: "fixture", items: [] }));
    if (url.pathname === `/api/supply/drafts/${revId}/preview`) return route.fulfill(ok(preview));
    if (url.pathname.startsWith("/api/")) return route.fulfill({ status: 404, json: {} });
    return route.continue();
  });
  await page.goto(`/admin/tables/${tableId}`);
  await expect(page.getByRole("heading", { name: "Garden Table", level: 1 })).toBeVisible();
  await expect(page.locator(".page-header .badge").getByText("Draft", { exact: true })).toBeVisible();
  await expect(page.getByText("Matches Airtable")).toHaveCount(0);
  await expect(page.getByText("Test mode", { exact: true })).toHaveCount(1);
  await expect(page.locator("main")).toContainText("Danger zone");
  await expect(page.getByRole("button", { name: "Cancel table…" })).toHaveClass(/button-danger/);
  // the save/preview bar stays in view
  const bar = page.locator(".supply-editor-actions");
  await bar.scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(bar).toBeInViewport();
  await page.getByRole("button", { name: "Preview revision" }).click();
  await expect(page.getByRole("heading", { name: "Changes" })).toBeVisible();
  for (const label of ["Title", "Drinks venue", "New table", "Date and time", "Dinner · Venue"]) await expect(page.locator("main").getByText(label, { exact: true }).first()).toBeVisible();
  for (const raw of ["new_table", "stops.drinks.venueId", "schedule"]) await expect(page.locator("main").getByText(raw, { exact: true })).toHaveCount(0);
});
