import assert from "node:assert/strict";
import test from "node:test";
import type { CheckoutWebhookService } from "./checkout-fulfillment.server.ts";
import { createCheckoutWebhookHttpHandler } from "./checkout-webhook.http.server.ts";

function makeService(result: "ok" | "fail" = "ok", calls: unknown[] = []): CheckoutWebhookService {
  return { async handle(rawBody, signatureHeader) {
    calls.push({ bytes: rawBody.byteLength, signatureHeader });
    if (result === "fail") throw new Error("private provider or database error");
    return { acknowledged: true };
  } };
}

test("Stripe webhook HTTP handler preserves raw body and acknowledges only after service completion", async () => {
  const calls: unknown[] = [];
  const handler = createCheckoutWebhookHttpHandler(() => makeService("ok", calls));
  const response = await handler.handle(new Request("http://local/api/webhooks/stripe", { method: "POST",
    headers: { "stripe-signature": "t=123,v1=abcd" }, body: "{\"signed\":true}" }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { received: true });
  assert.deepEqual(calls, [{ bytes: 15, signatureHeader: "t=123,v1=abcd" }]);
});

test("method and oversized raw body fail before service construction", async () => {
  let constructed = 0;
  const handler = createCheckoutWebhookHttpHandler(() => { constructed++; return makeService(); });
  assert.equal((await handler.handle(new Request("http://local/api/webhooks/stripe", { method: "GET" }))).status, 405);
  const large = new Uint8Array(1_048_577);
  assert.equal((await handler.handle(new Request("http://local/api/webhooks/stripe", { method: "POST", body: large }))).status, 400);
  assert.equal(constructed, 0);
});

test("processing failure returns retryable 503 without provider details", async () => {
  const handler = createCheckoutWebhookHttpHandler(() => makeService("fail"));
  const response = await handler.handle(new Request("http://local/api/webhooks/stripe", { method: "POST", body: "{}" }));
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { received: false });
  assert.equal(response.headers.get("cache-control"), "no-store");
});
