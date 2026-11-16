// Mock-only: proves the Waitlist toolbar has no Search/refresh buttons, filters apply on Enter/change, and rows say "Approve…".
import { expect, test } from "@playwright/test";

const origin = "http://127.0.0.1:8086";
const item = (n: number, first: string, state: string) => ({ id: `c1000000-0000-4000-8000-${String(n).padStart(12, "0")}`, firstName: first, lastName: "Chen", emailNormalized: `${first.toLowerCase()}@example.test`, neighborhood: "Inman Park", identity: "Woman", openTo: ["Men"], receivedAt: "2026-11-14T18:00:00Z", admissionState: state, latestDelivery: null });
const seen: string[] = [];

test("waitlist: Enter searches, neighborhood applies at once, one Approve… action, no Search button", async ({ page, context }) => {
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname === "/api/admin/waitlist") { seen.push(url.search); return route.fulfill({ json: { items: [item(1, "Maya", "none"), item(2, "Noah", "activated")], nextCursor: null } }); }
    if (url.pathname.startsWith("/api/")) return route.fulfill({ status: 404, json: {} });
    return route.continue();
  });
  await page.goto("/admin/waitlist");
  await expect(page.getByRole("heading", { name: "Waitlist", level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: "Search", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Refresh waitlist" })).toHaveCount(0);
  await expect(page.getByText("Live list")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Refresh", exact: true })).toBeVisible();
  const maya = page.getByRole("row").filter({ hasText: "maya@example.test" });
  await expect(maya.getByRole("button", { name: "Approve…" })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "noah@example.test" }).getByRole("button")).toHaveCount(0);
  await page.getByRole("searchbox", { name: "Search waitlist" }).fill("maya");
  await page.getByRole("searchbox", { name: "Search waitlist" }).press("Enter");
  await expect.poll(() => seen.some((q) => q.includes("query=maya"))).toBe(true);
  await page.getByLabel("Neighborhood").selectOption("Chamblee");
  await expect.poll(() => seen.some((q) => q.includes("neighborhood=Chamblee"))).toBe(true);
  await maya.getByRole("button", { name: "Approve…" }).click();
  await expect(page.getByRole("dialog", { name: /^Approve Maya Chen/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve and send link" })).toBeVisible();
});
