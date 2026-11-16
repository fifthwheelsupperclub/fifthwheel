// Mock-only: every /api response is intercepted. Proves screens, states and request shapes, not backend permissions or persistence.
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const origin = "http://127.0.0.1:8086";
const tableId = "e0800000-0000-4000-8000-000000000041", seatA = "e0800000-0000-4000-8000-000000000111", seatB = "e0800000-0000-4000-8000-000000000112";
const requestId = "e0800000-0000-4000-8000-000000000121", hostId = "e0800000-0000-4000-8000-000000000002", venueId = "e0800000-0000-4000-8000-000000000060";
const shots = resolve("docs/implementation/screenshots");
type Handler = (body: unknown) => { status?: number; json: unknown };

async function mock(context: BrowserContext, routes: Record<string, Handler>, seen: Array<{ path: string; body: unknown }>) {
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (!url.pathname.startsWith("/api/")) return route.continue();
    const handler = routes[`${route.request().method()} ${url.pathname}`];
    const body = route.request().postData() ? JSON.parse(route.request().postData() as string) : undefined;
    seen.push({ path: url.pathname, body });
    if (!handler) return route.fulfill({ status: 404, json: { ok: false, error: { code: "not_found", safeMessage: "Not mocked" } } });
    const result = handler(body);
    return route.fulfill({ status: result.status ?? 200, json: result.json });
  });
}
const ok = (data: unknown) => ({ json: { ok: true, data, correlationId: "mock" } });
async function noOverflow(page: Page) { expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true); }

test("admin decisions: blockers disable proceed, a valid Table proceeds with one operation ID", async ({ page, context }) => {
  await mkdir(shots, { recursive: true });
  const seen: Array<{ path: string; body: unknown }> = [];
  let proceeded = false;
  await mock(context, {
    "GET /api/admin/table-decisions": () => ok({ items: [
      { tableId, title: "Autumn Table", localDate: "2026-12-12", startLocalTime: "19:00", neighborhood: "Inman Park", status: proceeded ? "proceeding" : "needs_decision", paidCount: 3, canProceed: true, blockers: [] },
      { tableId: "e0800000-0000-4000-8000-000000000042", title: "Thin Table", localDate: "2026-12-13", startLocalTime: "19:00", neighborhood: "Midtown", status: "needs_decision", paidCount: 2, canProceed: false, blockers: ["select_three_to_five"] }] }),
    [`POST /api/admin/tables/${tableId}/proceed`]: () => { proceeded = true; return ok({ tableId, state: "proceeding", paidCount: 3 }); },
  }, seen);
  await page.goto("/admin/table-decisions");
  await expect(page.getByRole("heading", { name: "Table decisions" })).toBeVisible();
  await expect(page.getByText("Needs 3–5 paid guests")).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirm table" })).toHaveCount(1);
  await page.screenshot({ path: `${shots}/w08-table-decisions-desktop-mock-only.png`, fullPage: true });
  await page.getByRole("button", { name: "Confirm table" }).first().click();
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(page.getByText("Confirmed", { exact: true })).toBeVisible();
  const post = seen.find((s) => s.path.endsWith("/proceed"));
  expect(Object.keys(post?.body as object)).toEqual(["operationId"]);
  await page.setViewportSize({ width: 390, height: 844 });
  await noOverflow(page);
  await page.screenshot({ path: `${shots}/w08-table-decisions-390px-mock-only.png`, fullPage: true });
});

