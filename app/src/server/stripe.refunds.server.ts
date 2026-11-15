/** Server-only Stripe Refund adapter. Requests are injected in tests; this module is never called by UI code. */

import type { ProviderRefund, RefundProvider } from "./refunds.contract.server.ts";
import { RefundProviderSafeError } from "./refunds.service.server.ts";

type Config = Readonly<{ secretKey: string; mode: "test" | "live"; fetch?: typeof fetch }>;
type RecordValue = Record<string, unknown>;
const isRecord = (x: unknown): x is RecordValue => typeof x === "object" && x !== null && !Array.isArray(x);
function refund(value: unknown, mode: "test" | "live"): ProviderRefund {
  if (!isRecord(value) || typeof value.id !== "string" || !/^re_[A-Za-z0-9]+$/.test(value.id)
    || typeof value.amount !== "number" || !Number.isSafeInteger(value.amount) || value.amount < 1 || value.amount > 2500
    || typeof value.currency !== "string" || !["pending", "requires_action", "succeeded", "failed", "canceled"].includes(String(value.status))) {
    throw new RefundProviderSafeError("provider_unknown", false);
  }
  let paymentIntentId: string | null = null;
  if (typeof value.payment_intent === "string") paymentIntentId = value.payment_intent;
  else if (isRecord(value.payment_intent) && typeof value.payment_intent.id === "string") paymentIntentId = value.payment_intent.id;
  return Object.freeze({ id: value.id, mode, paymentIntentId, amountCents: value.amount, currency: value.currency,
    status: value.status as ProviderRefund["status"] });
}
export function createStripeRefundProvider(config: Config): RefundProvider {
  const prefix = config.mode === "test" ? "sk_test_" : "sk_live_";
  if (!config.secretKey.startsWith(prefix)) throw new RefundProviderSafeError("provider_unavailable", false);
  const fetcher = config.fetch ?? globalThis.fetch;
  async function request(url: URL, body: URLSearchParams | null, idempotencyKey?: string): Promise<unknown> {
    let response: Response;
    try {
      response = await fetcher(url, { method: body ? "POST" : "GET", headers: {
        authorization: `Bearer ${config.secretKey}`,
        ...(body ? { "content-type": "application/x-www-form-urlencoded" } : {}),
        ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
      }, ...(body ? { body } : {}), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15_000) });
    } catch { throw new RefundProviderSafeError("provider_unknown", false); }
    let value: unknown;
    try { value = await response.json() as unknown; } catch { throw new RefundProviderSafeError("provider_unknown", false); }
    if (!response.ok) {
      if (response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 409) {
        throw new RefundProviderSafeError("provider_rejected", true);
      }
      throw new RefundProviderSafeError("provider_unknown", false);
    }
    return value;
  }
  return Object.freeze({
    async createRefund(input: Parameters<RefundProvider["createRefund"]>[0]) {
      if (input.mode !== config.mode || !/^pi_[A-Za-z0-9]+$/.test(input.paymentIntentId) || !Number.isSafeInteger(input.amountCents)
        || input.amountCents < 1 || input.amountCents > 2500 || input.currency !== "usd" || !/^[0-9a-f-]{36}$/i.test(input.idempotencyKey)) {
        throw new RefundProviderSafeError("provider_rejected", true);
      }
      const body = new URLSearchParams(); body.set("payment_intent", input.paymentIntentId);
      body.set("amount", String(input.amountCents)); // Stripe rejects a `currency` param on refunds; currency is verified on the response below
      body.set("metadata[app_refund_operation_id]", input.idempotencyKey);
      const result = refund(await request(new URL("https://api.stripe.com/v1/refunds"), body, input.idempotencyKey), config.mode);
      if (result.paymentIntentId !== input.paymentIntentId || result.amountCents !== input.amountCents || result.currency.toLowerCase() !== "usd") {
        throw new RefundProviderSafeError("provider_unknown", false);
      }
      return result;
    },
    async findRefundByOperation(input: Parameters<RefundProvider["findRefundByOperation"]>[0]) {
      if (input.mode !== config.mode || !/^pi_[A-Za-z0-9]+$/.test(input.paymentIntentId) || !/^[0-9a-f-]{36}$/i.test(input.operationId)) {
        throw new RefundProviderSafeError("provider_unavailable", false);
      }
      const url = new URL("https://api.stripe.com/v1/refunds");
      url.searchParams.set("payment_intent", input.paymentIntentId); url.searchParams.set("limit", "100");
      const page = await request(url, null);
      if (!isRecord(page) || !Array.isArray(page.data) || typeof page.has_more !== "boolean") throw new RefundProviderSafeError("provider_unknown", false);
      const hit = page.data.find((row) => isRecord(row) && isRecord(row.metadata) && row.metadata.app_refund_operation_id === input.operationId);
      if (hit) return refund(hit, config.mode);
      // An incomplete listing cannot prove absence: never let the caller create a second refund on a guess.
      if (page.has_more) throw new RefundProviderSafeError("provider_unknown", false);
      return null;
    },
    async retrieveRefund(input: Parameters<RefundProvider["retrieveRefund"]>[0]) {
      if (input.mode !== config.mode || !/^re_[A-Za-z0-9]+$/.test(input.refundId)) throw new RefundProviderSafeError("provider_unavailable", false);
      return refund(await request(new URL(`https://api.stripe.com/v1/refunds/${encodeURIComponent(input.refundId)}`,), null), config.mode);
    },
  });
}
