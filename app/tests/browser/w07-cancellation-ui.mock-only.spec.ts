import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const appOrigin = "http://127.0.0.1:8086";
const seatId = "d4000000-0000-4000-8000-000000000001";
const requestId = "d5000000-0000-4000-8000-000000000001";
const screenshots = resolve("docs/implementation/screenshots");

const pendingRequest = {
  requestId, seatId, state: "pending", version: 1, requestedAt: "2026-11-13T15:00:00.000Z", decidedAt: null,
  memberReason: "My plans changed.", memberSafeReason: null, refundCents: null,
};
const memberHistory = (pending: boolean) => ({ ok: true, correlationId: "mock-cancel-member", data: {
  seatState: pending ? "cancellation_requested" : "confirmed",
  items: pending ? [pendingRequest] : [], nextCursor: null,
  requestAvailability: pending ? { canRequest: false, reason: "request_pending" } : { canRequest: true, reason: "available" },
} });
const queueItem = {
  request: pendingRequest,
  member: { guestId: "d6000000-0000-4000-8000-000000000001", displayName: "Morgan Avery" },
  table: { tableId: "d7000000-0000-4000-8000-000000000001", title: "Garden Table", localDate: "2026-11-21", startLocalTime: "19:00" },
  seat: { seatId, state: "cancellation_requested", paidAt: "2026-11-01T15:02:00.000Z", amountCents: 2500, refundAvailableCents: 2500 },
};
const pendingAdminDetail = { ...queueItem, refundBalance: { paidCents: 2500, refundCommittedCents: 0, refundAvailableCents: 2500 } };
function decidedDetail(decision: "approve" | "deny", refundCents: number, memberSafeReason: string, currentSeatState: string = queueItem.seat.state) {
  return { ...pendingAdminDetail, request: { ...pendingRequest, state: decision === "approve" ? "approved" : "denied", version: 2,
      decidedAt: "2026-11-13T16:00:00.000Z", memberSafeReason, refundCents },
    seat: { ...queueItem.seat, state: decision === "approve" ? "cancelled" : currentSeatState, refundAvailableCents: 2500 - refundCents },
    refundBalance: { paidCents: 2500, refundCommittedCents: refundCents, refundAvailableCents: 2500 - refundCents } };
}

async function intercept(context: import("@playwright/test").BrowserContext, options: {
  member?: boolean; adminDetail?: unknown; queueItems?: unknown[]; onRequest?: (body: unknown) => void; onDecision?: (body: unknown) => void;
}) {
  let memberPending = false;
  let currentAdminDetail: unknown = options.adminDetail ?? pendingAdminDetail;
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== appOrigin) return route.abort();
    if (url.pathname === `/api/me/seats/${seatId}/cancellation-requests` && route.request().method() === "GET")
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(memberHistory(memberPending)) });
    if (url.pathname === `/api/me/seats/${seatId}/cancellation-requests` && route.request().method() === "POST") {
      const body = route.request().postDataJSON(); options.onRequest?.(body); memberPending = true;
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, correlationId: "mock-cancel-request", data: pendingRequest }) });
    }
    if (url.pathname === "/api/admin/cancellations" && route.request().method() === "GET")
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, correlationId: "mock-cancel-queue", data: { items: options.queueItems ?? [queueItem], nextCursor: null } }) });
    if (url.pathname === `/api/admin/cancellations/${requestId}` && route.request().method() === "GET")
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, correlationId: "mock-cancel-detail", data: currentAdminDetail }) });
    if (url.pathname === `/api/admin/cancellations/${requestId}/decision` && route.request().method() === "POST") {
      const body = route.request().postDataJSON() as { decision: "approve" | "deny"; refundCents: number; memberSafeReason: string };
      options.onDecision?.(body);
      const currentSeatState = (currentAdminDetail as typeof pendingAdminDetail).seat.state;
      currentAdminDetail = decidedDetail(body.decision, body.refundCents, body.memberSafeReason, currentSeatState);
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, correlationId: "mock-cancel-decision", data: currentAdminDetail }) });
    }
    if (url.pathname.startsWith("/api/")) return route.abort();
    return route.continue();
  });
}

