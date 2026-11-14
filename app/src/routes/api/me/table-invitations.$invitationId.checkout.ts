import { randomUUID } from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";
import { createCheckoutHttpRuntime } from "../../../server/checkout-runtime.server.ts";

function unavailable() {
  const correlationId = randomUUID();
  return Response.json({ ok: false, correlationId, error: {
    code: "temporarily_unavailable", safeMessage: "Checkout is temporarily unavailable. Try again shortly.", retryable: true, correlationId,
  } }, { status: 503, headers: { "cache-control": "private, no-store", "referrer-policy": "no-referrer", vary: "Cookie, Origin" } });
}

export const Route = createFileRoute("/api/me/table-invitations/$invitationId/checkout")({
  server: { handlers: {
    GET: async ({ request, params }) => {
      try { return await createCheckoutHttpRuntime().readEligibility(request, params.invitationId); }
      catch { return unavailable(); }
    },
    POST: async ({ request, params }) => {
      try { return await createCheckoutHttpRuntime().beginCheckout(request, params.invitationId); }
      catch { return unavailable(); }
    },
  } },
});
