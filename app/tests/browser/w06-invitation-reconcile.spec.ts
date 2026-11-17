import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const appOrigin = "http://127.0.0.1:8086";
const invitationId = "4a8f7a9d-295f-4e5d-9fb0-a9cc5c8a19f0";
const outboxId = "5a8f7a9d-295f-4e5d-9fb0-a9cc5c8a19f0";
const guestId = "6a8f7a9d-295f-4e5d-9fb0-a9cc5c8a19f0";
const tableId = "7a8f7a9d-295f-4e5d-9fb0-a9cc5c8a19f0";

test("W06.5 unknown delivery check keeps uncertainty visible and never queues a resend", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.route("**/*", async (route) => {
    if (new URL(route.request().url()).origin === appOrigin) return route.continue();
    return route.abort();
  });

  let reconcileBody: unknown;
  let retryCalled = false;
  await context.route((url) => url.origin === appOrigin && url.pathname === "/api/admin/table-invitations", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, correlationId: "test-correlation", data: {
      items: [{
        invitationId, invitationState: "active", createdAt: "2026-11-12T18:00:00.000Z",
        guest: { guestId, displayName: "Taylor Example" },
        table: { tableId, title: "Autumn Table", localDate: "2026-12-12", startLocalTime: "19:00", neighborhood: "Inman Park" },
        delivery: { outboxId, state: "unknown", attemptCount: 2, queuedAt: "2026-11-12T18:00:00.000Z", nextAttemptAt: "2026-11-12T18:01:00.000Z", lastAttemptAt: "2026-11-12T18:01:00.000Z", safeErrorCode: "provider_outcome_unknown" },
        attempts: [{ attemptNumber: 2, state: "unknown", startedAt: "2026-11-12T18:01:00.000Z", finishedAt: "2026-11-12T18:01:00.000Z", safeErrorCode: "provider_outcome_unknown" }],
      }], nextCursor: null,
    } }) });
  });
  await context.route((url) => url.origin === appOrigin && url.pathname.endsWith(`/api/admin/table-invitations/${invitationId}/reconcile`), async (route) => {
    reconcileBody = route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, correlationId: "test-correlation", data: {
      invitationId, deliveryState: "unknown", attemptCount: 2,
    } }) });
  });
  await context.route((url) => url.origin === appOrigin && url.pathname.endsWith(`/api/admin/table-invitations/${invitationId}/retry`), async (route) => {
    retryCalled = true;
    await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ ok: false }) });
  });

  try {
    const page = await context.newPage();
    await page.goto(`${appOrigin}/admin/table-invitations`);
    await expect(page.getByRole("heading", { name: "Taylor Example" })).toBeVisible();
    await expect(page.getByText(/Outcome unknown\. Check the existing delivery attempt/i)).toBeVisible();
    const checkButton = page.getByRole("button", { name: "Check delivery" });
    await expect(checkButton).toBeVisible();
    await checkButton.click();
    await expect(page.getByText(/delivery outcome remains unknown/i)).toBeVisible();
    expect(reconcileBody).toEqual({ expectedAttemptCount: 2 });
    expect(retryCalled).toBe(false);
    await expect(page.getByRole("button", { name: "Check delivery" })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    for (const label of ["Waitlist", "Emails", "Tables"]) {
      const link = page.getByRole("link", { name: label, exact: true });
      await expect(link).toBeVisible();
      const box = await link.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    }
    const screenshotDirectory = resolve("docs/implementation/screenshots");
    await mkdir(screenshotDirectory, { recursive: true });
    await page.screenshot({ path: resolve(screenshotDirectory, "w06-table-invitation-unknown-recovery-390px-ui-injected.png"), fullPage: true });
  } finally {
    await context.close();
  }
});
