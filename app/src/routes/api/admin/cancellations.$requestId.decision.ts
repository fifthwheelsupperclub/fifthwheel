import { randomUUID } from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";
import { createSeatCancellationHttpRuntime } from "../../../server/seat-cancellation-runtime.server.ts";

function unavailable() {
  const correlationId = randomUUID();
  return Response.json({ ok: false, correlationId, error: { code: "temporarily_unavailable", safeMessage: "Cancellation service is temporarily unavailable. Try again shortly.", retryable: true, correlationId } }, {
    status: 503, headers: { "cache-control": "private, no-store", "referrer-policy": "no-referrer", vary: "Cookie, Origin" },
  });
}

export const Route = createFileRoute("/api/admin/cancellations/$requestId/decision")({ server: { handlers: {
  POST: async ({ request, params }) => { try { return await createSeatCancellationHttpRuntime().decideAdminRequest(request, params.requestId); } catch { return unavailable(); } },
} } });
