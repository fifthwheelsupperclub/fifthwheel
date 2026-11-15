import test from "node:test";
import assert from "node:assert/strict";
import { createStripeRefundProvider } from "./stripe.refunds.server.ts";
import { RefundProviderSafeError } from "./refunds.service.server.ts";

test("Stripe refund create uses server-owned PaymentIntent, amount, and durable idempotency key", async () => {
  const calls: Array<{ url: string; headers: Headers; body: string }> = [];
  const provider = createStripeRefundProvider({ mode: "test", secretKey: "sk_test_unit", fetch: async (input, init) => {
    calls.push({ url: String(input), headers: new Headers(init?.headers), body: String(init?.body ?? "") });
    return Response.json({ id: "re_abc123", amount: 1250, currency: "usd", payment_intent: "pi_abc123", status: "succeeded" });
  } });
  const result = await provider.createRefund({ paymentIntentId: "pi_abc123", amountCents: 1250, currency: "usd",
    idempotencyKey: "33333333-3333-4333-8333-333333333333", mode: "test" });
  assert.equal(calls[0]?.url, "https://api.stripe.com/v1/refunds");
  assert.equal(calls[0]?.headers.get("idempotency-key"), "33333333-3333-4333-8333-333333333333");
  assert.equal(calls[0]?.headers.get("authorization"), "Bearer sk_test_unit");
  const form = new URLSearchParams(calls[0]?.body);
  assert.equal(form.get("payment_intent"), "pi_abc123");
  assert.equal(form.get("amount"), "1250");
  assert.equal(form.has("currency"), false); // Stripe rejects `currency` on POST /v1/refunds
  assert.equal(form.get("metadata[app_refund_operation_id]"), "33333333-3333-4333-8333-333333333333");
  assert.equal(result.status, "succeeded");
});

test("Stripe 4xx is a definitive pre-object rejection; no provider response text escapes", async () => {
  const provider = createStripeRefundProvider({ mode: "test", secretKey: "sk_test_unit", fetch: async () =>
    new Response(JSON.stringify({ error: { message: "sensitive provider details" } }), { status: 400 }) });
  await assert.rejects(provider.createRefund({ paymentIntentId: "pi_abc123", amountCents: 1250, currency: "usd",
    idempotencyKey: "33333333-3333-4333-8333-333333333333", mode: "test" }),
    (error: unknown) => error instanceof RefundProviderSafeError && error.code === "provider_rejected" && error.definitive);
});

test("configured Stripe mode must match its secret-key prefix", () => {
  assert.throws(() => createStripeRefundProvider({ mode: "live", secretKey: "sk_test_unit", fetch: async () => { throw new Error("no request"); } }),
    (error: unknown) => error instanceof RefundProviderSafeError && error.code === "provider_unavailable");
});

test("findRefundByOperation matches our metadata, returns null when provably absent, and refuses to guess on an incomplete page", async () => {
  const op = "33333333-3333-4333-8333-333333333333";
  const row = (id: string, operation: string) => ({ id, amount: 1250, currency: "usd", status: "succeeded", payment_intent: "pi_abc123", metadata: { app_refund_operation_id: operation } });
  const make = (body: unknown) => createStripeRefundProvider({ secretKey: "sk_test_abc", mode: "test", fetch: (async () => Response.json(body)) as typeof fetch });
  const hit = await make({ data: [row("re_other1", "x"), row("re_mine1", op)], has_more: false }).findRefundByOperation({ paymentIntentId: "pi_abc123", operationId: op, mode: "test" });
  assert.equal(hit?.id, "re_mine1");
  assert.equal(await make({ data: [row("re_other1", "x")], has_more: false }).findRefundByOperation({ paymentIntentId: "pi_abc123", operationId: op, mode: "test" }), null);
  await assert.rejects(make({ data: [row("re_other1", "x")], has_more: true }).findRefundByOperation({ paymentIntentId: "pi_abc123", operationId: op, mode: "test" }), /provider_unknown/);
});
