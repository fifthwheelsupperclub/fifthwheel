import { createFileRoute } from "@tanstack/react-router";
import { createCheckoutWebhookHttpRuntime } from "../../../server/checkout-runtime.server.ts";

function unavailable() {
  return Response.json({ received: false }, { status: 503, headers: {
    "cache-control": "no-store", "x-content-type-options": "nosniff",
  } });
}

export const Route = createFileRoute("/api/webhooks/stripe")({
  server: { handlers: {
    POST: async ({ request }) => {
      // Pass the original Request through so signature verification consumes exact raw bytes.
      try { return await createCheckoutWebhookHttpRuntime().handle(request); }
      catch { return unavailable(); }
    },
  } },
});
