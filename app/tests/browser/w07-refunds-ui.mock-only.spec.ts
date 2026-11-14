import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const appOrigin = "http://127.0.0.1:8086";
const obligationId = "e4000000-0000-4000-8000-000000000001";
const operationId = "e5000000-0000-4000-8000-000000000001";
const memberSeatId = "e6000000-0000-4000-8000-000000000001";
const screenshots = resolve("docs/implementation/screenshots");

const baseObligation = {
  obligationId, source: "cancellation", state: "failed", amountCents: 1250, currency: "USD",
  createdAt: "2026-11-12T14:00:00.000Z", updatedAt: "2026-11-13T15:00:00.000Z",
  memberName: "Morgan Avery", tableTitle: "Garden Table", reservedCents: 1250, availableCents: 0,
  latestSafeCode: "provider_failed", canDispatch: false, dispatchBlockedReason: "manual_review",
};
const failedOperation = {
  operationId, amountCents: 1250, state: "failed", createdAt: "2026-11-12T14:01:00.000Z",
  updatedAt: "2026-11-13T14:59:00.000Z", safeCode: "provider_failed", canRetry: false, canReconcile: true,
};
const unknownOperation = { ...failedOperation, state: "unknown", safeCode: "outcome_unknown", canRetry: false, canReconcile: true };
const retryableUnknownOperation = { ...unknownOperation, canRetry: true, canReconcile: false };
const failedDetail = { ...baseObligation, paymentAmountCents: 2500, refundedCents: 0, operations: [failedOperation] };
const unknownDetail = { ...baseObligation, state: "unknown", latestSafeCode: "outcome_unknown", paymentAmountCents: 2500, refundedCents: 0, operations: [unknownOperation] };
const retryableUnknownDetail = { ...unknownDetail, operations: [retryableUnknownOperation] };
const openDetail = { ...baseObligation, state: "open", latestSafeCode: null, reservedCents: 0, availableCents: 2500,
  canDispatch: true, dispatchBlockedReason: null, paymentAmountCents: 2500, refundedCents: 0, operations: [] };
const actionResult = (operation: typeof unknownOperation | typeof failedOperation, obligation = baseObligation) => ({
  ok: true, correlationId: "mock-refund-action", data: { operation, obligation },
});

async function mockRefundApi(context: import("@playwright/test").BrowserContext, opts: {
  detail?: unknown;
  onAction?: (path: string, body: Record<string, unknown>) => void;
}) {
  let detail = opts.detail ?? failedDetail;
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== appOrigin) return route.abort();
    if (url.pathname === "/api/admin/refunds" && route.request().method() === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, correlationId: "mock-refund-list", data: { items: [baseObligation], nextCursor: null } }) });
    }
    if (url.pathname === `/api/admin/refunds/${obligationId}` && route.request().method() === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, correlationId: "mock-refund-detail", data: detail }) });
    }
    if (url.pathname.startsWith("/api/admin/refunds/") && route.request().method() === "POST") {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      opts.onAction?.(url.pathname, body);
      detail = { ...detail as object, state: "pending", latestSafeCode: null,
        operations: [{ ...failedOperation, state: "pending", safeCode: null, canRetry: false, canReconcile: false }] };
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(actionResult({ ...failedOperation, state: "pending", safeCode: null, canRetry: false, canReconcile: false }, detail as typeof baseObligation)) });
    }
    if (url.pathname.startsWith("/api/admin/refund-operations/") && route.request().method() === "POST") {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      opts.onAction?.(url.pathname, body);
      const reconciliation = url.pathname.endsWith("/reconcile");
      const nextOperation = reconciliation ? { ...unknownOperation, state: "unknown", canRetry: false, canReconcile: true } : { ...failedOperation, state: "pending", safeCode: null, canRetry: false, canReconcile: false };
      detail = { ...detail as object, state: nextOperation.state, operations: [nextOperation] };
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(actionResult(nextOperation, detail as typeof baseObligation)) });
    }
    if (url.pathname.startsWith("/api/")) return route.abort();
    return route.continue();
  });
}

