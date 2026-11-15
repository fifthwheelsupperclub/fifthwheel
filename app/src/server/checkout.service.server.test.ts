import assert from "node:assert/strict";
import test from "node:test";
import type { CheckoutRepository, CheckoutReservation, DisclosureConfiguration } from "./checkout.contract.server.ts";
import { createCheckoutService } from "./checkout.service.server.ts";
import { StripeCheckoutError } from "./stripe.checkout.server.ts";

const userId = "11111111-1111-4111-8111-111111111111";
const invitationId = "22222222-2222-4222-8222-222222222222";
const attemptId = "33333333-3333-4333-8333-333333333333";
const request = { operationId: "44444444-4444-4444-8444-444444444444", expectedProposalRevision: 2, expectedProfileRevision: 4, acceptedDisclosureVersion: "seat-checkout-v1" };
const reservation: CheckoutReservation = { attemptId, invitationId, state: "creating", holdUntil: "2026-11-13T13:30:00.000Z",
  providerSessionExpiresAt: "2026-11-13T13:32:00.000Z", expectedAmountCents: 2500, currency: "USD", mode: "test",
  providerIdempotencyKey: "fw-checkout-operation", providerSessionId: null, lastProviderErrorCode: null,
  dispatchClaimed: true, providerReplay: false };
const principal = { userId, emailNormalized: "member@example.test", emailVerified: true, staffRoles: new Set<"admin" | "host" | "restaurant">(),
  admission: { state: "activated" as const, authUserId: userId, emailNormalized: "member@example.test" },
  assignedTableIds: new Set<string>(), assignedVenueIds: new Set<string>() };
function repository(): CheckoutRepository {
  return {
    async readEligibility() { return { invitationId, expectedProposalRevision: 2, expectedProfileRevision: 4,
      eligibility: { status: "ready", reasonCode: null }, price: { amountCents: 2500, currency: "USD" },
      disclosure: { status: "ready", version: "seat-checkout-v1", text: "approved terms", requiresAcknowledgement: true },
      provider: { ready: true, mode: "test", publishableKey: "pk_test_demo12345678" }, activeAttempt: null }; },
    async reserve() { return reservation; },
    async bindProviderSession(_actor, _attempt, session) { return { ...reservation, state: "open", providerSessionId: session.id }; },
    async markProviderUnknown() {}, async releaseAttempt() {}, async expireProviderSession() {}, async releaseFailedProviderSession() {},
    async readAttempt() { return { attempt: { attemptId, invitationId, state: "unknown", holdUntil: reservation.holdUntil,
      providerSessionExpiresAt: reservation.providerSessionExpiresAt }, paymentState: "unknown", seatId: null }; },
    async readReturnBinding() { return { attemptId, invitationId, providerSessionId: "cs_test_123456", mode: "test",
      holdUntil: reservation.holdUntil, providerSessionExpiresAt: reservation.providerSessionExpiresAt }; },
    async readReturnBindingByProviderSession() { return { attemptId, invitationId, providerSessionId: "cs_test_123456", mode: "test",
      holdUntil: reservation.holdUntil, providerSessionExpiresAt: reservation.providerSessionExpiresAt }; },
    async persistStripeEvent(event) { return { eventId: event.eventId, state: "received" }; },
    async markStripeEventResult() {}, async fulfillPaidSession() { return { paymentState: "confirmed", seatId: null, paymentId: null, refundObligationId: null }; },
  };
}
function service(options: Readonly<{ disclosure?: DisclosureConfiguration; providerConfigured?: boolean; providerError?: unknown;
  fulfillmentReady?: boolean; reservation?: CheckoutReservation; now?: number | (() => number) }> = {}) {
  const calls = { reserve: 0, provider: 0, retrieve: 0, unknown: 0, release: 0 };
  const clock = options.now;
  const repo = repository();
  const currentReservation = options.reservation ?? reservation;
  repo.reserve = async () => { calls.reserve++; return currentReservation; };
  repo.markProviderUnknown = async () => { calls.unknown++; };
  repo.releaseAttempt = async () => { calls.release++; };
  const client = createCheckoutService({ resolvePrincipal: async () => principal, repository: repo,
    disclosure: options.disclosure === undefined ? { version: "seat-checkout-v1", text: "approved terms", requiresAcknowledgement: true } : options.disclosure,
    mode: "test", providerConfigured: options.providerConfigured ?? true, fulfillmentReady: options.fulfillmentReady ?? true,
    appOrigin: "http://127.0.0.1:8085",
    publishableKey: "pk_test_demo12345678",
    now: typeof clock === "function" ? clock : () => clock ?? Date.now(),
    provider: { async createSession() { calls.provider++; if (options.providerError) throw options.providerError;
      return { id: "cs_test_123456", clientSecret: "ephemeral_secret", livemode: false, status: "open", paymentStatus: "unpaid",
        amountTotal: 2500, currency: "usd", expiresAt: Math.floor(Date.parse(currentReservation.providerSessionExpiresAt) / 1000), paymentIntentId: null }; },
      async retrieveSession(sessionId) { calls.retrieve++; return { id: sessionId, clientSecret: "ephemeral_secret", livemode: false, status: "open", paymentStatus: "unpaid",
        amountTotal: 2500, currency: "usd", expiresAt: Math.floor(Date.parse(currentReservation.providerSessionExpiresAt) / 1000), paymentIntentId: null }; } },
  });
  return { client, calls };
}

