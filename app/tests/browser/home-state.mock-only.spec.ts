// Mock-only: every /api response is intercepted. Proves Home's next-step rules and failure handling, not backend behavior.
import { expect, test, type BrowserContext } from "@playwright/test";

const origin = "http://127.0.0.1:8086";
type Json = unknown;
const ok = (data: Json) => ({ status: 200, json: { ok: true, data, correlationId: "mock" } });
const down = { status: 503, json: { ok: false, error: { code: "temporarily_unavailable", safeMessage: "Unavailable", retryable: true } } };
const table = { tableId: "t1", title: "Garden Table", localDate: "2026-12-12", startLocalTime: "19:00", neighborhood: "Inman Park", isCurrentlyPublished: true, startsAt: "2026-12-13T00:00:00.000Z" };
const profile = ok({ firstName: "Maya" });
const invite = ok({ items: [{ requestId: "r1", state: "pending", table, tableInvitation: { invitationId: "i1", state: "active", deliveryState: "accepted", createdAt: "2026-11-10T00:00:00Z" } }], nextCursor: null });
const noRequests = ok({ items: [], nextCursor: null });
const seat = ok({ items: [{ seatId: "s1", state: "confirmed", participationState: "current", table }], pendingCheckouts: [], nextCursor: null });
const noSeats = ok({ items: [], pendingCheckouts: [], nextCursor: null });

async function mock(context: BrowserContext, r: { profile: unknown; requests: unknown; seats: unknown }) {
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (!url.pathname.startsWith("/api/")) return route.continue();
    if (url.pathname === "/api/member/home") return route.fulfill({ json: { member: { email: "maya@example.test", admissionState: "activated" } } });
    const map: Record<string, unknown> = { "/api/member/profile": r.profile, "/api/me/requests": r.requests, "/api/me/seats": r.seats };
    return route.fulfill((map[url.pathname] as never) ?? { status: 404, json: {} });
  });
}

test("with no invitation or seat, Home says staff will email a seat, with no browse or profile-review step", async ({ page, context }) => {
  await mock(context, { profile, requests: noRequests, seats: noSeats });
  await page.goto("/member");
  await expect(page.getByRole("heading", { name: "Welcome back, Maya." })).toBeVisible();
  await expect(page.getByText("No evenings yet")).toBeVisible();
  await expect(page.getByText("We’ll email you when we have a seat for you at a table.")).toBeVisible();
  await expect(page.getByText(/Complete your profile|reviewing your profile|Browse tables/)).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Tables", exact: true })).toHaveCount(0);
});

test("an open invitation outranks everything", async ({ page, context }) => {
  await mock(context, { profile, requests: invite, seats: seat });
  await page.goto("/member");
  await expect(page.getByRole("heading", { name: "You’re invited to Garden Table" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Review invitation/ })).toHaveAttribute("href", "/invitations/i1");
  await expect(page.getByText("Invited", { exact: true })).toBeVisible();
});

test("a guest with a seat sees their next evening", async ({ page, context }) => {
  await mock(context, { profile, requests: noRequests, seats: seat });
  await page.goto("/member");
  await expect(page.getByRole("heading", { name: "Your next evening: Garden Table" })).toBeVisible();
  await expect(page.getByRole("link", { name: /View seat/ })).toHaveAttribute("href", "/my-seats/s1");
  await expect(page.getByText("Sat, Dec 12 · 7:00 PM · Inman Park").first()).toBeVisible();
});

test("when the profile request fails, Home still shows the seat with a generic greeting", async ({ page, context }) => {
  await mock(context, { profile: down, requests: noRequests, seats: seat });
  await page.goto("/member");
  await expect(page.getByRole("heading", { name: "Your next evening: Garden Table" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Welcome back." })).toBeVisible();
});

test("when everything fails, Home shows a plain My Seats link, not a false empty state", async ({ page, context }) => {
  await mock(context, { profile: down, requests: down, seats: down });
  await page.goto("/member");
  await expect(page.getByRole("heading", { name: "Welcome back." })).toBeVisible();
  await expect(page.getByText("No evenings yet")).toHaveCount(0);
  await expect(page.locator(".home-links").getByRole("link", { name: "My Seats" })).toBeVisible();
});
