import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const appOrigin = "http://127.0.0.1:8086";
const seatId = "c4000000-0000-4000-8000-000000000001";
const pastSeatId = "c4000000-0000-4000-8000-000000000002";
const invitationId = "c5000000-0000-4000-8000-000000000001";
const tableId = "c6000000-0000-4000-8000-000000000001";
const screenshots = resolve("docs/implementation/screenshots");
const calendarHref = `/api/me/seats/${seatId}/calendar.ics`;

function table(id: string, title: string, localDate: string, startsAt: string) {
  return { tableId: id, title, localDate, startLocalTime: "19:00", timeZone: "America/New_York", startsAt, neighborhood: "Inman Park" };
}

const listBody = {
  ok: true,
  correlationId: "mock-w073-seat-list",
  data: {
    items: [
      { seatId, state: "confirmed", participationState: "current", createdAt: "2026-11-01T15:00:00.000Z",
        table: table(tableId, "Garden Table", "2026-12-12", "2026-12-13T00:00:00.000Z"),
        payment: { state: "paid", amountCents: 2500, currency: "USD", paidAt: "2026-11-01T15:02:00.000Z" }, refund: null,
        calendar: { available: true, href: calendarHref } },
      { seatId: pastSeatId, state: "cancelled", participationState: "past", createdAt: "2026-10-01T15:00:00.000Z",
        table: table("c6000000-0000-4000-8000-000000000002", "Autumn Table", "2026-10-10", "2026-10-10T23:00:00.000Z"),
        payment: { state: "refunded", amountCents: 2500, currency: "USD", paidAt: "2026-10-01T15:02:00.000Z" },
        refund: { state: "succeeded", amountCents: 2500, currency: "USD" }, calendar: { available: false, href: null } },
    ],
    pendingCheckouts: [
      { attemptId: "c7000000-0000-4000-8000-000000000001", invitationId, state: "unknown", nextAction: "contact_support",
        createdAt: "2026-11-12T16:00:00.000Z", holdUntil: "2026-11-12T16:30:00.000Z", price: { amountCents: 2500, currency: "USD" },
        payment: { state: "unknown", amountCents: 2500, currency: "USD", paidAt: null }, refund: null,
        table: table("c6000000-0000-4000-8000-000000000003", "Olive Table", "2026-11-20", "2026-11-21T00:00:00.000Z") },
      { attemptId: "c7000000-0000-4000-8000-000000000002", invitationId: "c5000000-0000-4000-8000-000000000002", state: "refund_pending", nextAction: "contact_support",
        createdAt: "2026-11-12T16:00:00.000Z", holdUntil: "2026-11-12T16:30:00.000Z", price: { amountCents: 2500, currency: "USD" },
        payment: { state: "refund_pending", amountCents: 2500, currency: "USD", paidAt: "2026-11-12T16:01:00.000Z" },
        refund: { state: "pending", amountCents: 2500, currency: "USD" },
        table: table("c6000000-0000-4000-8000-000000000004", "Late Charge Table", "2026-11-22", "2026-11-23T00:00:00.000Z") },
    ],
    nextCursor: null,
  },
};

const detailBody = {
  ok: true,
  correlationId: "mock-w073-seat-detail",
  data: {
    ...listBody.data.items[0],
    state: "cancellation_requested",
    table: { ...listBody.data.items[0].table, itinerary: [
      { role: "drinks", venueName: "Juniper Room", venueAddress: "10 Auburn Ave", minutesFromStart: 0, publicNotes: "Meet inside." },
      { role: "dinner", venueName: "Garden Table", venueAddress: "22 Edgewood Ave", minutesFromStart: 45, publicNotes: "Shared plates." },
      { role: "dessert", venueName: "Little Tart", venueAddress: "68 Georgia Ave", minutesFromStart: 115, publicNotes: "Optional dessert stop." },
    ] },
    payment: { ...listBody.data.items[0].payment, receipt: { state: "unavailable", url: null } },
    cancellation: { status: "pending", history: [{ requestId: "c8000000-0000-4000-8000-000000000001", status: "pending",
      requestedAt: "2026-11-10T14:00:00.000Z", decidedAt: null, safeReason: null }] },
  },
};

