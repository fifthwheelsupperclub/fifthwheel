import { randomUUID } from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";
import { createRefundHttpRuntime } from "../../../server/refunds-runtime.server.ts";

function unavailable() {
  const correlationId = randomUUID();
  return Response.json({ ok: false, correlationId, error: { code: "temporarily_unavailable", safeMessage: "Refund service is temporarily unavailable. Try again shortly.", retryable: true, correlationId } }, {
    status: 503, headers: { "cache-control": "private, no-store", "referrer-policy": "no-referrer", vary: "Cookie, Origin" },
  });
}

export const Route = createFileRoute("/api/admin/refunds")({ server: { handlers: {
  GET: async ({ request }) => { try { return await createRefundHttpRuntime().listAdminRefunds(request); } catch { return unavailable(); } },
} } });
