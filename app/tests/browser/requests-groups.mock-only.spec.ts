// Mock-only: proves the Requests page groups items (invited first, waiting, past) and shows one status per request.
import { expect, test } from "@playwright/test";

const origin = "http://127.0.0.1:8086";
const table = (id: string, title: string) => ({ tableId: id, title, localDate: "2026-12-12", startLocalTime: "19:00", neighborhood: "Inman Park", isCurrentlyPublished: true });
const items = [
  { requestId: "f0000000-0000-4000-8000-000000000001", tableId: "f0000000-0000-4000-8000-000000000011", state: "pending", createdAt: "2026-11-10T15:00:00Z", updatedAt: "2026-11-10T15:00:00Z", declineReason: null, table: table("f0000000-0000-4000-8000-000000000011", "Garden Table"), tableInvitation: { invitationId: "f0000000-0000-4000-8000-000000000021", state: "active", deliveryState: "accepted", createdAt: "2026-11-11T00:00:00Z" } },
  { requestId: "f0000000-0000-4000-8000-000000000002", tableId: "f0000000-0000-4000-8000-000000000012", state: "pending", createdAt: "2026-11-12T15:00:00Z", updatedAt: "2026-11-12T15:00:00Z", declineReason: null, table: table("f0000000-0000-4000-8000-000000000012", "River Table"), tableInvitation: null },
  { requestId: "f0000000-0000-4000-8000-000000000003", tableId: "f0000000-0000-4000-8000-000000000013", state: "withdrawn", createdAt: "2026-11-01T15:00:00Z", updatedAt: "2026-11-12T15:00:00Z", declineReason: null, table: table("f0000000-0000-4000-8000-000000000013", "Old Table"), tableInvitation: null },
  { requestId: "f0000000-0000-4000-8000-000000000004", tableId: "f0000000-0000-4000-8000-000000000014", state: "declined", declineReason: "This table filled up.", createdAt: "2026-11-02T15:00:00Z", updatedAt: "2026-11-02T15:00:00Z", table: table("f0000000-0000-4000-8000-000000000014", "Full Table"), tableInvitation: null },
];

test("invited first, then waiting, then past; one status per request; no email status", async ({ page, context }) => {
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname === "/api/me/requests") return route.fulfill({ json: { ok: true, data: { items, nextCursor: null }, correlationId: "m" } });
    if (url.pathname.startsWith("/api/")) return route.fulfill({ status: 404, json: {} });
    return route.continue();
  });
  await page.goto("/requests");
  await expect(page.getByRole("heading", { name: "Requests", exact: true })).toBeVisible();
  await expect(page.locator(".req-groups")).toBeVisible();
  const headings = await page.locator(".req-groups h2").allTextContents();
  expect(headings).toEqual(["Invited — pay to confirm", "Waiting to hear"]);
  await expect(page.getByRole("link", { name: "Pay to confirm" })).toHaveAttribute("href", "/invitations/f0000000-0000-4000-8000-000000000021");
  const waiting = page.locator(".req-card").filter({ hasText: "River Table" });
  await expect(waiting.getByText("Requested", { exact: true })).toBeVisible();
  await expect(waiting.getByRole("button", { name: "Withdraw request" })).toBeVisible();
  await expect(page.getByText("Email provider accepted")).toHaveCount(0);
  await expect(page.getByText("separate offer")).toHaveCount(0);
  await page.getByText("Past requests (2)").click();
  await expect(page.locator(".req-card").filter({ hasText: "Old Table" }).getByText("Withdrawn", { exact: true })).toBeVisible();
  await expect(page.getByText("This table filled up.")).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
