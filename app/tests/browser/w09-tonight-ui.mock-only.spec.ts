// Mock-only: every /api response is intercepted. Proves screens, states and request shapes, not privacy enforcement (that lives in the DB harness).
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const origin = "http://127.0.0.1:8086";
const tableId = "e0820000-0000-4000-8000-000000000041";
const [guestB, guestC] = ["e0820000-0000-4000-8000-000000000161", "e0820000-0000-4000-8000-000000000162"];
const venueA = "e0820000-0000-4000-8000-000000000300";
const shots = resolve("docs/implementation/screenshots");
type Handler = (body: unknown) => { status?: number; json: unknown };
const ok = (data: unknown) => ({ json: { ok: true, data, correlationId: "mock" } });
const fail = (status: number, reason: string | null, message: string) => ({ status, json: { ok: false, error: { code: "x", reason, safeMessage: message } } });

async function mock(context: BrowserContext, routes: Record<string, Handler>, seen: Array<{ path: string; body: unknown }> = []) {
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (!url.pathname.startsWith("/api/")) return route.continue();
    const body = route.request().postData() ? JSON.parse(route.request().postData() as string) : undefined;
    seen.push({ path: url.pathname, body });
    const handler = routes[`${route.request().method()} ${url.pathname}`];
    if (!handler) return route.fulfill({ status: 404, json: { ok: false, error: { code: "not_found", safeMessage: "Not mocked" } } });
    const result = handler(body);
    return route.fulfill({ status: result.status ?? 200, json: result.json });
  });
}
const base = `/api/me/tables/${tableId}`;
const table = { tableId, title: "Autumn Table", localDate: "2026-12-12", startLocalTime: "19:00", neighborhood: "Inman Park",
  stops: [{ role: "drinks", venueName: "Bar One", venueAddress: "1 Main St", minutesFromStart: 0, publicNotes: null }, { role: "dinner", venueName: "Grill Two", venueAddress: "2 Main St", minutesFromStart: 60, publicNotes: "Quiet corner" }] };
const tonight = (vote: object, checkedInAt: string | null = "2026-12-12T00:05:00Z") => ok({ table, attendance: { checkedInAt }, vote: { opensAt: "2026-12-12T01:30:00Z", closesAt: "2026-12-12T02:00:00Z", eligible: null, submittedAt: null, candidates: [], ...vote } });
async function noOverflow(page: Page) { expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true); }

test("before voting opens there is no ballot and the page explains who can vote", async ({ page, context }) => {
  await mkdir(shots, { recursive: true });
  await mock(context, { [`GET ${base}/tonight`]: () => tonight({ state: "wait" }) });
  await page.goto(`/tonight/${tableId}`);
  await expect(page.getByText(/Voting opens at .* for guests who were checked in/)).toBeVisible();
  await expect(page.getByRole("radio")).toHaveCount(0);
  await expect(page.getByText("Quiet corner")).toBeVisible();
  await page.screenshot({ path: `${shots}/w09-tonight-wait-desktop-mock-only.png`, fullPage: true });
});

test("open ballot: review, confirm, one POST with the exact body, then a recorded receipt", async ({ page, context }) => {
  const seen: Array<{ path: string; body: unknown }> = [];
  let submittedAt: string | null = null;
  await mock(context, {
    [`GET ${base}/tonight`]: () => tonight({ state: "open", eligible: true, submittedAt, candidates: [{ guestId: guestB, firstName: "Noah" }, { guestId: guestC, firstName: "Olivia" }] }),
    [`POST ${base}/ballot`]: () => { submittedAt = "2026-12-12T01:40:00Z"; return ok({ submittedAt }); },
  }, seen);
  await page.goto(`/tonight/${tableId}`);
  await expect(page.getByRole("radio")).toHaveCount(3);
  await expect(page.getByRole("button", { name: "Review choice" })).toBeDisabled();
  await page.getByLabel("Noah").check();
  await page.screenshot({ path: `${shots}/w09-tonight-ballot-desktop-mock-only.png`, fullPage: true });
  await page.getByRole("button", { name: "Review choice" }).click();
  await expect(page.getByText("You can’t change it afterwards.")).toBeVisible();
  await page.getByRole("button", { name: "Yes, submit" }).click();
  await expect(page.getByText(/Your choice was recorded/)).toBeVisible();
  expect(seen.filter((s) => s.path.endsWith("/ballot")).map((s) => s.body)).toEqual([{ choiceGuestId: guestB }]);
  await page.setViewportSize({ width: 390, height: 844 });
  await noOverflow(page);
  await page.screenshot({ path: `${shots}/w09-tonight-ballot-390px-mock-only.png`, fullPage: true });
});

test("Nobody is a real choice and a server refusal is shown, not swallowed", async ({ page, context }) => {
  const seen: Array<{ path: string; body: unknown }> = [];
  await mock(context, {
    [`GET ${base}/tonight`]: () => tonight({ state: "open", eligible: true, candidates: [{ guestId: guestB, firstName: "Noah" }] }),
    [`POST ${base}/ballot`]: () => fail(409, "voting_closed", "That action is not available right now."),
  }, seen);
  await page.goto(`/tonight/${tableId}`);
  await page.getByLabel("Nobody").check();
  await page.getByRole("button", { name: "Review choice" }).click();
  await page.getByRole("button", { name: "Yes, submit" }).click();
  await expect(page.getByText("Voting has closed.")).toBeVisible();
  expect(seen.find((s) => s.path.endsWith("/ballot"))?.body).toEqual({ choiceGuestId: null });
});