test("missing approved disclosure fails before hold or provider creation", async () => {
  const { client, calls } = service({ disclosure: null });
  const result = await client.beginCheckout({ accessToken: "jwt", invitationId, request });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "ineligible");
  assert.deepEqual(calls, { reserve: 0, provider: 0, retrieve: 0, unknown: 0, release: 0 });
});

test("missing Stripe configuration blocks eligibility and begin before reserve", async () => {
  const { client, calls } = service({ providerConfigured: false });
  const eligibility = await client.readEligibility({ accessToken: "jwt", invitationId });
  assert.equal(eligibility.ok, true);
  if (eligibility.ok) assert.deepEqual(eligibility.value.eligibility, { status: "blocked", reasonCode: "provider_unavailable" });
  const result = await client.beginCheckout({ accessToken: "jwt", invitationId, request });
  assert.equal(result.ok, false);
  assert.deepEqual(calls, { reserve: 0, provider: 0, retrieve: 0, unknown: 0, release: 0 });
});

test("provider readiness remains fail-closed until fulfillment is operational", async () => {
  const { client, calls } = service({ fulfillmentReady: false });
  const eligibility = await client.readEligibility({ accessToken: "jwt", invitationId });
  assert.equal(eligibility.ok, true);
  if (eligibility.ok) {
    assert.deepEqual(eligibility.value.provider, { ready: false, mode: null, publishableKey: null });
    assert.deepEqual(eligibility.value.eligibility, { status: "blocked", reasonCode: "provider_unavailable" });
  }
  const result = await client.beginCheckout({ accessToken: "jwt", invitationId, request });
  assert.equal(result.ok, false);
  assert.deepEqual(calls, { reserve: 0, provider: 0, retrieve: 0, unknown: 0, release: 0 });
});

test("affirmative checkout acknowledgment must use the exact server-owned disclosure version", async () => {
  const { client, calls } = service();
  const result = await client.beginCheckout({ accessToken: "jwt", invitationId,
    request: { ...request, acceptedDisclosureVersion: "previous-copy-v0" } });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "ineligible");
  assert.equal(calls.reserve, 0);
  assert.equal(calls.provider, 0);
});

test("uncertain provider outcome marks the existing attempt unknown and does not return a secret", async () => {
  const { client, calls } = service({ providerError: new StripeCheckoutError("provider_unavailable") });
  const result = await client.beginCheckout({ accessToken: "jwt", invitationId, request });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "outcome_unknown");
  assert.deepEqual(calls, { reserve: 1, provider: 1, retrieve: 0, unknown: 1, release: 0 });
});

test("definitive session precondition failure releases the hold without claiming uncertainty", async () => {
  const { client, calls } = service({ providerError: new StripeCheckoutError("session_expiry_too_soon") });
  const result = await client.beginCheckout({ accessToken: "jwt", invitationId, request });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "provider_unavailable");
  assert.deepEqual(calls, { reserve: 1, provider: 1, retrieve: 0, unknown: 0, release: 1 });
});

test("a concurrent caller without the database dispatch claim never calls Stripe", async () => {
  const { client, calls } = service({ reservation: { ...reservation, dispatchClaimed: false } });
  const result = await client.beginCheckout({ accessToken: "jwt", invitationId, request });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "outcome_unknown");
  assert.deepEqual(calls, { reserve: 1, provider: 0, retrieve: 0, unknown: 0, release: 0 });
});

