import { randomUUID } from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";
import { createTableInvitationHttpRuntime } from "../../../server/table-invitations-runtime.server.ts";

function unavailable() {
  return Response.json({ ok: false, error: { code: "temporarily_unavailable", safeMessage: "Invitation delivery is temporarily unavailable.", retryable: true, correlationId: randomUUID() } }, {
    status: 503, headers: { "cache-control": "private, no-store", "referrer-policy": "no-referrer", vary: "Cookie, Origin" },
  });
}

export const Route = createFileRoute("/api/admin/table-invitations/$invitationId/retry")({
  server: { handlers: { POST: async ({ request, params }) => {
    try { return await createTableInvitationHttpRuntime().retryFailedDelivery(request, params.invitationId); }
    catch { return unavailable(); }
  } } },
});
