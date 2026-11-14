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
  await expect(page.getByRole("button", { name: "Record proceed" }).nth(1)).toBeDisabled();
  await page.screenshot({ path: `${shots}/w08-table-decisions-desktop-mock-only.png`, fullPage: true });
  await page.getByRole("button", { name: "Record proceed" }).first().click();
  await page.getByRole("button", { name: "Confirm proceed" }).click();
  await expect(page.getByText("Proceeding", { exact: true })).toBeVisible();
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
  canCheckIn = true;
  await page.reload();
  await page.getByRole("button", { name: "Check in" }).first().click();
  await expect(page.getByText(/Checked in/)).toBeVisible();
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
  await expect(page.getByRole("heading", { name: "No venue assigned" })).toBeVisible();
});