test("W07.4 mock-only member request preserves active Seat rights and shows history", async ({ browser }) => {
  await mkdir(screenshots, { recursive: true });
  let postedBody: unknown;
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await intercept(context, { onRequest: (body) => { postedBody = body; } });
  try {
    const page = await context.newPage();
    await page.goto(`${appOrigin}/my-seats/${seatId}/cancellation`);
    await expect(page.getByRole("heading", { name: "Ask to cancel this seat" })).toBeVisible();
    await page.getByLabel("Anything we should know? (optional)").fill("My plans changed.");
    await page.getByRole("button", { name: "Send request" }).click();
    await expect(page.getByText("Waiting for review", { exact: true })).toBeVisible();
    await expect(page.getByText("Your seat is still yours until we decide.")).toBeVisible();
    await expect(page.getByText("You can still come and vote.")).toBeVisible();
    expect(postedBody).toMatchObject({ operationId: expect.any(String), memberReason: "My plans changed." });
    await page.screenshot({ path: resolve(screenshots, "w07-cancellation-member-pending-desktop-mock-only.png"), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: resolve(screenshots, "w07-cancellation-member-pending-390px-mock-only.png"), fullPage: true });
  } finally { await context.close(); }
});

test("W07.4 mock-only member history reflects completed and cancelled Seat states", async ({ browser }) => {
  for (const terminalState of ["completed", "cancelled"] as const) {
    const context = await browser.newContext();
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== appOrigin) return route.abort();
      if (url.pathname === `/api/me/seats/${seatId}/cancellation-requests`) {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, correlationId: `mock-cancel-${terminalState}`, data: {
          seatState: terminalState, items: [pendingRequest], nextCursor: null,
          requestAvailability: { canRequest: false, reason: "table_closed" },
        } }) });
      }
      if (url.pathname.startsWith("/api/")) return route.abort();
      return route.continue();
    });
    try {
      const page = await context.newPage();
      await page.goto(`${appOrigin}/my-seats/${seatId}/cancellation`);
      if (terminalState === "completed") await expect(page.getByText("The Table is complete.")).toBeVisible();
      else await expect(page.getByText("The Table and your Seat have been cancelled.")).toBeVisible();
      await expect(page.getByText("Your cancellation request remains under review.")).toBeVisible();
      await expect(page.getByRole("button", { name: "Send request" })).toHaveCount(0);
      await page.setViewportSize({ width: 390, height: 844 });
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: resolve(screenshots, `w07-cancellation-member-${terminalState}-390px-mock-only.png`), fullPage: true });
    } finally { await context.close(); }
  }
});

