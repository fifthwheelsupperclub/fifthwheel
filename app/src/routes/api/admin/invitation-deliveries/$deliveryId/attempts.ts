import { createFileRoute } from "@tanstack/react-router";
import { createAdminInvitationSendHandler } from "../../../../../server/invitation-delivery.http.server.ts";
import { createInvitationDeliveryService } from "../../../../../server/invitation-delivery.service.server.ts";
import { createAdmissionRuntime } from "../../../../../server/admission-runtime.server.ts";

function createHandler() {
  const runtime = createAdmissionRuntime();
  const repository = runtime.admissionRepository;
  const service = createInvitationDeliveryService({
    resolvePrincipal: runtime.resolvePrincipal,
    getContext: (deliveryId) => repository.findInvitationDeliveryContext(deliveryId),
    beginAttempt: (input) => repository.beginDeliveryAttempt(input),
    finishAttempt: (input) => repository.finishDeliveryAttempt(input),
    getLatestAttempt: async (deliveryId) => {
      const attempt = await repository.getLatestDeliveryAttempt(deliveryId);
      return attempt ? { id: attempt.id, state: attempt.state, provider_message_id: attempt.provider_message_id } : null;
    },
    reconcileAttempt: (input) => repository.reconcileUnknownDeliveryAttempt({
      attemptId: input.attemptId,
      state: input.state,
      ...(input.providerMessageId ? { providerMessageId: input.providerMessageId } : {}),
      resolvedAt: input.resolvedAt,
    }),
    authProvider: runtime.authProvider,
    emailProvider: runtime.emailProvider,
    appOrigin: runtime.appOrigin,
  });
  return createAdminInvitationSendHandler(service, runtime.appOrigin);
}

export const Route = createFileRoute("/api/admin/invitation-deliveries/$deliveryId/attempts")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        try {
          return await createHandler()(request, params.deliveryId);
        } catch {
          return Response.json({ error: { code: "temporarily_unavailable", message: "The invitation could not be sent. Try again later." } }, {
            status: 503,
            headers: { "cache-control": "no-store", vary: "Cookie, Origin" },
          });
        }
      },
    },
  },
});
