import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import type { CheckoutRepository, EmbeddedCheckoutProvider, StripeEventEnvelope } from "./checkout.contract.server.ts";
import { createCheckoutWebhookService } from "./checkout-fulfillment.server.ts";
import { StripeWebhookVerificationError, verifyStripeCheckoutWebhook } from "./stripe.webhook.server.ts";

const now = Date.parse("2026-11-13T15:00:00.000Z");
const secret = "whsec_test_secret_with_enough_entropy";
const eventId = "evt_123456789";
const sessionId = "cs_test_123456789";
const attemptId = "33333333-3333-4333-8333-333333333333";
const invitationId = "22222222-2222-4222-8222-222222222222";

function payload(overrides: Record<string, unknown> = {}) {
  return Buffer.from(JSON.stringify({ id: eventId, type: "checkout.session.completed", created: Math.floor(now / 1000),
    livemode: false, data: { object: { id: sessionId, object: "checkout.session", livemode: false, status: "complete",
      payment_status: "paid", amount_total: 2500, currency: "usd", expires_at: Math.floor(now / 1000) + 120,
      payment_intent: "pi_123456789" } }, ...overrides }));
}
function sign(body: Uint8Array, timestampSeconds = Math.floor(now / 1000)) {
  const signature = createHmac("sha256", secret).update(`${timestampSeconds}.${Buffer.from(body).toString("utf8")}`).digest("hex");
  return `t=${timestampSeconds},v1=${signature}`;
}
function repository(log: string[], opts: Readonly<{ existingState?: string }> = {}): CheckoutRepository {
  return {
    async readEligibility() { throw new Error("unused"); }, async reserve() { throw new Error("unused"); },
    async bindProviderSession() { throw new Error("unused"); }, async markProviderUnknown() {}, async releaseAttempt() {}, async expireProviderSession(_mode, _id) { log.push("expire"); },
    async releaseFailedProviderSession(event, id) { log.push(`release:${event.eventId}:${id}`); },
    async readAttempt() { throw new Error("unused"); },
    async readReturnBinding() { throw new Error("unused"); },
    async readReturnBindingByProviderSession(mode, id) {
      log.push("binding");
      return { attemptId, invitationId, providerSessionId: id, mode, holdUntil: "2026-11-13T15:30:00.000Z",
        providerSessionExpiresAt: "2026-11-13T15:32:00.000Z" };
    },
    async persistStripeEvent(event: StripeEventEnvelope) { log.push("persist"); return { eventId: event.eventId, state: opts.existingState ?? "received" }; },
    async markStripeEventResult(_event, state, code) { log.push(`mark:${state}:${code}`); },
    async fulfillPaidSession({ event, attemptId: receivedAttempt, session }) {
      log.push(`fulfill:${event?.eventId}:${receivedAttempt}:${session.id}`);
      return { paymentState: "confirmed", seatId: "44444444-4444-4444-8444-444444444444",
        paymentId: "55555555-5555-4555-8555-555555555555", refundObligationId: null };
    },
  };
}
function provider(log: string[], overrides: Partial<Awaited<ReturnType<EmbeddedCheckoutProvider["retrieveSession"]>>> = {}): EmbeddedCheckoutProvider {
  return {
    async createSession() { throw new Error("unused"); },
    async retrieveSession(id) {
      log.push("retrieve");
      return { id, clientSecret: null, livemode: false, status: "complete", paymentStatus: "paid", amountTotal: 2500,
        currency: "usd", expiresAt: Math.floor(now / 1000) + 120, paymentIntentId: "pi_123456789", ...overrides };
    },
  };
}

test("Stripe event parser verifies raw-body HMAC and rejects stale or changed bodies", () => {
  const rawBody = payload();
  const envelope = verifyStripeCheckoutWebhook({ rawBody, signatureHeader: sign(rawBody), secret, mode: "test", now: () => now });
  assert.equal(envelope.envelope.eventId, eventId);
  assert.equal(envelope.providerSession.id, sessionId);
  assert.throws(() => verifyStripeCheckoutWebhook({ rawBody, signatureHeader: sign(rawBody), secret, mode: "test",
    now: () => now + 301_000 }), StripeWebhookVerificationError);
  assert.throws(() => verifyStripeCheckoutWebhook({ rawBody, signatureHeader: sign(payload({ type: "other" })), secret,
    mode: "test", now: () => now }), StripeWebhookVerificationError);
});

