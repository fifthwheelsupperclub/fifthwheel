import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const appOrigin = "http://127.0.0.1:8086";
const invitationId = "c1000000-0000-4000-8000-000000000001";
const tableId = "c2000000-0000-4000-8000-000000000001";
const screenshots = resolve("docs/implementation/screenshots");

const invitationDetail = {
  ok: true,
  correlationId: "mock-w07-checkout-ui",
  data: {
    invitationId,
    state: "active",
    createdAt: "2026-11-12T15:00:00.000Z",
    delivery: { state: "delivered", attemptCount: 1, lastAttemptAt: "2026-11-12T15:01:00.000Z" },
    table: {
      tableId,
      title: "Garden Table",
      localDate: "2026-12-12",
      startLocalTime: "19:00",
      neighborhood: "Inman Park",
      seatPriceCents: 2500,
      currency: "USD",
      stops: [
        { role: "drinks", venueName: "Juniper Room", venueAddress: "10 Auburn Ave", minutesFromStart: 0, publicNotes: "Meet inside." },
        { role: "dinner", venueName: "Garden Table", venueAddress: "22 Edgewood Ave", minutesFromStart: 45, publicNotes: "Shared plates." },
        { role: "dessert", venueName: "Little Tart", venueAddress: "68 Georgia Ave", minutesFromStart: 115, publicNotes: "Optional dessert stop." },
      ],
      itineraryAvailable: true,
    },
  },
};

const eligibilityBlocked = {
  ok: true,
  correlationId: "mock-w07-checkout-eligibility",
  data: {
    invitationId,
    expectedProposalRevision: 3,
    expectedProfileRevision: 2,
    eligibility: { status: "blocked", reasonCode: "disclosure_not_configured" },
    price: { amountCents: 2500, currency: "USD" },
    disclosure: { status: "not_configured" },
    provider: { ready: false, mode: null, publishableKey: null },
    activeAttempt: null,
  },
};

test("W07.1 blocked checkout disclosure UI is mock-only and starts no payment", async ({ browser }) => {
  await mkdir(screenshots, { recursive: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== appOrigin) return route.abort();
    if (url.pathname === `/api/me/table-invitations/${invitationId}` && route.request().method() === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(invitationDetail) });
    }
    if (url.pathname === `/api/me/table-invitations/${invitationId}/checkout` && route.request().method() === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(eligibilityBlocked) });
    }
    if (url.pathname.startsWith("/api/")) return route.abort();
    return route.continue();
  });

  try {
    const page = await context.newPage();
    await page.goto(`${appOrigin}/invitations/${invitationId}`);
    await expect(page.getByRole("heading", { name: "You’re invited" })).toBeVisible();
    await expect(page.getByText("Loading…", { exact: true })).toHaveCount(0);
    await expect(page.getByText(/Checkout is unavailable until an approved payment disclosure is configured\./)).toBeVisible();
    await expect(page.getByText("$25 USD", { exact: false })).toBeVisible();
    await expect(page.getByRole("button", { name: /checkout|pay now|continue to payment/i })).toHaveCount(0);

    await page.screenshot({ path: resolve(screenshots, "w07-checkout-disclosure-blocked-desktop-mock-only.png"), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(page.getByText(/Checkout is unavailable until an approved payment disclosure is configured\./)).toBeVisible();
    await page.screenshot({ path: resolve(screenshots, "w07-checkout-disclosure-blocked-390px-mock-only.png"), fullPage: true });
  } finally {
    await context.close();
  }
});

test("W07.1 shows only the server disclosure and keeps checkout unavailable until provider readiness", async ({ browser }) => {
  await mkdir(screenshots, { recursive: true });
  const readyDisclosure = {
    ok: true,
    correlationId: "mock-w07-checkout-provider-blocked",
    data: {
      invitationId,
      expectedProposalRevision: 3,
      expectedProfileRevision: 2,
      eligibility: { status: "ready", reasonCode: null },
      price: { amountCents: 2500, currency: "USD" },
      disclosure: { status: "ready", version: "seat-checkout-v1", text: "I understand I’ll be charged $25 for this Seat. The Seat is confirmed only after payment succeeds. If I cancel, an admin decides whether the refund is full, partial, or none.", requiresAcknowledgement: true },
      provider: { ready: false, mode: "test", publishableKey: null },
      activeAttempt: null,
    },
  };
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== appOrigin) return route.abort();
    if (url.pathname === `/api/me/table-invitations/${invitationId}` && route.request().method() === "GET")
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(invitationDetail) });
    if (url.pathname === `/api/me/table-invitations/${invitationId}/checkout` && route.request().method() === "GET")
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(readyDisclosure) });
    if (url.pathname.startsWith("/api/")) return route.abort();
    return route.continue();
  });

  try {
    const page = await context.newPage();
    await page.goto(`${appOrigin}/invitations/${invitationId}`);
    await expect(page.getByText("I understand I’ll be charged $25 for this Seat. The Seat is confirmed only after payment succeeds. If I cancel, an admin decides whether the refund is full, partial, or none.", { exact: true })).toBeVisible();
    await expect(page.getByText("Version seat-checkout-v1", { exact: true })).toBeVisible();
    await expect(page.getByRole("checkbox", { name: /I acknowledge this disclosure/ })).toBeVisible();
    await expect(page.getByText(/Secure checkout is unavailable until the payment service and app configuration are ready/)).toBeVisible();
    await expect(page.getByText("Checkout isn’t available yet.", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /checkout|pay now|continue to payment/i })).toHaveCount(0);
    await page.screenshot({ path: resolve(screenshots, "w07-checkout-disclosure-approved-provider-blocked-desktop-mock-only.png"), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(page.getByText("I understand I’ll be charged $25 for this Seat.", { exact: false })).toBeVisible();
    await page.screenshot({ path: resolve(screenshots, "w07-checkout-disclosure-approved-provider-blocked-390px-mock-only.png"), fullPage: true });
  } finally {
    await context.close();
  }
});

