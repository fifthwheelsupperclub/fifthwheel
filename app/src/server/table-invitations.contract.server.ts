/** Server-only W06.5 invitation history and delivery recovery contracts. */

import type {
  AdminTableInvitationListDTO, MemberTableInvitationDetailDTO,
  RetryTableInvitationDeliveryRequest, RetryTableInvitationDeliveryResultDTO,
  ReconcileTableInvitationDeliveryRequest, ReconcileTableInvitationDeliveryResultDTO,
} from "../table-invitations.contract.ts";

export type TableInvitationFailureCode =
  | "unauthenticated" | "forbidden" | "not_found" | "invalid_input" | "operation_conflict"
  | "attempt_not_retryable" | "attempt_reconciliation_required" | "attempt_busy" | "temporarily_unavailable";
export type TableInvitationFailure = Readonly<{ code: TableInvitationFailureCode; safeMessage: string }>;
export type TableInvitationServiceResult<T> = Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; error: TableInvitationFailure }>;

export type InvitationHistoryInput = Readonly<{ accessToken?: string | null; cursor?: string; limit: number }>;
export type MemberInvitationInput = Readonly<{ accessToken?: string | null; invitationId: string }>;
export type AdminInvitationInput = InvitationHistoryInput;
export type RetryInvitationInput = Readonly<{
  accessToken?: string | null; invitationId: string; request: RetryTableInvitationDeliveryRequest;
}>;
export type ReconcileInvitationInput = Readonly<{
  accessToken?: string | null; invitationId: string; request: ReconcileTableInvitationDeliveryRequest;
}>;

export interface TableInvitationRepository {
  readMemberInvitation(actorUserId: string, invitationId: string): Promise<MemberTableInvitationDetailDTO>;
  listAdminInvitations(actorUserId: string, input: Readonly<{ cursor?: string; limit: number }>): Promise<AdminTableInvitationListDTO>;
  retryFailedDelivery(actorUserId: string, invitationId: string, request: RetryTableInvitationDeliveryRequest): Promise<RetryTableInvitationDeliveryResultDTO>;
}

/** Private worker RPC boundary. These methods persist delivery outcomes; they do not send mail. */
export type TableInvitationWorkerResult = Readonly<{
  deliveryState: import("../table-invitations.contract.ts").TableInvitationDeliveryState;
  attemptNumber: number;
  changed: boolean;
}>;
export interface TableInvitationDeliveryWorkerRepository {
  beginNextAttempt(operationId: string): Promise<Readonly<{ outboxId: string; invitationId: string; attemptId: string; attemptNumber: number; created: boolean }> | null>;
  readDeliveryContext(invitationId: string): Promise<TableInvitationDeliveryContext | null>;
  readUnknownContext(invitationId: string, expectedAttemptCount: number): Promise<TableInvitationDeliveryContext & Readonly<{
    attemptId: string; attemptNumber: number; providerMessageId: string | null;
  }> | null>;
  beginAttempt(outboxId: string, operationId: string): Promise<Readonly<{ attemptId: string; attemptNumber: number; created: boolean }> | null>;
  finishAttempt(input: Readonly<{ attemptId: string; state: Exclude<import("../table-invitations.contract.ts").TableInvitationAttemptState, "sending">;
    providerMessageId?: string; safeErrorCode?: string }>): Promise<TableInvitationWorkerResult>;
  markDelivered(attemptId: string, providerMessageId: string): Promise<TableInvitationWorkerResult>;
  reconcileUnknownAttempt(attemptId: string, state: "accepted" | "failed", providerMessageId?: string): Promise<TableInvitationWorkerResult>;
  expireLeases(): Promise<number>;
  reconcileUnknown(input: Readonly<{ attemptId: string; state: Exclude<import("../table-invitations.contract.ts").TableInvitationAttemptState, "sending" | "unknown">;
    providerMessageId?: string }>): Promise<TableInvitationWorkerResult>;
}
export type TableInvitationDeliveryContext = Readonly<{
  invitationId: string; recipientEmail: string;
  table: Readonly<{ title: string; localDate: string; startLocalTime: string; neighborhood: string }>;
}>;
export type TableInvitationDeliveryWorker = Readonly<{
  deliverNext(): Promise<Readonly<{ state: "idle" | "accepted" | "failed" | "unknown"; invitationId?: string; attemptNumber?: number }>>;
  reconcileUnknown(invitationId: string, expectedAttemptCount: number): Promise<Readonly<{ state: "accepted" | "unknown"; invitationId: string; attemptNumber: number }>>;
}>;

export type TableInvitationServiceDependencies = Readonly<{
  resolvePrincipal: (accessToken: string | null | undefined) => Promise<import("./authorization.server.ts").ServerVerifiedPrincipal | null>;
  repository: TableInvitationRepository;
  reconcileUnknownDelivery?: (invitationId: string, expectedAttemptCount: number) => Promise<ReconcileTableInvitationDeliveryResultDTO>;
}>;

export interface TableInvitationService {
  readMemberInvitation(input: MemberInvitationInput): Promise<TableInvitationServiceResult<MemberTableInvitationDetailDTO>>;
  listAdminInvitations(input: AdminInvitationInput): Promise<TableInvitationServiceResult<AdminTableInvitationListDTO>>;
  retryFailedDelivery(input: RetryInvitationInput): Promise<TableInvitationServiceResult<RetryTableInvitationDeliveryResultDTO>>;
  reconcileUnknown(input: ReconcileInvitationInput): Promise<TableInvitationServiceResult<ReconcileTableInvitationDeliveryResultDTO>>;
}