test("a guest who was not eligible sees no ballot and no result", async ({ page, context }) => {
  await mock(context, { [`GET ${base}/tonight`]: () => tonight({ state: "open", eligible: false }, null) });
  await page.goto(`/tonight/${tableId}`);
  await expect(page.getByText(/Voting is limited to guests who were checked in before it opened/)).toBeVisible();
  await expect(page.getByRole("radio")).toHaveCount(0);
});

for (const scenario of [{ name: "mutual match", match: { guestId: guestB, firstName: "Noah" }, text: "You and Noah chose each other." }, { name: "no match", match: null, text: "No mutual connection this time." }]) {
  test(`closed: ${scenario.name} reveal, rating and private report`, async ({ page, context }) => {
    const seen: Array<{ path: string; body: unknown }> = [];
    let rated = false;
    const recap = () => ok({ tableTitle: "Autumn Table", canSubmit: true, venues: [{ venueId: venueA, name: "Bar One" }], rating: rated ? { overall: 4, venueScores: { [venueA]: 5 }, note: "Lovely" } : null,
      attendees: [{ guestId: guestB, firstName: "Noah" }], reports: [] });
    await mock(context, {
      [`GET ${base}/tonight`]: () => tonight({ state: "closed", eligible: true, submittedAt: "2026-12-12T01:40:00Z" }),
      [`GET ${base}/reveal`]: () => ok({ state: "revealed", match: scenario.match }),
      [`GET ${base}/recap`]: recap,
      [`POST ${base}/rating`]: () => { rated = true; return ok({ overall: 4 }); },
      [`POST ${base}/conduct-report`]: () => ok({ reportId: "r1", createdAt: "2026-12-12T02:30:00Z", status: "new" }),
    }, seen);
    await page.goto(`/tonight/${tableId}`);
    await expect(page.getByText(scenario.text)).toBeVisible();
    await expect(page.getByText(/Hosts and restaurants never see them|call 911/).first()).toBeVisible();
    await page.getByLabel("4", { exact: true }).check();
    await page.getByLabel(/Bar One/).selectOption("5");
    await page.getByLabel(/Anything you’d like to add/).fill("Lovely");
    await page.getByRole("button", { name: "Save feedback" }).click();
    await expect(page.getByText(/Saved\. You can change it any time/)).toBeVisible();
    expect(seen.find((s) => s.path.endsWith("/rating"))?.body).toEqual({ overall: 4, venueScores: { [venueA]: 5 }, note: "Lovely" });
    await page.getByLabel("About someone (optional)").selectOption(guestB);
    await page.getByLabel("What happened?").fill("A private concern");
    await page.getByRole("button", { name: "Send private report" }).click();
    await expect(page.getByText(/Your report was received/)).toBeVisible();
    const report = seen.find((s) => s.path.endsWith("/conduct-report"))?.body as Record<string, unknown>;
    expect(report).toMatchObject({ subjectGuestId: guestB, body: "A private concern" });
    expect(typeof report.operationId).toBe("string");
    if (scenario.match) await page.screenshot({ path: `${shots}/w09-tonight-closed-desktop-mock-only.png`, fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await noOverflow(page);
  });
}

test("expired results say unavailable, not no match; non-seat holders get a refusal page", async ({ page, context }) => {
  await mock(context, { [`GET ${base}/tonight`]: () => tonight({ state: "closed", eligible: true }), [`GET ${base}/reveal`]: () => ok({ state: "results_unavailable", match: null }),
    [`GET ${base}/recap`]: () => fail(404, null, "That could not be found.") });
  await page.goto(`/tonight/${tableId}`);
  await expect(page.getByText("Results from this evening are no longer available.")).toBeVisible();
  await expect(page.getByText("No mutual connection this time.")).toHaveCount(0);
});

test("a guest without a Seat is refused", async ({ page, context }) => {
  await mock(context, { [`GET ${base}/tonight`]: () => fail(404, null, "That could not be found.") });
  await page.goto(`/tonight/${tableId}`);
  await expect(page.getByRole("heading", { name: "Not available" })).toBeVisible();
});

test("admin conduct reports: triage posts exact status/hold, ratings suppress small groups", async ({ page, context }) => {
  const seen: Array<{ path: string; body: unknown }> = [];
  const reportId = "e0820000-0000-4000-8000-000000000999";
  await mock(context, {
    "GET /api/admin/conduct-reports": () => ok({ items: [{ reportId, tableId, tableTitle: "Autumn Table", status: "new", held: false, createdAt: "2026-12-12T03:00:00Z", author: "Maya Chen", subject: "Noah James", body: "A private concern" }] }),
    "GET /api/admin/rating-aggregates": () => ok({ tables: [{ tableId, title: "Autumn Table", localDate: "2026-12-12", responses: 2, overallAverage: null }] }),
    [`POST /api/admin/conduct-reports/${reportId}`]: () => ok({ reportId, status: "reviewing", held: false }),
  }, seen);
  await page.goto("/admin/conduct-reports");
  await expect(page.getByText("A private concern")).toBeVisible();
  await expect(page.getByText("Fewer than 3 responses")).toBeVisible();
  await page.getByLabel("Status").selectOption("reviewing");
  await expect.poll(() => seen.filter((s) => s.path.endsWith(reportId)).length).toBe(1);
  expect(seen.find((s) => s.path.endsWith(reportId))?.body).toEqual({ status: "reviewing", held: false });
  await page.screenshot({ path: `${shots}/w09-admin-conduct-reports-desktop-mock-only.png`, fullPage: true });
});