test("W07.5 mock-only admin refund queue and detail distinguish failure from settlement", async ({ browser }) => {
  await mkdir(screenshots, { recursive: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await mockRefundApi(context, { detail: failedDetail });
  try {
    const page = await context.newPage();
    await page.goto(`${appOrigin}/admin/refunds`);
    await expect(page.getByRole("heading", { name: "Refund obligations", exact: true })).toBeVisible();
    await expect(page.getByText("Refund attempt failed", { exact: true })).toBeVisible();
    await expect(page.getByText("Morgan Avery")).toBeVisible();
    await page.screenshot({ path: resolve(screenshots, "w07-refunds-admin-queue-desktop-mock-only.png"), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: resolve(screenshots, "w07-refunds-admin-queue-390px-mock-only.png"), fullPage: true });
    await page.getByRole("link", { name: "Review obligation" }).click();
    await expect(page.getByRole("heading", { name: "Refund attempt failed" })).toBeVisible();
    await expect(page.getByText("The refund attempt failed. The amount is still owed.").first()).toBeVisible();
    await expect(page.getByText("The refund is still owed and needs administrator review before another action.")).toBeVisible();
    await expect(page.getByText("This refund needs review; the amount remains owed.")).toBeVisible();
    await expect(page.getByText("Total owed on this payment")).toBeVisible();
    await expect(page.getByRole("button", { name: "Try refund again" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Check refund status" })).toBeVisible();
    await expect(page.getByText("Confirmed complete")).toHaveCount(0);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({ path: resolve(screenshots, "w07-refunds-admin-detail-failed-desktop-mock-only.png"), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: resolve(screenshots, "w07-refunds-admin-detail-failed-390px-mock-only.png"), fullPage: true });
  } finally { await context.close(); }
});

test("W07.5 mock-only unknown operation queues reconciliation without offering resend", async ({ browser }) => {
  let action: { path: string; body: Record<string, unknown> } | undefined;
  const context = await browser.newContext();
  await mockRefundApi(context, { detail: unknownDetail, onAction: (path, body) => { action = { path, body }; } });
  try {
    const page = await context.newPage();
    await page.goto(`${appOrigin}/admin/refunds/${obligationId}`);
    await expect(page.getByRole("heading", { name: "Refund status unclear" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Check refund status" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Try refund again" })).toHaveCount(0);
    await page.getByRole("button", { name: "Check refund status" }).click();
    await expect(page.getByRole("group", { name: "Check provider status?" })).toContainText("It will not send a new refund.");
    await page.getByRole("button", { name: "Confirm and queue" }).click();
    expect(action?.path).toBe(`/api/admin/refund-operations/${operationId}/reconcile`);
    expect(action?.body).toMatchObject({ requestId: expect.any(String) });
    await expect(page.getByRole("status")).toContainText("Status check queued");
    await expect(page.getByRole("heading", { name: "Refund status unclear" })).toBeVisible();
  } finally { await context.close(); }
});

test("W07.5 mock-only retryable unknown outcome retries the same operation with a new command ID", async ({ browser }) => {
  let action: { path: string; body: Record<string, unknown> } | undefined;
  const context = await browser.newContext();
  await mockRefundApi(context, { detail: retryableUnknownDetail, onAction: (path, body) => { action = { path, body }; } });
  try {
    const page = await context.newPage();
    await page.goto(`${appOrigin}/admin/refunds/${obligationId}`);
    await page.getByRole("button", { name: "Try refund again" }).click();
    await expect(page.getByRole("group", { name: "Queue a retry?" })).toContainText("same saved refund operation and provider idempotency key");
    await page.getByRole("button", { name: "Confirm and queue" }).click();
    expect(action?.path).toBe(`/api/admin/refund-operations/${operationId}/retry`);
    expect(action?.body).toMatchObject({ requestId: expect.any(String) });
    await expect(page.getByRole("status")).toContainText("Refund action queued");
    await expect(page.getByRole("heading", { name: "Refund queued" })).toBeVisible();
    await expect(page.getByText("Confirmed complete")).toHaveCount(0);
  } finally { await context.close(); }
});

test("W07.5 mock-only dispatch is server-gated and remains pending until provider evidence", async ({ browser }) => {
  let action: { path: string; body: Record<string, unknown> } | undefined;
  const context = await browser.newContext();
  await mockRefundApi(context, { detail: openDetail, onAction: (path, body) => { action = { path, body }; } });
  try {
    const page = await context.newPage();
    await page.goto(`${appOrigin}/admin/refunds/${obligationId}`);
    await expect(page.getByRole("heading", { name: "Refund owed" })).toBeVisible();
    await page.getByRole("button", { name: "Queue refund for processing" }).click();
    await expect(page.getByRole("group", { name: "Queue this refund?" })).toContainText("This amount is owed and has not been queued yet.");
    await page.getByRole("button", { name: "Confirm and queue" }).click();
    expect(action?.path).toBe(`/api/admin/refunds/${obligationId}/dispatch`);
    expect(action?.body).toMatchObject({ operationId: expect.any(String) });
    await expect(page.getByRole("heading", { name: "Refund queued" })).toBeVisible();
    await expect(page.getByText("Confirmed complete")).toHaveCount(0);
  } finally { await context.close(); }
});

test("W07.5 mock-only member Seat detail gives honest refund state and next-step copy", async ({ browser }) => {
  const states = [
    ["open", "Refund owed", "A refund is owed. It has not been queued for processing yet."],
    ["pending", "Refund queued", "Your refund is queued for processing. The payment provider has not confirmed it yet."],
    ["submitted", "Refund processing", "The payment provider accepted the refund request. We’re waiting for confirmation that it has been processed."],
    ["unknown", "Refund status unclear", "We can’t confirm whether the refund was processed yet. The amount remains owed until the provider confirms the result."],
    ["failed", "Refund not completed", "The refund attempt failed. The amount is still owed."],
    ["succeeded", "Refund complete", "The payment provider confirmed this refund."],
  ] as const;
  await mkdir(screenshots, { recursive: true });
  for (const [refundState, label, detailCopy] of states) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const table = {
      tableId: "e7000000-0000-4000-8000-000000000001", title: "Garden Table", localDate: "2026-12-12", startLocalTime: "19:00",
      timeZone: "America/New_York", startsAt: "2026-12-13T00:00:00.000Z", neighborhood: "Inman Park",
      itinerary: [
        { role: "drinks", venueName: "Juniper Room", venueAddress: "10 Auburn Ave", minutesFromStart: 0, publicNotes: "Meet inside." },
        { role: "dinner", venueName: "Garden Table", venueAddress: "22 Edgewood Ave", minutesFromStart: 45, publicNotes: "Shared plates." },
        { role: "dessert", venueName: "Little Tart", venueAddress: "68 Georgia Ave", minutesFromStart: 115, publicNotes: "Optional dessert stop." },
      ],
    };
    const detailBody = { ok: true, correlationId: `mock-member-refund-${refundState}`, data: {
      seatId: memberSeatId, state: "cancelled", participationState: "past", createdAt: "2026-11-01T15:00:00.000Z", table,
      payment: { state: "refund_pending", amountCents: 2500, currency: "USD", paidAt: "2026-11-01T15:02:00.000Z", receipt: { state: "unavailable", url: null } },
      refund: { state: refundState, amountCents: 1250, currency: "USD" }, calendar: { available: false, href: null },
      cancellation: { status: "approved", history: [{ requestId: "e8000000-0000-4000-8000-000000000001", status: "approved", requestedAt: "2026-11-02T10:00:00.000Z", decidedAt: "2026-11-02T11:00:00.000Z", safeReason: "Approved by the team." }] },
    } };
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== appOrigin) return route.abort();
      if (url.pathname === `/api/me/seats/${memberSeatId}` && route.request().method() === "GET")
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(detailBody) });
      if (url.pathname.startsWith("/api/")) return route.abort();
      return route.continue();
    });
    try {
      const page = await context.newPage();
      await page.goto(`${appOrigin}/my-seats/${memberSeatId}`);
      const refundCard = page.locator(".member-seat-card").filter({ has: page.getByText("REFUND", { exact: true }) });
      await expect(refundCard.getByRole("heading", { name: label })).toBeVisible();
      await expect(refundCard.getByText(detailCopy, { exact: true })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Seat cancelled" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Request cancellation" })).toHaveCount(0);
      if (refundState === "failed") {
        await page.screenshot({ path: resolve(screenshots, "w07-refunds-member-failed-desktop-mock-only.png"), fullPage: true });
        await page.setViewportSize({ width: 390, height: 844 });
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        await page.screenshot({ path: resolve(screenshots, "w07-refunds-member-failed-390px-mock-only.png"), fullPage: true });
      }
    } finally { await context.close(); }
  }
});
