// Mock-only: proves the Tables list (week groups, whole-card links, auto-applied filters) and Table detail (decision card), not backend behavior.
import { expect, test, type BrowserContext } from "@playwright/test";

const origin = "http://127.0.0.1:8086";
const id = (n: number) => `f1000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const listItem = (n: number, title: string, localDate: string, ownRequest: unknown = null) => ({ tableId: id(n), title, localDate, startLocalTime: "19:00", neighborhood: "Inman Park", seatPriceCents: 2500, currency: "USD", ownRequest });
const own = (n: number, state: string) => ({ requestId: id(100 + n), tableId: id(n), state, declineReason: null, createdAt: "2026-11-10T15:00:00Z", updatedAt: "2026-11-10T15:00:00Z" });
const stops = [{ role: "drinks", venueName: "Juniper Room", venueAddress: "10 Auburn Ave", minutesFromStart: 0, publicNotes: "Meet inside." }, { role: "dinner", venueName: "Garden Table", venueAddress: "22 Edgewood Ave", minutesFromStart: 45, publicNotes: "" }, { role: "dessert", venueName: "Little Tart", venueAddress: "68 Georgia Ave", minutesFromStart: 115, publicNotes: "" }];
const seen: string[] = [];

async function mock(context: BrowserContext, detailOwn: unknown = null) {
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname === "/api/tables") {
      seen.push(url.search);
      const all = [listItem(1, "Garden Table", "2099-06-03", own(1, "pending")), listItem(2, "Riverside Table", "2099-06-10"), listItem(3, "Chamblee Table", "2099-06-12")];
      const items = url.searchParams.get("neighborhood") === "Nowhere" ? [] : all;
      return route.fulfill({ json: { ok: true, data: { items, nextCursor: null }, correlationId: "m" } });
    }
    if (url.pathname === `/api/tables/${id(1)}`) {
      return route.fulfill({ json: { ok: true, data: { view: "member", table: { tableId: id(1), title: "Garden Table", localDate: "2099-06-03", startLocalTime: "19:00", neighborhood: "Inman Park", stops, seatPriceCents: 2500, currency: "USD", ownRequest: detailOwn } }, correlationId: "m" } });
    }
    if (url.pathname.startsWith("/api/")) return route.fulfill({ status: 404, json: {} });
    return route.continue();
  });
}

test("list groups by week, whole cards are links, request status shows, filters apply without a button", async ({ page, context }) => {
  await mock(context);
  await page.goto("/tables");
  await expect(page.getByRole("heading", { name: "Tables", exact: true, level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: "Apply filters" })).toHaveCount(0);
  await expect(page.locator("a.tbl-card").first()).toBeVisible();
  const weeks = await page.locator(".tbl-week h2").allTextContents();
  expect(weeks).toEqual(["Week of Jun 1", "Week of Jun 8"]);
  const card = page.locator("a.tbl-card").filter({ hasText: "Garden Table" });
  await expect(card).toHaveAttribute("href", `/tables/${id(1)}`);
  await expect(card.getByText("Requested", { exact: true })).toBeVisible();
  await expect(card.getByText("$25")).toBeVisible();
  await expect(page.getByRole("link", { name: "View Table" })).toHaveCount(0);
  // typing a neighborhood applies after a short pause and shows Clear
  await page.getByLabel("Neighborhood").fill("Nowhere");
  await expect(page.getByRole("heading", { name: "No tables match those dates" })).toBeVisible();
  expect(seen.some((q) => q.includes("neighborhood=Nowhere"))).toBe(true);
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page.locator("a.tbl-card")).toHaveCount(3);
});

test("a failed list load hides the filters and offers retry", async ({ page, context }) => {
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname.startsWith("/api/")) return route.fulfill({ status: 503, json: { ok: false, error: { code: "temporarily_unavailable", safeMessage: "Unavailable", retryable: true } } });
    return route.continue();
  });
  await page.goto("/tables");
  await expect(page.getByRole("heading", { name: "We couldn’t load tables" })).toBeVisible();
  await expect(page.getByLabel("Neighborhood")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
});

test("detail: plain title block, clock-time itinerary, one request action, nothing charged now", async ({ page, context }) => {
  await mock(context);
  await page.goto(`/tables/${id(1)}`);
  await expect(page.getByRole("heading", { name: "Garden Table", level: 1 })).toBeVisible();
  await expect(page.getByText("Wed, Jun 3, 2099 · 7:00 PM · Inman Park").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "The evening" })).toBeVisible();
  await expect(page.getByText("Dinner · 7:45 PM")).toBeVisible();
  await expect(page.getByText("A FIFTH WHEEL EVENING")).toHaveCount(0);
  await expect(page.getByText("Nothing is charged now.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Request a seat", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /See your Requests/ })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("detail: a pending request shows the status, Withdraw, and a link to Requests", async ({ page, context }) => {
  await mock(context, own(1, "pending"));
  await page.goto(`/tables/${id(1)}`);
  await expect(page.getByText("Request received — awaiting review.")).toBeVisible();
  await expect(page.getByRole("link", { name: "View in Requests" })).toHaveAttribute("href", "/requests");
  await expect(page.getByRole("button", { name: "Withdraw request" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Request a seat", exact: true })).toHaveCount(0);
});
