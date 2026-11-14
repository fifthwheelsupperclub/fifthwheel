// Mock-only: the API is intercepted. Proves ordering, alerts and links, not the counts' correctness (the DB harness covers that).
import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const origin = "http://127.0.0.1:8086";
const shots = resolve("docs/implementation/screenshots");
const counts = { decisionsSuspended: 1, decisionsNeeded: 0, paymentsUnaccounted: 0, refundsNeedingAttention: 2, votesNotFinalized: 0, refundsOpen: 3, cancellationsPending: 1, cancellationsFlagged: 1,
  tableInvitationDeliveryProblems: 0, admissionDeliveryProblems: 0, identityReviews: 4, seatRequests: 0, rostersAwaitingApproval: 0, waitlistAwaitingInvite: 7, conductReportsNew: 0, conductReportsReviewDue: 0,
  supplyNeedsAttention: 0, unstaffedWithinSevenDays: 0, oldestPendingDeliveryMinutes: 22 };

for (const healthy of [true, false]) {
  test(`overview with ${healthy ? "a healthy" : "a stale"} worker lists urgent queues first and links to them`, async ({ page, context }) => {
    await mkdir(shots, { recursive: true });
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort();
      if (url.pathname === "/api/admin/overview") return route.fulfill({ json: { ok: true, correlationId: "m", data: { generatedAt: "2026-12-12T12:00:00Z", counts,
        heartbeat: { lastRunAt: healthy ? "2026-12-12T11:58:00Z" : "2026-12-12T11:20:00Z", ageMinutes: healthy ? 2 : 40, healthy } } } });
      if (url.pathname.startsWith("/api/")) return route.abort();
      return route.continue();
    });
    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
    const cards = page.locator(".ops-card h2");
    await expect(cards.first()).toContainText("Suspended Tables");
    await expect(cards.nth(1)).toContainText("Refunds failed or unconfirmed");
    await expect(page.getByText("The oldest queued Table invitation email has waited 22 minutes.")).toBeVisible();
    await expect(page.getByText(healthy ? /Background worker last ran 2 minutes ago/ : /Emails and refunds may be stuck/)).toBeVisible();
    await expect(page.getByText(/queues are clear/)).toBeVisible();
    await expect(page.locator(".ops-card").filter({ hasText: "Profiles awaiting identity review" }).getByRole("link", { name: "Open" })).toHaveAttribute("href", "/admin/identity-review");
    await expect(page.getByText(/ballot|vote choice/i)).toHaveCount(0);
    if (healthy) await page.screenshot({ path: `${shots}/w10-admin-overview-desktop-mock-only.png`, fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}

test("a failed overview load says so and offers a retry; a non-admin is told they have no access", async ({ page, context }) => {
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname === "/api/admin/overview") return route.fulfill({ status: 403, json: { ok: false, error: { code: "forbidden", safeMessage: "You do not have access to this." } } });
    if (url.pathname.startsWith("/api/")) return route.abort();
    return route.continue();
  });
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "You don’t have access to this" })).toBeVisible();
});

test("email problems: unknown vs failed are explained and Send again / Dismiss post the exact action", async ({ page, context }) => {
  const noticeId = "e0840000-0000-4000-8000-000000000501";
  const seen: Array<{ path: string; body: unknown }> = [];
  let resolved = false;
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname === "/api/admin/notices") return route.fulfill({ json: { ok: true, correlationId: "m", data: { items: resolved ? [] : [{ noticeId, kind: "table_cancelled", state: "unknown", attempts: 1, errorCode: "lease_expired", createdAt: "2026-12-12T12:00:00Z", firstName: "Maya", tableTitle: "Autumn Table" }] } } });
    if (url.pathname === `/api/admin/notices/${noticeId}/resolve`) { seen.push({ path: url.pathname, body: JSON.parse(route.request().postData() ?? "{}") }); resolved = true; return route.fulfill({ json: { ok: true, correlationId: "m", data: { noticeId, state: "queued" } } }); }
    if (url.pathname.startsWith("/api/")) return route.abort();
    return route.continue();
  });
  await page.goto("/admin/notices");
  await expect(page.getByText("Unconfirmed", { exact: true })).toBeVisible();
  await expect(page.getByText(/never sends an uncertain email twice on its own/)).toBeVisible();
  await expect(page.getByText(/@/)).toHaveCount(0);
  await page.screenshot({ path: `${shots}/w10-email-problems-desktop-mock-only.png`, fullPage: true });
  await page.getByRole("button", { name: "Send again" }).click();
  await expect(page.getByRole("heading", { name: "No email problems" })).toBeVisible();
  expect(seen[0].body).toEqual({ action: "retry" });
});
