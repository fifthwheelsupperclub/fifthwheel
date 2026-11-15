import { expect, test } from "@playwright/test";

const appOrigin = "http://127.0.0.1:8086";
const invitationId = "4a8f7a9d-295f-4e5d-9fb0-a9cc5c8a19f0";
const invitationPath = `/invitations/${invitationId}`;

test("W06.5 signed-out invitation keeps its exact destination through sign-in and callback UI", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.route("**/*", async (route) => {
    if (new URL(route.request().url()).origin === appOrigin) return route.continue();
    return route.abort();
  });

  let verifiedDestination: unknown;
  await context.route(`${appOrigin}/api/me/table-invitations/${invitationId}`, async (route) => {
    await route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({
      ok: false, error: { code: "unauthenticated", safeMessage: "Sign in to continue.", retryable: false, correlationId: "test-correlation" },
    }) });
  });
  await context.route(`${appOrigin}/api/auth/verify-link`, async (route) => {
    const body = route.request().postDataJSON() as { safeReturnTo?: unknown };
    verifiedDestination = body.safeReturnTo;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ nextPath: invitationPath }) });
  });

  try {
    const page = await context.newPage();
    await page.goto(`${appOrigin}${invitationPath}`);
    await expect(page.getByRole("heading", { name: "Sign in to continue" })).toBeVisible();
    const signInLink = page.getByRole("link", { name: "Continue to sign in" });
    await expect(signInLink).toHaveAttribute("href", `/sign-in?returnTo=${encodeURIComponent(invitationPath)}`);
    await expect(page.getByRole("button", { name: "Sign out" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Account" })).toHaveCount(0);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: "docs/implementation/screenshots/w06-table-invitation-signed-out-390px.png", fullPage: true });

    await signInLink.click();
    await page.waitForURL(`${appOrigin}/sign-in?returnTo=${encodeURIComponent(invitationPath)}`);
    await expect(page.getByText(/We’ll bring you back to this page after you sign in/i)).toBeVisible();

    await page.goto(`${appOrigin}/auth/callback?token_hash=${"a".repeat(32)}&type=magiclink&safeReturnTo=${encodeURIComponent(invitationPath)}`);
    await expect(page.getByRole("heading", { name: "Ready when you are." })).toBeVisible();
    const continueButton = page.getByRole("button", { name: "Continue", exact: true });
    await expect(continueButton).toBeEnabled();
    await continueButton.click();
    await page.waitForURL(`${appOrigin}${invitationPath}`);
    expect(verifiedDestination).toBe(invitationPath);
    await expect(page.getByRole("heading", { name: "Sign in to continue" })).toBeVisible();
  } finally {
    await context.close();
  }
});
