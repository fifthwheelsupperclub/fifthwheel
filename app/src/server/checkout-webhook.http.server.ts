/** Raw-body, signature-first Stripe webhook boundary. */

import { CheckoutFulfillmentError, type CheckoutWebhookService } from "./checkout-fulfillment.server.ts";
import { StripeCheckoutError } from "./stripe.checkout.server.ts";
import { StripeWebhookVerificationError } from "./stripe.webhook.server.ts";

const headers = { "cache-control": "no-store", "x-content-type-options": "nosniff" };
type ServiceFactory = () => CheckoutWebhookService | null;

async function readBoundedBody(request: Request): Promise<Uint8Array | null> {
  const length = request.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > 1_048_576)) return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > 1_048_576) { await reader.cancel(); return null; }
      chunks.push(next.value);
    }
  } catch { return null; }
  finally { reader.releaseLock(); }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return body;
}

export function createCheckoutWebhookHttpHandler(getService: ServiceFactory) {
  return Object.freeze({
    async handle(request: Request): Promise<Response> {
      if (request.method !== "POST") return Response.json({ received: false }, { status: 405, headers: { ...headers, allow: "POST" } });
      const body = await readBoundedBody(request);
      if (!body) return Response.json({ received: false }, { status: 400, headers });
      try {
        const service = getService();
        if (!service) return Response.json({ received: false }, { status: 503, headers });
        await service.handle(body, request.headers.get("stripe-signature"));
        return Response.json({ received: true }, { status: 200, headers });
      } catch (error) {
        if (error instanceof StripeWebhookVerificationError) return Response.json({ received: false }, { status: 400, headers });
        if (error instanceof StripeCheckoutError || error instanceof CheckoutFulfillmentError) {
          return Response.json({ received: false }, { status: 503, headers });
        }
        return Response.json({ received: false }, { status: 503, headers });
      }
    },
  });
}
