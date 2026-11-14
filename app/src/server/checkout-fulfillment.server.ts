/** Shared verified Stripe payment fulfillment and durable webhook ingestion. */

import type { CheckoutRepository, EmbeddedCheckoutProvider, StripeEventEnvelope } from "./checkout.contract.server.ts";
import { StripeWebhookVerificationError, verifyStripeCheckoutWebhook } from "./stripe.webhook.server.ts";
import { StripeCheckoutError } from "./stripe.checkout.server.ts";

export class CheckoutFulfillmentError extends Error {
  readonly safeCode: "temporarily_unavailable" | "payment_truth_invalid";
  constructor(safeCode: CheckoutFulfillmentError["safeCode"]) { super(safeCode); this.name = "CheckoutFulfillmentError"; this.safeCode = safeCode; }
}

export type CheckoutWebhookService = Readonly<{
  handle(rawBody: Uint8Array, signatureHeader: string | null): Promise<Readonly<{ acknowledged: true }>>;
}>;

export function createCheckoutWebhookService(deps: Readonly<{
  repository: CheckoutRepository;
  provider: EmbeddedCheckoutProvider;
  secret: string;
  mode: "test" | "live";
  now?: () => number;
}>): CheckoutWebhookService {
  return Object.freeze({
    async handle(rawBody, signatureHeader) {
      let verified;
      try {
        verified = verifyStripeCheckoutWebhook({ rawBody, signatureHeader, secret: deps.secret, mode: deps.mode, now: deps.now });
      } catch (error) {
        if (error instanceof StripeWebhookVerificationError) throw error;
        throw new StripeWebhookVerificationError();
      }
      const envelope = verified.envelope;
      // Connect accounts are deliberately unsupported until the provider adapter can retrieve within that account.
      if (envelope.accountId !== "") throw new StripeWebhookVerificationError();
      try {
        const stored = await deps.repository.persistStripeEvent(envelope);
        if (stored.state === "processed" || stored.state === "ignored") return Object.freeze({ acknowledged: true as const });
        const session = await deps.provider.retrieveSession(envelope.sessionId);
        if (session.id !== envelope.sessionId || session.livemode !== (envelope.mode === "live")) {
          await deps.repository.markStripeEventResult(envelope, "retryable", "payment_truth_invalid");
          throw new CheckoutFulfillmentError("payment_truth_invalid");
        }
        if (session.status === "complete" && session.paymentStatus === "paid") {
          if (session.amountTotal !== 2500 || session.currency !== "usd" || session.paymentIntentId === null) {
            await deps.repository.markStripeEventResult(envelope, "retryable", "payment_truth_invalid");
            throw new CheckoutFulfillmentError("payment_truth_invalid");
          }
          const binding = await deps.repository.readReturnBindingByProviderSession(envelope.mode, envelope.sessionId);
          await deps.repository.fulfillPaidSession({ event: envelope, attemptId: binding.attemptId, session,
            verifiedAt: new Date((deps.now ?? Date.now)()).toISOString() });
          return Object.freeze({ acknowledged: true as const });
        }
        if (session.status === "expired" && session.paymentStatus === "unpaid") {
            await deps.repository.expireProviderSession(envelope.mode, envelope.sessionId);
          await deps.repository.markStripeEventResult(envelope, "ignored", "not_paid");
          return Object.freeze({ acknowledged: true as const });
        }
        if (envelope.eventType === "checkout.session.async_payment_failed" && session.status === "complete"
          && session.paymentStatus === "unpaid" && session.amountTotal === 2500 && session.currency === "usd") {
          await deps.repository.releaseFailedProviderSession(envelope, envelope.sessionId);
          return Object.freeze({ acknowledged: true as const });
        }
        if (envelope.eventType === "checkout.session.async_payment_failed") {
          await deps.repository.markStripeEventResult(envelope, "retryable", "payment_truth_invalid");
          throw new CheckoutFulfillmentError("payment_truth_invalid");
        }
        await deps.repository.markStripeEventResult(envelope, "ignored", "not_paid");
        return Object.freeze({ acknowledged: true as const });
      } catch (error) {
        if (error instanceof CheckoutFulfillmentError || error instanceof StripeCheckoutError) throw error;
        throw new CheckoutFulfillmentError("temporarily_unavailable");
      }
    },
  });
}

export type CheckoutReturnFulfillment = Readonly<{
  verifyOwnerSession(actorUserId: string, invitationId: string, attemptId: string, sessionId: string): Promise<void>;
}>;

