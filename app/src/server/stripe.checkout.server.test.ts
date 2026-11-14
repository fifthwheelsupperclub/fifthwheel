import assert from "node:assert/strict";
import test from "node:test";
import { createStripeEmbeddedCheckoutProvider, StripeCheckoutError } from "./stripe.checkout.server.ts";

const now = 1_800_000_000_000;
const attemptId = "11111111-1111-4111-8111-111111111111";
const invitationId = "22222222-2222-4222-8222-222222222222";
const clientSecret = "cs_test_secret_ephemeral";
function stripeSession(expiresAt: number, extra: Record<string, unknown> = {}) {
  return { id: "cs_test_123456", object: "checkout.session", client_secret: clientSecret,
    ui_mode: "embedded_page", status: "open", payment_status: "unpaid", livemode: false,
    mode: "payment", amount_total: 2500, currency: "usd", expires_at: expiresAt, ...extra };
}

test("creates only card-only embedded USD 25 checkout with server invitation return context", async () => {
  const expiresAt = Math.floor(now / 1000) + 1_920;
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const provider = createStripeEmbeddedCheckoutProvider({ secretKey: "sk_test_123456789", mode: "test", now: () => now,
    fetch: async (input, init) => {
      calls.push({ url: String(input), init: init ?? {} });
      return Response.json(stripeSession(expiresAt));
    } });
  const session = await provider.createSession({ idempotencyKey: "fw-checkout-operation-1", expiresAt,
    attemptId, invitationId, appOrigin: "http://127.0.0.1:8085", providerReplay: false });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, "https://api.stripe.com/v1/checkout/sessions");
  const init = calls[0]!.init;
  assert.equal((init.headers as Record<string, string>)["idempotency-key"], "fw-checkout-operation-1");
  const form = new URLSearchParams(String(init.body));
  assert.equal(form.get("mode"), "payment");
  assert.equal(form.get("ui_mode"), "embedded_page");
  assert.equal(form.get("payment_method_types[0]"), "card");
  assert.equal(form.get("line_items[0][price_data][unit_amount]"), "2500");
  assert.equal(form.get("line_items[0][price_data][currency]"), "usd");
  const returnUrl = new URL(form.get("return_url")!);
  assert.equal(returnUrl.pathname, `/invitations/${invitationId}`);
  assert.equal(returnUrl.searchParams.get("checkout"), "return");
  assert.equal(returnUrl.searchParams.get("attemptId"), attemptId);
  assert.equal(returnUrl.searchParams.get("session_id"), "{CHECKOUT_SESSION_ID}");
  assert.equal(session.clientSecret, clientSecret);
});

test("rejects too-soon expiry before any provider request", async () => {
  let calls = 0;
  const provider = createStripeEmbeddedCheckoutProvider({ secretKey: "sk_test_123456789", mode: "test", now: () => now,
    fetch: async () => { calls++; return Response.json({}); } });
  await assert.rejects(provider.createSession({ idempotencyKey: "k", expiresAt: Math.floor(now / 1000) + 1799,
    attemptId, invitationId, appOrigin: "https://example.test", providerReplay: false }), (error: unknown) => error instanceof StripeCheckoutError && error.code === "session_expiry_too_soon");
  assert.equal(calls, 0);
});

test("an idempotent recovery replay sends the stored request even when expiry is now inside Stripe's minimum window", async () => {
  const expiresAt = Math.floor(now / 1000) + 1_799;
  let calls = 0;
  const provider = createStripeEmbeddedCheckoutProvider({ secretKey: "sk_test_123456789", mode: "test", now: () => now,
    fetch: async (_input, init) => {
      calls++;
      assert.equal((init?.headers as Record<string, string>)["idempotency-key"], "fw-checkout-stable-key");
      assert.equal(new URLSearchParams(String(init?.body)).get("expires_at"), String(expiresAt));
      return Response.json(stripeSession(expiresAt));
    } });
  const session = await provider.createSession({ idempotencyKey: "fw-checkout-stable-key", expiresAt, attemptId, invitationId,
    appOrigin: "https://example.test", providerReplay: true });
  assert.equal(calls, 1);
  assert.equal(session.id, "cs_test_123456");
});

test("treats Stripe 4xx as a definitive rejection and does not reveal response text", async () => {
  const provider = createStripeEmbeddedCheckoutProvider({ secretKey: "sk_test_123456789", mode: "test", now: () => now,
    fetch: async () => new Response("private provider error", { status: 400 }) });
  await assert.rejects(provider.createSession({ idempotencyKey: "k", expiresAt: Math.floor(now / 1000) + 1_920,
    attemptId, invitationId, appOrigin: "https://example.test", providerReplay: false }), (error: unknown) => error instanceof StripeCheckoutError && error.code === "provider_rejected" && !error.message.includes("private"));
});

test("preserves provider amount for fulfillment validation and rejects mode mismatch", async () => {
  const expiresAt = Math.floor(now / 1000) + 1_920;
  const provider = createStripeEmbeddedCheckoutProvider({ secretKey: "sk_test_123456789", mode: "test", now: () => now,
    fetch: async () => Response.json(stripeSession(expiresAt, { amount_total: 1 })) });
  const session = await provider.createSession({ idempotencyKey: "k", expiresAt, attemptId, invitationId,
    appOrigin: "https://example.test", providerReplay: false });
  assert.equal(session.amountTotal, 1);
  assert.equal(session.currency, "usd");
  assert.throws(() => createStripeEmbeddedCheckoutProvider({ secretKey: "sk_live_123456789", mode: "test" }),
    (error: unknown) => error instanceof StripeCheckoutError && error.code === "configuration_invalid");
});