test("the client secret stops at the exact 30-minute hold boundary", async () => {
  const held = { ...reservation, state: "open" as const, providerSessionId: "cs_test_123456", dispatchClaimed: false };
  const holdDeadline = Date.parse(held.holdUntil);
  for (const [offset, expected] of [[-1_000, true], [0, false], [119_000, false]] as const) {
    const { client, calls } = service({ reservation: held, now: holdDeadline + offset });
    const result = await client.beginCheckout({ accessToken: "jwt", invitationId, request });
    if (expected) {
      assert.equal(result.ok, true);
      if (result.ok) assert.equal(result.value.checkoutClientSecret, "ephemeral_secret");
      assert.deepEqual(calls, { reserve: 1, provider: 0, retrieve: 1, unknown: 0, release: 0 });
    } else {
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.error.code, "outcome_unknown");
      assert.deepEqual(calls, { reserve: 1, provider: 0, retrieve: 0, unknown: 1, release: 0 });
    }
  }
});

test("provider response arriving at the hold deadline is bound but no client secret is issued", async () => {
  const holdDeadline = Date.parse(reservation.holdUntil);
  const { client, calls } = service({ now: () => holdDeadline });
  const result = await client.beginCheckout({ accessToken: "jwt", invitationId, request });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "outcome_unknown");
  assert.deepEqual(calls, { reserve: 1, provider: 1, retrieve: 0, unknown: 1, release: 0 });
});

test("verified owner return cross-checks invitation, attempt and stored session before shared fulfillment", async () => {
  const repo = repository();
  let retrieved = 0;
  let fulfilled = 0;
  repo.fulfillPaidSession = async ({ event, attemptId: receivedAttempt, session }) => {
    assert.equal(event, null);
    assert.equal(receivedAttempt, attemptId);
    assert.equal(session.id, "cs_test_123456");
    fulfilled++;
    return { paymentState: "confirmed", seatId: null, paymentId: null, refundObligationId: null };
  };
  const client = createCheckoutService({ resolvePrincipal: async () => principal, repository: repo,
    disclosure: { version: "seat-checkout-v1", text: "approved terms", requiresAcknowledgement: true },
    provider: { async createSession() { throw new Error("unused"); }, async retrieveSession(id) {
      retrieved++;
      return { id, clientSecret: null, livemode: false, status: "complete", paymentStatus: "paid", amountTotal: 2500,
        currency: "usd", expiresAt: Math.floor(Date.parse(reservation.providerSessionExpiresAt) / 1000), paymentIntentId: "pi_123456" };
    } }, mode: "test", providerConfigured: true, fulfillmentReady: true, publishableKey: "pk_test_demo12345678",
    appOrigin: "http://127.0.0.1:8085" });
  const mismatch = await client.finalizeReturn({ accessToken: "jwt", invitationId, attemptId, sessionId: "cs_test_other" });
  assert.equal(mismatch.ok, false);
  assert.equal(retrieved, 0);
  const result = await client.finalizeReturn({ accessToken: "jwt", invitationId, attemptId, sessionId: "cs_test_123456" });
  assert.equal(result.ok, true);
  assert.equal(retrieved, 1);
  assert.equal(fulfilled, 1);
});

test("verified expired owner return releases the old hold without a payment or Seat", async () => {
  const repo = repository();
  let expired = 0;
  let fulfilled = 0;
  repo.expireProviderSession = async (mode, sessionId) => {
    assert.equal(mode, "test"); assert.equal(sessionId, "cs_test_123456"); expired++;
  };
  repo.fulfillPaidSession = async () => { fulfilled++; return { paymentState: "confirmed", seatId: null, paymentId: null, refundObligationId: null }; };
  const client = createCheckoutService({ resolvePrincipal: async () => principal, repository: repo,
    disclosure: { version: "seat-checkout-v1", text: "approved terms", requiresAcknowledgement: true },
    provider: { async createSession() { throw new Error("unused"); }, async retrieveSession(id) {
      return { id, clientSecret: null, livemode: false, status: "expired", paymentStatus: "unpaid", amountTotal: 2500,
        currency: "usd", expiresAt: Math.floor(Date.parse(reservation.providerSessionExpiresAt) / 1000), paymentIntentId: null };
    } }, mode: "test", providerConfigured: true, fulfillmentReady: true,
    appOrigin: "http://127.0.0.1:8085" });
  const result = await client.finalizeReturn({ accessToken: "jwt", invitationId, attemptId, sessionId: "cs_test_123456" });
  assert.equal(result.ok, true);
  assert.equal(expired, 1);
  assert.equal(fulfilled, 0);
});
