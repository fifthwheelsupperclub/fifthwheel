/** Server-only Table invitation worker. Delivery is confined to the injected provider; local runtime uses loopback Mailpit. */

import type { TableInvitationDeliveryWorker, TableInvitationDeliveryWorkerRepository } from "./table-invitations.contract.server.ts";
import type { TableInvitationMailInput, TableInvitationMailResult } from "./table-invitation.email.mailpit.server.ts";
import { TableInvitationRepositoryError } from "./table-invitations.repository.server.ts";

export interface TableInvitationEmailProvider {
  sendInvitation(input: TableInvitationMailInput): Promise<TableInvitationMailResult>;
  reconcile(input: Readonly<{ invitationId: string; attemptId: string; recipientEmail: string; providerMessageId?: string }>): Promise<TableInvitationMailResult>;
}

export function createTableInvitationDeliveryWorker(dependencies: Readonly<{
  repository: TableInvitationDeliveryWorkerRepository;
  emailProvider: TableInvitationEmailProvider;
  createOperationId?: () => string;
}>): TableInvitationDeliveryWorker {
  const createOperationId = dependencies.createOperationId ?? (() => crypto.randomUUID());
  return Object.freeze({
    async deliverNext() {
      const claim = await dependencies.repository.beginNextAttempt(createOperationId());
      if (!claim) return Object.freeze({ state: "idle" as const });
      if (!claim.created) return Object.freeze({ state: "unknown" as const, invitationId: claim.invitationId, attemptNumber: claim.attemptNumber });
      let context;
      try { context = await dependencies.repository.readDeliveryContext(claim.invitationId); }
      catch {
        await dependencies.repository.finishAttempt({ attemptId: claim.attemptId, state: "failed", safeErrorCode: "delivery_context_unavailable" });
        return Object.freeze({ state: "failed" as const, invitationId: claim.invitationId, attemptNumber: claim.attemptNumber });
      }
      if (!context) {
        await dependencies.repository.finishAttempt({ attemptId: claim.attemptId, state: "failed", safeErrorCode: "delivery_context_unavailable" });
        return Object.freeze({ state: "failed" as const, invitationId: claim.invitationId, attemptNumber: claim.attemptNumber });
      }
      let result: TableInvitationMailResult;
      try { result = await dependencies.emailProvider.sendInvitation({ ...context, attemptId: claim.attemptId }); }
      catch { result = { state: "unknown", safeErrorCode: "delivery_outcome_unknown" }; }
      await dependencies.repository.finishAttempt({ attemptId: claim.attemptId, state: result.state,
        ...(result.state === "accepted" ? { providerMessageId: result.providerMessageId } : { safeErrorCode: result.safeErrorCode }) });
      return Object.freeze({ state: result.state, invitationId: claim.invitationId, attemptNumber: claim.attemptNumber });
    },

    async reconcileUnknown(invitationId: string, expectedAttemptCount: number) {
      const context = await dependencies.repository.readUnknownContext(invitationId, expectedAttemptCount);
      if (!context) throw new TableInvitationRepositoryError("not_found");
      let result: TableInvitationMailResult;
      try { result = await dependencies.emailProvider.reconcile({ invitationId, attemptId: context.attemptId,
        recipientEmail: context.recipientEmail, ...(context.providerMessageId ? { providerMessageId: context.providerMessageId } : {}) }); }
      catch { result = { state: "unknown", safeErrorCode: "mailpit_reconcile_unknown" }; }
      if (result.state === "accepted") {
        await dependencies.repository.reconcileUnknownAttempt(context.attemptId, "accepted", result.providerMessageId);
        return Object.freeze({ state: "accepted" as const, invitationId, attemptNumber: context.attemptNumber });
      }
      // No match, deleted/pruned record, or Mailpit outage leaves the attempt unknown and never resends.
      return Object.freeze({ state: "unknown" as const, invitationId, attemptNumber: context.attemptNumber });
    },
  });
}