test("host attendance: check-in, flag, and the closed-until-proceeding state", async ({ page, context }) => {
  const seen: Array<{ path: string; body: unknown }> = [];
  let checkedIn = false, flagged = false, canCheckIn = false;
  const attendance = () => ok({ table: { tableId, title: "Autumn Table", localDate: "2026-12-12", startLocalTime: "19:00", neighborhood: "Inman Park", runtimeState: "open" },
    guests: [{ seatId: seatA, firstName: "Maya", seatState: "confirmed", checkedInAt: checkedIn ? "2026-12-12T23:05:00Z" : null, cancellationRequestId: null, cancellationFlagged: false },
      { seatId: seatB, firstName: "Noah", seatState: "cancellation_requested", checkedInAt: null, cancellationRequestId: requestId, cancellationFlagged: flagged }], canCheckIn });
  await mock(context, {
    [`GET /api/host/tables/${tableId}/attendance`]: attendance,
    [`POST /api/host/tables/${tableId}/check-in`]: () => { checkedIn = true; return ok({ seatId: seatA }); },
    [`POST /api/host/cancellations/${requestId}/flag`]: () => { flagged = true; return ok({ requestId, flagged: true }); },
  }, seen);
  await page.goto(`/host/attendance/${tableId}`);
  await expect(page.getByText("Check-in opens once staff record")).toBeVisible();
  await expect(page.getByRole("button", { name: "Check in" }).first()).toBeDisabled();
  await expect(page.getByText("Maya")).toBeVisible();
  await expect(page.getByText("0 of 2")).toBeVisible();
  canCheckIn = true;
  await page.reload();
  await page.getByRole("button", { name: "Check in" }).first().click();
  await expect(page.getByText(/Checked in/)).toBeVisible();
  await expect(page.getByText("1 of 2")).toBeVisible();
  await expect(page.getByText("Flag a cancellation request to bring it")).toHaveCount(0);
  await page.getByRole("button", { name: "Flag for admin" }).click();
  await expect(page.getByText(/flagged for admin/)).toBeVisible();
  expect(seen.find((s) => s.path.endsWith("/check-in"))?.body).toEqual({ seatId: seatA });
  await page.screenshot({ path: `${shots}/w08-host-attendance-desktop-mock-only.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await noOverflow(page);
  await page.screenshot({ path: `${shots}/w08-host-attendance-390px-mock-only.png`, fullPage: true });
});

test("host attendance shows a denial, not data, when the API refuses", async ({ page, context }) => {
  await mock(context, { [`GET /api/host/tables/${tableId}/attendance`]: () => ({ status: 403, json: { ok: false, error: { code: "forbidden", safeMessage: "You do not have access to this." } } }) }, []);
  await page.goto(`/host/attendance/${tableId}`);
  await expect(page.getByRole("heading", { name: "You don’t have access to this" })).toBeVisible();
});

test("staff assignments: contact save and assignment toggle send exact bodies", async ({ page, context }) => {
  const seen: Array<{ path: string; body: unknown }> = [];
  let assigned = false;
  await mock(context, {
    "GET /api/admin/staff-assignments": () => ok({ staff: [{ userId: hostId, role: "host", email: "host@example.com", displayName: "Hannah Host", businessContact: "hannah@host.example", tableIds: assigned ? [tableId] : [], venueIds: [] }],
      tables: [{ tableId, title: "Autumn Table", localDate: "2026-12-12" }], venues: [{ venueId, name: "Test Bar" }] }),
    "POST /api/admin/staff-assignments/host": () => { assigned = true; return ok({}); }, "POST /api/admin/staff-assignments/contact": () => ok({}),
  }, seen);
  await page.goto("/admin/staff-assignments");
  await page.getByRole("checkbox", { name: /Autumn Table/ }).click();
  await expect(page.getByRole("checkbox", { name: /Autumn Table/ })).toBeChecked();
  await page.getByRole("button", { name: "Save contact" }).click();
  await expect.poll(() => seen.filter((s) => s.path.includes("staff-assignments/")).length).toBe(2);
  expect(seen.find((s) => s.path.endsWith("/host"))?.body).toEqual({ tableId, userId: hostId, assigned: true });
  expect(seen.find((s) => s.path.endsWith("/contact"))?.body).toEqual({ userId: hostId, displayName: "Hannah Host", businessContact: "hannah@host.example" });
  await page.screenshot({ path: `${shots}/w08-staff-assignments-desktop-mock-only.png`, fullPage: true });
});

test("restaurant workspace shows service counts and host contact without guest data", async ({ page, context }) => {
  await mock(context, { "GET /api/restaurant/workspace": () => ok({ venues: [{ venueId, name: "Test Bar" }], selected: venueId,
    services: [{ tableId, title: "Autumn Table", role: "drinks", serviceLocalDate: "2026-12-12", serviceLocalTime: "19:00", paidCount: 4, status: "proceeding", notes: "Reserve the back table",
      hostContacts: [{ displayName: "Hannah Host", businessContact: "hannah@host.example" }] }] }) }, []);
  await page.goto("/restaurant");
  await expect(page.getByRole("heading", { name: "Service times", level: 1 })).toBeVisible();
  await expect(page.getByText("4 guests expected")).toBeVisible();
  await expect(page.getByText(/hannah@host.example/)).toBeVisible();
  await expect(page.getByText("Reserve the back table")).toBeVisible();
  await page.screenshot({ path: `${shots}/w08-restaurant-desktop-mock-only.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await noOverflow(page);
  await page.screenshot({ path: `${shots}/w08-restaurant-390px-mock-only.png`, fullPage: true });
});

test("restaurant workspace with no venue shows an empty state", async ({ page, context }) => {
  await mock(context, { "GET /api/restaurant/workspace": () => ok({ venues: [], selected: null, services: [] }) }, []);
  await page.goto("/restaurant");
  await expect(page.getByRole("heading", { name: "No venue yet" })).toBeVisible();
});

const invitationId = "e0800000-0000-4000-8000-000000000081";
const invitationItem = { invitationId, invitationState: "active", createdAt: "2026-11-10T15:00:00.000Z", guest: { guestId: "e0800000-0000-4000-8000-000000000031", displayName: "Maya Chen" },
  table: { tableId, title: "Autumn Table", localDate: "2026-12-12", startLocalTime: "19:00", neighborhood: "Inman Park" },
  delivery: { outboxId: "e0800000-0000-4000-8000-000000000091", state: "delivered", attemptCount: 1, queuedAt: "2026-11-10T15:00:00.000Z", nextAttemptAt: "2026-11-10T15:00:00.000Z", lastAttemptAt: "2026-11-10T15:01:00.000Z", safeErrorCode: null }, attempts: [] };
const suggestion = (remainingValid: boolean) => ok({ invitationId, tableId, expectedRevision: 2, remainingValid, candidate: null });

for (const scenario of [
  { name: "paid guest: refund owed, remaining group still valid", seatCancelled: true, refundCents: 1500, needsReview: false, text: "Seat cancelled. $15.00 refund owed. Send it from Refunds." },
  { name: "invalid remaining group is flagged for review", seatCancelled: true, refundCents: 1500, needsReview: true, text: "Seat cancelled. $15.00 refund owed. Send it from Refunds." },
]) {
  test(`remove from Table: ${scenario.name}`, async ({ page, context }) => {
    const seen: Array<{ path: string; body: unknown }> = [];
    await mock(context, {
      "GET /api/admin/table-invitations": () => ok({ items: [invitationItem], nextCursor: null }),
      [`GET /api/admin/invitations/${invitationId}/replacement-suggestion`]: () => suggestion(!scenario.needsReview),
      [`POST /api/admin/invitations/${invitationId}/remove`]: () => ok({ removal: { invitationId, guestId: "x", seatCancelled: scenario.seatCancelled, refundCents: scenario.refundCents },
        replacement: { state: "none", invitationId: null }, roster: { revision: 3, valid: !scenario.needsReview, needsReview: scenario.needsReview } }),
    }, seen);
    await page.goto("/admin/table-invitations");
    await page.getByRole("button", { name: "Remove from Table…" }).click();
    const dialog = page.getByRole("dialog", { name: "Remove Maya Chen from this table?" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/instead\?|Remove and invite/)).toHaveCount(0);
    await dialog.getByLabel(/^Refund/).fill("15");
    await page.screenshot({ path: `${shots}/w08-remove-dialog-desktop-mock-only.png` });
    await dialog.getByRole("button", { name: "Remove", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Maya Chen was removed" })).toBeVisible();
    await expect(page.getByText(scenario.text)).toBeVisible();
    await expect(page.getByText(/To fill the seat, add someone from the/)).toBeVisible();
    await expect(page.getByRole("link", { name: "waitlist queue" })).toHaveAttribute("href", "/admin/waitlist");
    await expect(page.getByText(/no longer meets the roster rules/)).toHaveCount(scenario.needsReview ? 1 : 0);
    const post = seen.find((s) => s.path.endsWith("/remove"));
    expect(post?.body).toMatchObject({ expectedRevision: 2, refundCents: 1500 });
    expect(Object.keys(post?.body as object).sort()).toEqual(["expectedRevision", "operationId", "refundCents"]);
  });
}

test("remove from Table: a bad refund never posts; an unpaid guest's invitation is withdrawn", async ({ page, context }) => {
  const seen: Array<{ path: string; body: unknown }> = [];
  await mock(context, {
    "GET /api/admin/table-invitations": () => ok({ items: [invitationItem], nextCursor: null }),
    [`GET /api/admin/invitations/${invitationId}/replacement-suggestion`]: () => suggestion(true),
    [`POST /api/admin/invitations/${invitationId}/remove`]: () => ok({ removal: { invitationId, guestId: "x", seatCancelled: false, refundCents: 0 }, replacement: { state: "none", invitationId: null }, roster: { revision: 3, valid: true, needsReview: false } }),
  }, seen);
  await page.goto("/admin/table-invitations");
  await page.getByRole("button", { name: "Remove from Table…" }).click();
  await page.getByLabel(/^Refund/).fill("40");
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(page.getByText("Enter a refund between $0 and $25.")).toBeVisible();
  expect(seen.some((s) => s.path.endsWith("/remove"))).toBe(false);
  await page.getByLabel(/^Refund/).fill("0");
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(page.getByText("Invitation withdrawn.")).toBeVisible();
  expect(seen.find((s) => s.path.endsWith("/remove"))?.body).toEqual({ operationId: expect.any(String), expectedRevision: 2, refundCents: 0 });
});
