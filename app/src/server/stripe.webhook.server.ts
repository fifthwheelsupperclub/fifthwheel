/** Stripe webhook signature verification and minimal Checkout event parsing. */

import { createHmac, timingSafeEqual } from "node:crypto";
import type { StripeEventEnvelope } from "./checkout.contract.server.ts";
import type { EmbeddedCheckoutSession } from "./checkout.contract.server.ts";

const allowedEvents = new Set([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
]);
const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

export type VerifiedStripeCheckoutEvent = Readonly<{
  envelope: StripeEventEnvelope;
  providerSession: Pick<EmbeddedCheckoutSession, "id" | "livemode" | "status" | "paymentStatus" | "amountTotal" | "currency" | "expiresAt" | "paymentIntentId">;
}>;

export class StripeWebhookVerificationError extends Error {
  constructor() { super("stripe_webhook_invalid"); this.name = "StripeWebhookVerificationError"; }
}

export function verifyStripeCheckoutWebhook(input: Readonly<{
  rawBody: Uint8Array;
  signatureHeader: string | null;
  secret: string;
  mode: "test" | "live";
  now?: () => number;
  toleranceSeconds?: number;
}>): VerifiedStripeCheckoutEvent {
  if (!input.signatureHeader || input.secret.length < 16 || input.rawBody.byteLength === 0 || input.rawBody.byteLength > 1_048_576) {
    throw new StripeWebhookVerificationError();
  }
  const fields = input.signatureHeader.split(",").map((part) => part.trim().split("=", 2));
  const timestampText = fields.find(([name]) => name === "t")?.[1];
  const timestamps = Number(timestampText);
  const signatures = fields.filter(([name]) => name === "v1").map(([, value]) => value).filter((value): value is string => !!value && /^[a-f0-9]{64}$/i.test(value));
  const nowSeconds = Math.floor((input.now ?? Date.now)() / 1000);
  const tolerance = input.toleranceSeconds ?? 300;
  if (!Number.isSafeInteger(timestamps) || Math.abs(nowSeconds - timestamps) > tolerance || signatures.length === 0) {
    throw new StripeWebhookVerificationError();
  }
  const expected = createHmac("sha256", input.secret).update(`${timestampText}.${Buffer.from(input.rawBody).toString("utf8")}`).digest();
  const verified = signatures.some((signature) => {
    const actual = Buffer.from(signature, "hex");
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  });
  if (!verified) throw new StripeWebhookVerificationError();

  let event: unknown;
  try { event = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(input.rawBody)) as unknown; }
  catch { throw new StripeWebhookVerificationError(); }
  if (!object(event) || typeof event.id !== "string" || !/^evt_[A-Za-z0-9]+$/.test(event.id)
    || typeof event.type !== "string" || !allowedEvents.has(event.type)
    || !Number.isSafeInteger(event.created) || typeof event.livemode !== "boolean"
    || event.livemode !== (input.mode === "live") || !object(event.data) || !object(event.data.object)) {
    throw new StripeWebhookVerificationError();
  }
  const session = event.data.object;
  const status = session.status;
  const paymentStatus = session.payment_status;
  const amount = session.amount_total;
  const currency = session.currency;
  const expiry = session.expires_at;
  const paymentIntent = typeof session.payment_intent === "string" ? session.payment_intent
    : object(session.payment_intent) && typeof session.payment_intent.id === "string" ? session.payment_intent.id : null;
  if (typeof session.id !== "string" || !/^cs_(?:test_|live_)[A-Za-z0-9]+$/.test(session.id)
    || session.livemode !== event.livemode || !["open", "complete", "expired"].includes(String(status))
    || !["unpaid", "paid", "no_payment_required"].includes(String(paymentStatus))
    || !Number.isSafeInteger(amount) || typeof currency !== "string" || !/^[a-z]{3}$/.test(currency) || !Number.isSafeInteger(expiry)) {
    throw new StripeWebhookVerificationError();
  }
  const accountId = event.account === undefined ? "" : event.account;
  if (typeof accountId !== "string" || accountId.length > 255) throw new StripeWebhookVerificationError();
  const envelope: StripeEventEnvelope = Object.freeze({ eventId: event.id, eventType: event.type,
    mode: input.mode, accountId, eventCreatedAt: new Date(Number(event.created) * 1000).toISOString(), sessionId: session.id });
  return Object.freeze({ envelope, providerSession: Object.freeze({
    id: session.id, livemode: event.livemode, status: status as "open" | "complete" | "expired",
    paymentStatus: paymentStatus as "unpaid" | "paid" | "no_payment_required", amountTotal: amount as number,
    currency, expiresAt: expiry as number, paymentIntentId: paymentIntent,
  }) });
}
