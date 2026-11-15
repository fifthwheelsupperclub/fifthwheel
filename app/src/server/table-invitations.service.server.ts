/** W06.5 role gates, input checks and safe error mapping. */

import { authorize } from "./authorization.server.ts";
import type {
  TableInvitationService, TableInvitationServiceDependencies, TableInvitationServiceResult,
  TableInvitationFailureCode, InvitationHistoryInput, MemberInvitationInput, AdminInvitationInput, RetryInvitationInput,
  ReconcileInvitationInput,
} from "./table-invitations.contract.server.ts";
import type {
  AdminTableInvitationListDTO, MemberTableInvitationDetailDTO, RetryTableInvitationDeliveryResultDTO,
  ReconcileTableInvitationDeliveryResultDTO, TableInvitationErrorCode,
} from "../table-invitations.contract.ts";
import { TableInvitationRepositoryError } from "./table-invitations.repository.server.ts";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const cursorPattern = /^\d{4}-\d{2}-\d{2}T[^|]{1,40}\|[0-9a-f-]{36}$/i;

function fail<T>(code: TableInvitationFailureCode, safeMessage: string): TableInvitationServiceResult<T> {
  return { ok: false, error: { code, safeMessage } };
}

function mapRepositoryError<T>(error: unknown): TableInvitationServiceResult<T> {
  if (error instanceof TableInvitationRepositoryError) {
    switch (error.code) {
      case "forbidden": return fail("forbidden", "You do not have access to this invitation.");
      case "not_found": return fail("not_found", "This invitation could not be found.");
      case "invalid_input": return fail("invalid_input", "Something went wrong. Reload and try again.");
      case "operation_conflict": return fail("operation_conflict", "Something changed. Reload and try again.");
      case "attempt_not_retryable": return fail("attempt_not_retryable", "This delivery cannot be retried in its current state.");
      case "attempt_reconciliation_required": return fail("attempt_reconciliation_required", "Check status before sending again.");
      case "attempt_busy": return fail("attempt_busy", "This delivery is already being processed. Try again shortly.");
      case "configuration_invalid":
      case "request_failed":
      case "response_invalid": return fail("temporarily_unavailable", "Invitation delivery is temporarily unavailable.");
    }
  }
  return fail("temporarily_unavailable", "Invitation delivery is temporarily unavailable.");
}

function validPage(input: InvitationHistoryInput): boolean {
  return Number.isSafeInteger(input.limit) && input.limit >= 1 && input.limit <= 50
    && (input.cursor === undefined || input.cursor.length <= 150 && cursorPattern.test(input.cursor));
}

export function createTableInvitationService(dependencies: TableInvitationServiceDependencies): TableInvitationService {
  type Resolution = Readonly<{ ok: true; principal: import("./authorization.server.ts").ServerVerifiedPrincipal }>
    | Readonly<{ ok: false; code: "unauthenticated" | "temporarily_unavailable" }>;
  async function resolve(token: string | null | undefined): Promise<Resolution> {
    if (typeof token !== "string" || token.trim().length === 0) return { ok: false, code: "unauthenticated" };
    try {
      const principal = await dependencies.resolvePrincipal(token);
      return principal ? { ok: true, principal } : { ok: false, code: "unauthenticated" };
    } catch {
      // Auth/provider or role lookup failure is infrastructure uncertainty, not proof of bad credentials.
      return { ok: false, code: "temporarily_unavailable" };
    }
  }
  function resolveFailure<T>(resolution: Extract<Resolution, { ok: false }>): TableInvitationServiceResult<T> {
    return resolution.code === "unauthenticated"
      ? fail("unauthenticated", "Sign in to continue.")
      : fail("temporarily_unavailable", "Invitation delivery is temporarily unavailable.");
  }

  return Object.freeze({
    async readMemberInvitation(input: MemberInvitationInput) {
      if (!uuidPattern.test(input.invitationId)) return fail<MemberTableInvitationDetailDTO>("invalid_input", "Use a valid invitation link.");
      const resolution = await resolve(input.accessToken);
      if (!resolution.ok) return resolveFailure<MemberTableInvitationDetailDTO>(resolution);
      if (!authorize(resolution.principal, { workspace: "member", action: "member:read-own" }).allowed) return fail<MemberTableInvitationDetailDTO>("forbidden", "You don’t have access yet.");
      try { return { ok: true as const, value: await dependencies.repository.readMemberInvitation(resolution.principal.userId, input.invitationId) }; }
      catch (error) { return mapRepositoryError<MemberTableInvitationDetailDTO>(error); }
    },

    async listAdminInvitations(input: AdminInvitationInput) {
      if (!validPage(input)) return fail<AdminTableInvitationListDTO>("invalid_input", "Check the invitation history page.");
      const resolution = await resolve(input.accessToken);
      if (!resolution.ok) return resolveFailure<AdminTableInvitationListDTO>(resolution);
      if (!authorize(resolution.principal, { workspace: "admin", action: "roster:read" }).allowed) {
        return fail<AdminTableInvitationListDTO>("forbidden", "Only admins can do this.");
      }
      try { return { ok: true as const, value: await dependencies.repository.listAdminInvitations(resolution.principal.userId, input) }; }
      catch (error) { return mapRepositoryError<AdminTableInvitationListDTO>(error); }
    },

    async retryFailedDelivery(input: RetryInvitationInput) {
      if (!uuidPattern.test(input.invitationId) || !uuidPattern.test(input.request.operationId)
        || !Number.isSafeInteger(input.request.expectedAttemptCount) || input.request.expectedAttemptCount < 1) {
        return fail<RetryTableInvitationDeliveryResultDTO>("invalid_input", "Refresh delivery status before retrying.");
      }
      const resolution = await resolve(input.accessToken);
      if (!resolution.ok) return resolveFailure<RetryTableInvitationDeliveryResultDTO>(resolution);
      if (!authorize(resolution.principal, { workspace: "admin", action: "roster:approve" }).allowed) {
        return fail<RetryTableInvitationDeliveryResultDTO>("forbidden", "Only admins can do this.");
      }
      try { return { ok: true as const, value: await dependencies.repository.retryFailedDelivery(resolution.principal.userId, input.invitationId, input.request) }; }
      catch (error) { return mapRepositoryError<RetryTableInvitationDeliveryResultDTO>(error); }
    },

    async reconcileUnknown(input: ReconcileInvitationInput) {
      if (!uuidPattern.test(input.invitationId) || !Number.isSafeInteger(input.request.expectedAttemptCount) || input.request.expectedAttemptCount < 1) {
        return fail<ReconcileTableInvitationDeliveryResultDTO>("invalid_input", "Refresh delivery status before checking it.");
      }
      const resolution = await resolve(input.accessToken);
      if (!resolution.ok) return resolveFailure<ReconcileTableInvitationDeliveryResultDTO>(resolution);
      if (!authorize(resolution.principal, { workspace: "admin", action: "roster:read" }).allowed) {
        return fail<ReconcileTableInvitationDeliveryResultDTO>("forbidden", "Only admins can do this.");
      }
      if (!dependencies.reconcileUnknownDelivery) return fail<ReconcileTableInvitationDeliveryResultDTO>("temporarily_unavailable", "Check status before sending again.");
      try { return { ok: true as const, value: await dependencies.reconcileUnknownDelivery(input.invitationId, input.request.expectedAttemptCount) }; }
      catch (error) { return mapRepositoryError<ReconcileTableInvitationDeliveryResultDTO>(error); }
    },
  });
}