test("invalid signature is rejected before inbox, provider retrieval or fulfillment", async () => {
  const log: string[] = [];
  const service = createCheckoutWebhookService({ repository: repository(log), provider: provider(log), secret, mode: "test", now: () => now });
  await assert.rejects(service.handle(payload(), "t=1,v1=bad"), StripeWebhookVerificationError);
  assert.deepEqual(log, []);
});

test("durably stores a signed event before retrieving and fulfilling one verified payment", async () => {
  const log: string[] = [];
  const service = createCheckoutWebhookService({ repository: repository(log), provider: provider(log), secret, mode: "test", now: () => now });
  assert.deepEqual(await service.handle(payload(), sign(payload())), { acknowledged: true });
  assert.deepEqual(log, ["persist", "retrieve", "binding", `fulfill:${eventId}:${attemptId}:${sessionId}`]);
});

test("duplicate terminal webhook is acknowledged without provider or fulfillment work", async () => {
  const log: string[] = [];
  const service = createCheckoutWebhookService({ repository: repository(log, { existingState: "processed" }), provider: provider(log), secret, mode: "test", now: () => now });
  await service.handle(payload(), sign(payload()));
  assert.deepEqual(log, ["persist"]);
});

test("nonpaid checkout is durably marked ignored and never fulfills a Seat", async () => {
  const log: string[] = [];
  const service = createCheckoutWebhookService({ repository: repository(log), provider: provider(log, { status: "expired", paymentStatus: "unpaid" }), secret, mode: "test", now: () => now });
  await service.handle(payload(), sign(payload()));
  assert.deepEqual(log, ["persist", "retrieve", "expire", "mark:ignored:not_paid"]);
});

test("verified async-payment-failed releases its bound attempt and commits the terminal event result", async () => {
  const log: string[] = [];
  const body = payload({ type: "checkout.session.async_payment_failed" });
  const service = createCheckoutWebhookService({ repository: repository(log),
    provider: provider(log, { status: "complete", paymentStatus: "unpaid" }), secret, mode: "test", now: () => now });
  await service.handle(body, sign(body));
  assert.deepEqual(log, ["persist", "retrieve", `release:${eventId}:${sessionId}`]);
});

test("async-payment-failed event with current paid truth still fulfills the payment", async () => {
  const log: string[] = [];
  const body = payload({ type: "checkout.session.async_payment_failed" });
  const service = createCheckoutWebhookService({ repository: repository(log), provider: provider(log), secret, mode: "test", now: () => now });
  await service.handle(body, sign(body));
  assert.deepEqual(log, ["persist", "retrieve", "binding", `fulfill:${eventId}:${attemptId}:${sessionId}`]);
});

test("async-payment-failed with uncertain or inconsistent current status does not release capacity", async () => {
  const body = payload({ type: "checkout.session.async_payment_failed" });
  const unknownLog: string[] = [];
  const unknownProvider = provider(unknownLog);
  unknownProvider.retrieveSession = async () => { unknownLog.push("retrieve"); throw new Error("network"); };
  const unknown = createCheckoutWebhookService({ repository: repository(unknownLog), provider: unknownProvider, secret, mode: "test", now: () => now });
  await assert.rejects(unknown.handle(body, sign(body)));
  assert.deepEqual(unknownLog, ["persist", "retrieve"]);

  const inconsistentLog: string[] = [];
  const inconsistent = createCheckoutWebhookService({ repository: repository(inconsistentLog),
    provider: provider(inconsistentLog, { status: "open", paymentStatus: "unpaid" }), secret, mode: "test", now: () => now });
  await assert.rejects(inconsistent.handle(body, sign(body)));
  assert.deepEqual(inconsistentLog, ["persist", "retrieve", "mark:retryable:payment_truth_invalid"]);
});

test("paid but wrong amount remains retryable and never fulfills", async () => {
  const log: string[] = [];
  const service = createCheckoutWebhookService({ repository: repository(log), provider: provider(log, { amountTotal: 2501 }), secret, mode: "test", now: () => now });
  await assert.rejects(service.handle(payload(), sign(payload())));
  assert.deepEqual(log, ["persist", "retrieve", "mark:retryable:payment_truth_invalid"]);
});

test("provider outage after ingress leaves event durable and returns a retryable error", async () => {
  const log: string[] = [];
  const broken = provider(log);
  broken.retrieveSession = async () => { log.push("retrieve"); throw new Error("network"); };
  const service = createCheckoutWebhookService({ repository: repository(log), provider: broken, secret, mode: "test", now: () => now });
  await assert.rejects(service.handle(payload(), sign(payload())));
  assert.deepEqual(log, ["persist", "retrieve"]);
});