const cancelledDetailBody = {
  ok: true,
  correlationId: "mock-w073-cancelled-seat-detail",
  data: {
    ...detailBody.data,
    seatId: pastSeatId,
    state: "cancelled",
    participationState: "past",
    table: { ...listBody.data.items[1].table, itinerary: detailBody.data.table.itinerary },
    payment: { ...listBody.data.items[1].payment, receipt: { state: "unavailable", url: null } },
    refund: { state: "succeeded", amountCents: 2500, currency: "USD" },
    calendar: { available: false, href: null },
    cancellation: { status: "approved", history: [{ requestId: "c8000000-0000-4000-8000-000000000002", status: "approved",
      requestedAt: "2026-10-02T14:00:00.000Z", decidedAt: "2026-10-02T15:00:00.000Z", safeReason: "Approved by the team." }] },
  },
};

async function interceptApp(context: import("@playwright/test").BrowserContext, handlers: Readonly<Record<string, unknown>>) {
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== appOrigin) return route.abort();
    if (url.pathname === "/api/me/seats" && route.request().method() === "GET")
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(handlers.list ?? listBody) });
    if ([`/api/me/seats/${seatId}`, `/api/me/seats/${pastSeatId}`].includes(url.pathname) && route.request().method() === "GET")
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(url.pathname.endsWith(pastSeatId) ? (handlers.pastDetail ?? cancelledDetailBody) : (handlers.detail ?? detailBody)) });
    if (url.pathname.startsWith("/api/")) return route.abort();
    return route.continue();
  });
}

test("W07.3 mock-only My Seats groups actual Seat states separately from unresolved checkout", async ({ browser }) => {
  await mkdir(screenshots, { recursive: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await interceptApp(context, {});
  try {
    const page = await context.newPage();
    await page.goto(`${appOrigin}/my-seats`);
    await expect(page.getByRole("heading", { name: "My Seats", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Payments in progress" })).toBeVisible();
    await expect(page.getByText("Confirming payment", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Payment received; refund pending.", { exact: true })).toBeVisible();
    await expect(page.getByText("Amount received $25.00 · Refund $25.00 pending", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: /retry|pay again|continue checkout/i })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Upcoming Seats" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Past Seats" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Garden Table" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Autumn Table" })).toBeVisible();
    await expect(page.getByText("Confirmed", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: /Start another payment|Pay again/i })).toHaveCount(0);
    await page.screenshot({ path: resolve(screenshots, "w07-my-seats-list-desktop-mock-only.png"), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: resolve(screenshots, "w07-my-seats-list-390px-mock-only.png"), fullPage: true });
  } finally { await context.close(); }
});

test("W07.3 mock-only Seat detail shows persisted states, cancellation history and safe calendar route", async ({ browser }) => {
  await mkdir(screenshots, { recursive: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await interceptApp(context, {});
  try {
    const page = await context.newPage();
    await page.goto(`${appOrigin}/my-seats/${seatId}`);
    await expect(page.locator("h1")).toHaveText("Garden Table");
    await expect(page.getByRole("heading", { name: "Cancellation requested" })).toBeVisible();
    await expect(page.getByText("Your seat stays yours until we decide.")).toBeVisible();
    await expect(page.getByText("Receipt unavailable", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Waiting for review" })).toBeVisible();
    await expect(page.getByText("Juniper Room", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Add to calendar" })).toHaveAttribute("href", calendarHref);
    await expect(page.getByRole("button", { name: /cancel seat|request cancellation|refund/i })).toHaveCount(0);
    await page.screenshot({ path: resolve(screenshots, "w07-my-seat-detail-desktop-mock-only.png"), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: resolve(screenshots, "w07-my-seat-detail-390px-mock-only.png"), fullPage: true });
  } finally { await context.close(); }
});

test("W07.3 foreign Seat mock response stays denied and reveals no Seat data", async ({ browser }) => {
  const forbidden = { ok: false, correlationId: "mock-w073-forbidden", error: { code: "forbidden", safeMessage: "This Seat is not available to this account.", retryable: false, correlationId: "mock-w073-forbidden" } };
  const context = await browser.newContext();
  await interceptApp(context, { detail: forbidden });
  try {
    const page = await context.newPage();
    await page.goto(`${appOrigin}/my-seats/${seatId}`);
    await expect(page.getByRole("heading", { name: "This Seat is not available to this account" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Garden Table" })).toHaveCount(0);
  } finally { await context.close(); }
});

test("W07.3 mock-only cancelled Seat follows server calendar-unavailable state", async ({ browser }) => {
  const context = await browser.newContext();
  await interceptApp(context, {});
  try {
    const page = await context.newPage();
    await page.goto(`${appOrigin}/my-seats/${pastSeatId}`);
    await expect(page.locator("h1")).toHaveText("Autumn Table");
    await expect(page.getByRole("heading", { name: "Cancelled" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Add to calendar" })).toHaveCount(0);
  } finally { await context.close(); }
});