test("W07.4 mock-only admin approval records a bounded partial refund obligation without claiming settlement", async ({ browser }) => {
  await mkdir(screenshots, { recursive: true });
  let decisionBody: { decision: string; refundCents: number; expectedVersion: number } | undefined;
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await intercept(context, { onDecision: (body) => { decisionBody = body as typeof decisionBody; } });
  try {
    const page = await context.newPage();
    await page.goto(`${appOrigin}/admin/cancellations`);
    await expect(page.getByRole("heading", { name: "Cancellation requests" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Morgan Avery" })).toBeVisible();
    await page.screenshot({ path: resolve(screenshots, "w07-cancellations-admin-queue-desktop-mock-only.png"), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: resolve(screenshots, "w07-cancellations-admin-queue-390px-mock-only.png"), fullPage: true });
    await page.getByRole("link", { name: "Review request" }).click();
    await expect(page.getByRole("heading", { name: "Cancel this seat?" })).toBeVisible();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({ path: resolve(screenshots, "w07-cancellations-admin-detail-desktop-mock-only.png"), fullPage: true });
    await page.getByLabel("Message to the guest").fill("We can return half of the amount paid.");
    await page.getByLabel("Partial", { exact: false }).check();
    await page.getByLabel("Amount in dollars").fill("12.50");
    await page.getByRole("button", { name: "Approve cancellation" }).click();
    await expect(page.getByRole("alertdialog")).toContainText("Approving adds a $12.50 refund to Refunds.");
    await expect(page.getByRole("alertdialog")).toContainText("Send it from there.");
    await page.screenshot({ path: resolve(screenshots, "w07-cancellations-admin-confirm-desktop-mock-only.png"), fullPage: true });
    await page.getByRole("button", { name: /^(Approve|Decline)$/ }).last().click();
    await expect(page.getByRole("heading", { name: "Approved" })).toBeVisible();
    expect(decisionBody).toMatchObject({ decision: "approve", refundCents: 1250, expectedVersion: 1 });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: resolve(screenshots, "w07-cancellations-admin-detail-390px-mock-only.png"), fullPage: true });
  } finally { await context.close(); }
});

test("W07.4 mock-only admin queue labels terminal Seats without implying they are active", async ({ browser }) => {
  for (const terminalState of ["completed", "cancelled"] as const) {
    const context = await browser.newContext();
    const terminalQueueItem = { ...queueItem, seat: { ...queueItem.seat, state: terminalState } };
    await intercept(context, { queueItems: [terminalQueueItem] });
    try {
      const page = await context.newPage();
      await page.goto(`${appOrigin}/admin/cancellations`);
      await expect(page.getByRole("heading", { name: "Morgan Avery" })).toBeVisible();
      const seatStatus = page.locator(".cancellation-admin-seat");
      await expect(seatStatus).toContainText(terminalState === "completed" ? "Table completed" : "Table cancelled");
      await expect(seatStatus).not.toContainText("Seat active");
    } finally { await context.close(); }
  }
});

test("W07.4 mock-only admin denial keeps the Seat active and sends no refund amount", async ({ browser }) => {
  let decisionBody: { decision: string; refundCents: number } | undefined;
  const context = await browser.newContext();
  await intercept(context, { onDecision: (body) => { decisionBody = body as typeof decisionBody; } });
  try {
    const page = await context.newPage();
    await page.goto(`${appOrigin}/admin/cancellations/${requestId}`);
    await page.getByLabel("Message to the guest").fill("The request does not meet the cancellation criteria.");
    await page.getByRole("button", { name: "Decline", exact: true }).click();
    await expect(page.getByRole("alertdialog")).toContainText("Declining keeps their seat as it is (confirmed).");
    await page.getByRole("button", { name: /^(Approve|Decline)$/ }).last().click();
    await expect(page.getByRole("heading", { name: "Declined. Seat unchanged." })).toBeVisible();
    expect(decisionBody).toMatchObject({ decision: "deny", refundCents: 0 });
  } finally { await context.close(); }
});

test("W07.4 mock-only denial preserves a completed Seat in the confirmation and saved result", async ({ browser }) => {
  const completedDetail = { ...pendingAdminDetail, seat: { ...queueItem.seat, state: "completed" } };
  let decisionBody: { decision: string; refundCents: number } | undefined;
  const context = await browser.newContext();
  await intercept(context, { adminDetail: completedDetail, onDecision: (body) => { decisionBody = body as typeof decisionBody; } });
  try {
    const page = await context.newPage();
    await page.goto(`${appOrigin}/admin/cancellations/${requestId}`);
    await expect(page.getByRole("heading", { name: "completed", exact: true })).toBeVisible();
    await page.getByLabel("Message to the guest").fill("The Table has already finished.");
    await page.getByRole("button", { name: "Decline", exact: true }).click();
    const confirmation = page.getByRole("alertdialog");
    await expect(confirmation).toContainText("Declining keeps their seat as it is (completed).");
    await expect(confirmation).toContainText("No refund will be added.");
    await expect(confirmation).not.toContainText("Seat stays active");
    await page.getByRole("button", { name: /^(Approve|Decline)$/ }).last().click();
    await expect(page.getByRole("heading", { name: "Declined. Seat unchanged." })).toBeVisible();
    expect(decisionBody).toMatchObject({ decision: "deny", refundCents: 0 });
  } finally { await context.close(); }
});
