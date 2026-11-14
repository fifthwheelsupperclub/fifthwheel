/** Server-only Stripe embedded Checkout adapter. The injected fetcher keeps tests offline. */

import type { EmbeddedCheckoutProvider, EmbeddedCheckoutSession } from "./checkout.contract.server.ts";

export type StripeCheckoutConfig = Readonly<{
  secretKey: string;
  mode: "test" | "live";
  fetch?: typeof fetch;
  now?: () => number;
}>;

export class StripeCheckoutError extends Error {
  readonly code: "configuration_invalid" | "provider_unavailable" | "provider_rejected" | "provider_response_invalid" | "session_expiry_too_soon";
  constructor(code: StripeCheckoutError["code"]) { super(code); this.name = "StripeCheckoutError"; this.code = code; }
}

const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const nonempty = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length < 5000;

export function createStripeEmbeddedCheckoutProvider(config: StripeCheckoutConfig): EmbeddedCheckoutProvider {
  const fetcher = config.fetch ?? globalThis.fetch;
  const now = config.now ?? Date.now;
  const prefix = config.mode === "test" ? "sk_test_" : "sk_live_";
  if (!config.secretKey.startsWith(prefix) || config.secretKey.length < prefix.length + 8) {
    throw new StripeCheckoutError("configuration_invalid");
  }
  async function parseSession(response: Response, expectedExpiresAt?: number): Promise<EmbeddedCheckoutSession> {
        if (!response.ok) throw new StripeCheckoutError(response.status >= 400 && response.status < 500 ? "provider_rejected" : "provider_unavailable");
    const value: unknown = await response.json();
    if (!object(value) || !nonempty(value.id) || !(value.client_secret === null || nonempty(value.client_secret))
      || value.object !== "checkout.session" || value.ui_mode !== "embedded_page"
      || !["open", "complete", "expired"].includes(String(value.status))
      || !["unpaid", "paid", "no_payment_required"].includes(String(value.payment_status))
      || value.livemode !== (config.mode === "live") || value.mode !== "payment"
      || !Number.isSafeInteger(value.amount_total) || typeof value.currency !== "string" || !/^[a-z]{3}$/.test(value.currency)
      || !Number.isSafeInteger(value.expires_at)
      || expectedExpiresAt !== undefined && value.expires_at !== expectedExpiresAt) {
      throw new StripeCheckoutError("provider_response_invalid");
    }
    const paymentIntent = typeof value.payment_intent === "string" ? value.payment_intent
      : object(value.payment_intent) && typeof value.payment_intent.id === "string" ? value.payment_intent.id : null;
    return Object.freeze({
      id: value.id,
      clientSecret: value.client_secret,
      livemode: value.livemode,
      status: value.status as EmbeddedCheckoutSession["status"],
      paymentStatus: value.payment_status as EmbeddedCheckoutSession["paymentStatus"],
      amountTotal: value.amount_total as number,
      currency: value.currency,
      expiresAt: value.expires_at as number,
      paymentIntentId: paymentIntent,
    });
  }
  async function get(path: string): Promise<Response> {
    try {
      return await fetcher(`https://api.stripe.com/v1${path}`, {
        method: "GET",
        headers: { authorization: `Bearer ${config.secretKey}` },
        cache: "no-store", redirect: "error", signal: AbortSignal.timeout(12_000),
      });
    } catch { throw new StripeCheckoutError("provider_unavailable"); }
  }
  return Object.freeze({
    async createSession(input: Parameters<EmbeddedCheckoutProvider["createSession"]>[0]) {
      const createdAt = Math.floor(now() / 1000);
      // Stripe requires >= 30m from provider creation; keep a margin for transport.
      if (!Number.isSafeInteger(input.expiresAt) || !input.providerReplay && input.expiresAt < createdAt + 1800) {
        throw new StripeCheckoutError("session_expiry_too_soon");
      }
      let origin: URL;
      try { origin = new URL(input.appOrigin); } catch { throw new StripeCheckoutError("configuration_invalid"); }
      if (!(["http:", "https:"].includes(origin.protocol) && origin.username === "" && origin.password === "")) {
        throw new StripeCheckoutError("configuration_invalid");
      }
      const returnUrl = new URL(`/invitations/${encodeURIComponent(input.invitationId)}`, origin);
      returnUrl.searchParams.set("checkout", "return");
      returnUrl.searchParams.set("attemptId", input.attemptId);
      returnUrl.searchParams.set("session_id", "{CHECKOUT_SESSION_ID}");
      const body = new URLSearchParams({
        mode: "payment",
        ui_mode: "embedded_page",
        "payment_method_types[0]": "card",
        "line_items[0][price_data][currency]": "usd",
        "line_items[0][price_data][unit_amount]": "2500",
        "line_items[0][price_data][product_data][name]": "Fifth Wheel Seat",
        "line_items[0][quantity]": "1",
        expires_at: String(input.expiresAt),
        return_url: returnUrl.toString(),
        "metadata[attempt_id]": input.attemptId,
        "metadata[invitation_id]": input.invitationId,
      });
      try {
        const response = await fetcher("https://api.stripe.com/v1/checkout/sessions", {
          method: "POST",
          headers: {
            authorization: `Bearer ${config.secretKey}`,
            "content-type": "application/x-www-form-urlencoded",
            "idempotency-key": input.idempotencyKey,
          },
          body,
          cache: "no-store",
          redirect: "error",
          signal: AbortSignal.timeout(12_000),
        });
        return await parseSession(response, input.expiresAt);
      } catch (error) {
        if (error instanceof StripeCheckoutError) throw error;
        throw new StripeCheckoutError("provider_unavailable");
      }
    },
    async retrieveSession(sessionId: string) {
      if (!/^cs_(?:test_|live_)[A-Za-z0-9]+$/.test(sessionId)) throw new StripeCheckoutError("provider_response_invalid");
      return parseSession(await get(`/checkout/sessions/${encodeURIComponent(sessionId)}`));
    },
  });
}
