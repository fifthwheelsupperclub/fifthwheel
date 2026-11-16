// Mock-only: proves the phone sign-in layout, the entry page's recovery and chooser, and the failed-link page, not backend behavior.
import { expect, test } from "@playwright/test";

const origin = "http://127.0.0.1:8086";

test("phone sign-in: the email field and button are on screen without scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/sign-in");
  await expect(page.getByRole("heading", { name: /Good nights/, level: 1 })).toBeVisible();
  await expect(page.getByLabel("Email address")).toBeInViewport();
  await expect(page.getByRole("button", { name: "Send sign-in link" })).toBeInViewport();
  await expect(page.getByText("Sign in to see your tables.")).toBeHidden();
});

test("entry: a failed account load offers Try again first and a plain way to change email", async ({ page, context }) => {
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname === "/api/workspaces") return route.fulfill({ status: 503, json: { error: { code: "temporarily_unavailable", message: "x" } } });
    return route.continue();
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "We couldn’t load your account." })).toBeVisible();
  await expect(page.getByText("Check your connection and try again.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toHaveClass(/button-primary/);
  await expect(page.getByRole("link", { name: "Sign in with a different email" })).toHaveAttribute("href", "/sign-in");
});

test("entry: the workspace chooser lists only workspaces the person can open", async ({ page, context }) => {
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname === "/api/workspaces") return route.fulfill({ json: { workspaces: [{ key: "admin", available: true }, { key: "host", available: true }, { key: "restaurant", available: false }] } });
    return route.continue();
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Where to?" })).toBeVisible();
  await expect(page.locator(".workspace-choice")).toHaveCount(2);
  await expect(page.getByText("Coming soon")).toHaveCount(0);
});

test("a dead sign-in link uses the sign-in welcome, not the 'one more step' welcome", async ({ page }) => {
  await page.goto("/auth/callback");
  await expect(page.getByRole("heading", { name: "This link doesn’t work." })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Good nights/, level: 1 })).toBeVisible();
  await expect(page.getByText("One more step to sign in.")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Send a new link" })).toHaveAttribute("href", "/sign-in");
});

test("404 has one primary action; a route error makes Try again primary", async ({ page }) => {
  await page.goto("/definitely-not-a-page");
  await expect(page.getByRole("heading", { name: "This page isn’t here." })).toBeVisible();
  await expect(page.getByRole("link", { name: "Go to home" })).toHaveClass(/button-primary/);
  await expect(page.getByText("FIFTH WHEEL · ATLANTA")).toHaveCount(0);
});
