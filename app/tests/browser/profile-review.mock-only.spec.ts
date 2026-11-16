// Mock-only: proves the Profile review queue row and detail layout (photos first, plain header, sticky decision), not backend behavior.
import { expect, test } from "@playwright/test";

const origin = "http://127.0.0.1:8086";
const guestId = "b1000000-0000-4000-8000-000000000001";
const queue = { items: [{ reviewId: "b1000000-0000-4000-8000-000000000002", guestId, firstName: "Maya", lastName: "Chen", submittedAt: "2026-11-14T23:08:00Z", profileRevision: 12, criticalIdentityVersion: 3, attemptNumber: 1 }], nextCursor: null };
const f = (id: string, kind: string) => ({ fileId: id, kind, state: "ready" });
const png = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10'><rect width='10' height='10' fill='%23888'/></svg>";
const detail = { reviewId: "b1000000-0000-4000-8000-000000000002", submittedAt: "2026-11-14T23:08:00Z", attemptNumber: 1, submittedCriticalIdentityVersion: 3, correctionReason: null,
  profile: { profileRevision: 12, criticalIdentityVersion: 3, reviewedIdentityVersion: null, identityStatus: "submitted", firstName: "Maya", lastName: "Chen", dateOfBirth: "1990-04-14", identity: "woman", files: [f("p1", "photo"), f("s1", "selfie")], missingFields: [] },
  evidence: [{ fileId: "p1", kind: "photo", readUrl: png, expiresAt: "2026-11-15T00:00:00Z" }, { fileId: "s1", kind: "selfie", readUrl: png, expiresAt: "2026-11-15T00:00:00Z" }] };
const ok = (data: unknown) => ({ json: { ok: true, data } });

test("queue rows show name, date and review number only; detail has plain header, photos first, sticky decision", async ({ page, context }) => {
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin && !url.href.startsWith("data:")) return route.abort();
    if (url.pathname === "/api/admin/identity-reviews") return route.fulfill(ok(queue));
    if (url.pathname === `/api/admin/identity-reviews/${guestId}`) return route.fulfill(ok(detail));
    if (url.pathname.startsWith("/api/")) return route.fulfill({ status: 404, json: {} });
    return route.continue();
  });
  await page.goto("/admin/identity-review");
  await expect(page.getByRole("heading", { name: "Profile review", level: 1 })).toBeVisible();
  const row = page.locator(".review-queue-item");
  await expect(row).toContainText("Maya Chen");
  await expect(row).toContainText("Review 1");
  await expect(row).not.toContainText("Version");
  await row.click();
  await expect(page.getByRole("heading", { name: "Maya Chen", level: 1 })).toBeVisible();
  await expect(page.getByText("Submitted Nov 14, 6:08 PM · Review 1")).toBeVisible();
  await expect(page.getByText("Review #1")).toHaveCount(0);
  await expect(page.getByText("CURRENT", { exact: true })).toHaveCount(0);
  // photos come before details
  const photosFirst = await page.evaluate(() => document.querySelector("#review-evidence-heading")!.compareDocumentPosition(document.querySelector("#review-profile-heading")!) & Node.DOCUMENT_POSITION_FOLLOWING);
  expect(photosFirst).toBeTruthy();
  await expect(page.getByText("Approving confirms the photos match these details.")).toBeVisible();
  await expect(page.getByText("What should happen next?")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Approve", exact: true })).toBeInViewport();
  await expect(page.getByRole("button", { name: "Ask for changes" })).toBeInViewport();
});