test("W07.1 server-ready checkout waits for the approved acknowledgment and starts nothing until clicked", async ({ browser }) => {
  await mkdir(screenshots, { recursive: true });
  const eligible = {
    ok: true,
    correlationId: "mock-w07-checkout-ready",
    data: {
      invitationId,
      expectedProposalRevision: 3,
      expectedProfileRevision: 2,
      eligibility: { status: "ready", reasonCode: null },
      price: { amountCents: 2500, currency: "USD" },
      disclosure: { status: "ready", version: "seat-checkout-v1", text: "I understand I’ll be charged $25 for this Seat. The Seat is confirmed only after payment succeeds. If I cancel, an admin decides whether the refund is full, partial, or none.", requiresAcknowledgement: true },
      provider: { ready: true, mode: "test", publishableKey: "pk_test_mock_ui_only_12345" },
      activeAttempt: null,
    },
  };
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  let beginCount = 0;
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== appOrigin) return route.abort();
    if (url.pathname === `/api/me/table-invitations/${invitationId}` && route.request().method() === "GET")
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(invitationDetail) });
    if (url.pathname === `/api/me/table-invitations/${invitationId}/checkout` && route.request().method() === "GET")
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(eligible) });
    if (url.pathname === `/api/me/table-invitations/${invitationId}/checkout` && route.request().method() === "POST") {
      beginCount++;
      return route.fulfill({ status: 500, contentType: "application/json", body: "{}" });
    }
    if (url.pathname.startsWith("/api/")) return route.abort();
    return route.continue();
  });

  try {
    const page = await context.newPage();
    await page.goto(`${appOrigin}/invitations/${invitationId}`);
    const beginButton = page.getByRole("button", { name: "Continue to payment" });
    await expect(beginButton).toBeDisabled();
    await expect(page.getByRole("checkbox", { name: /I acknowledge this disclosure/ })).toBeVisible();
    // T-14: the page title names the table, the disabled button says why, and "Continue to payment" is the only primary action.
    await expect(page.getByRole("heading", { level: 1 })).toContainText("You’re invited to");
    await expect(page.getByText("Check the box above to continue.")).toBeVisible();
    await expect(page.locator("main .button-primary")).toHaveCount(1);
    await expect(page.getByRole("link", { name: "Back to Requests" })).toHaveCount(0);
    await page.screenshot({ path: resolve(screenshots, "w07-checkout-ready-awaiting-ack-desktop-mock-only.png"), fullPage: true });
    await page.getByRole("checkbox", { name: /I acknowledge this disclosure/ }).check();
    await expect(beginButton).toBeEnabled();
    expect(beginCount).toBe(0);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: resolve(screenshots, "w07-checkout-ready-acknowledged-390px-mock-only.png"), fullPage: true });
    expect(beginCount).toBe(0);
  } finally {
    await context.close();
  }
});

test("W07 return query is informational; member status comes from owner-scoped recovery API", async ({ browser }) => {
  const attemptId = "c3000000-0000-4000-8000-000000000001";
  const eligibility = {
    ...eligibilityBlocked,
    data: { ...eligibilityBlocked.data, eligibility: { status: "ready", reasonCode: null },
      disclosure: { status: "not_configured" },
      activeAttempt: { attemptId, invitationId, state: "unknown", holdUntil: "2026-12-12T18:30:00.000Z", providerSessionExpiresAt: "2026-12-12T18:32:00.000Z" } },
  };
  const recovery = {
    ok: true,
    correlationId: "mock-w07-recovery-unknown",
    data: { attempt: eligibility.data.activeAttempt, paymentState: "unknown", seatId: null },
  };
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  let returnPostCount = 0;
  let recoveryGetCount = 0;
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== appOrigin) return route.abort();
    if (url.pathname === `/api/me/table-invitations/${invitationId}` && route.request().method() === "GET")
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(invitationDetail) });
    if (url.pathname === `/api/me/table-invitations/${invitationId}/checkout` && route.request().method() === "GET")
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(eligibility) });
    if (url.pathname === `/api/me/table-invitations/${invitationId}/checkout/return` && route.request().method() === "POST") {
      returnPostCount++;
      expect(route.request().postDataJSON()).toEqual({ attemptId, sessionId: "cs_test_untrusted" });
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(recovery) });
    }
    if (url.pathname === `/api/me/checkout-attempts/${attemptId}` && route.request().method() === "GET") {
      recoveryGetCount++;
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(recovery) });
    }
    if (url.pathname.startsWith("/api/")) return route.abort();
    return route.continue();
  });

  try {
    const page = await context.newPage();
    await page.goto(`${appOrigin}/invitations/${invitationId}?checkout=return&attemptId=${attemptId}&session_id=cs_test_untrusted`);
    await expect(page.getByText("Payment status is being confirmed", { exact: true })).toBeVisible();
    expect(returnPostCount).toBe(1);
    await expect(page.getByRole("button", { name: "Check again" })).toBeVisible();
    await expect(page.getByText("Seat confirmed", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /checkout|pay now|continue to payment/i })).toHaveCount(0);
    await page.goto(`${appOrigin}/invitations/${invitationId}?checkout=return&attemptId=${attemptId}&session_id=malformed`);
    await expect(page.getByText("Payment status is being confirmed", { exact: true })).toBeVisible();
    expect(returnPostCount).toBe(1);
    expect(recoveryGetCount).toBeGreaterThanOrEqual(1);
  } finally {
    await context.close();
  }
});
