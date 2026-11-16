// Mock-only: keyboard behavior that automated contrast/ARIA scans can't prove.
import { expect, test } from "@playwright/test";

const origin = "http://127.0.0.1:8086";
const signup = { id: "c1000000-0000-4000-8000-000000000001", firstName: "Maya", lastName: "Chen", emailNormalized: "maya@example.test", neighborhood: "Inman Park", identity: "Woman", openTo: ["Men"], receivedAt: "2026-11-14T18:00:00Z", admissionState: "none", latestDelivery: null };

test.beforeEach(async ({ context }) => {
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname === "/api/admin/waitlist") return route.fulfill({ json: { items: [signup], nextCursor: null } });
    if (url.pathname.startsWith("/api/")) return route.fulfill({ status: 503, json: { ok: false, error: { code: "temporarily_unavailable", safeMessage: "x", retryable: true } } });
    return route.continue();
  });
});

test("the skip link is the first tab stop and moves focus into the page content", async ({ page }) => {
  await page.goto("/admin/waitlist");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect.poll(() => page.evaluate(() => location.hash)).toBe("#content");
});

test("the approval dialog closes with Escape and returns focus to the button that opened it", async ({ page }) => {
  await page.goto("/admin/waitlist");
  const trigger = page.getByRole("button", { name: "Approve…" });
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: /^Approve Maya Chen/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("the staff menu drawer on a phone closes with Escape and gives focus back to Menu", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/admin/waitlist");
  await page.waitForLoadState("networkidle"); // let the page hydrate before using the keyboard
  const menu = page.getByRole("button", { name: "Menu" });
  await menu.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Admin navigation" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(menu).toBeFocused();
});

test("every guest bottom tab has a visible label and the current page is announced", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/tables");
  const tabs = page.getByRole("navigation", { name: "Member navigation (mobile)" }).getByRole("link");
  await expect(tabs).toHaveCount(4);
  await expect(page.getByRole("link", { name: "Tables" }).last()).toHaveAttribute("aria-current", "page");
});
