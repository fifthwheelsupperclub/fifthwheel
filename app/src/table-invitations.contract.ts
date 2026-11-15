/** Browser-safe W06.5 Table Invitation and delivery-recovery DTOs. */

import type { TableStopDTO } from "./tables.contract.ts";

export type TableInvitationState = "active" | "revoked" | "closed";
export type TableInvitationDeliveryState = "queued" | "sending" | "accepted" | "delivered" | "failed" | "unknown";
export type TableInvitationAttemptState = "sending" | "accepted" | "delivered" | "failed" | "unknown";

/** Safe per-request overlay. This never changes the underlying Seat-request state. */
export type TableInvitationHistorySummaryDTO = Readonly<{
  invitationId: string;
  state: TableInvitationState;
  deliveryState: TableInvitationDeliveryState;
  createdAt: string;
}>;

export type MemberTableInvitationDetailDTO = Readonly<{
  invitationId: string;
  state: TableInvitationState;
  createdAt: string;
  delivery: Readonly<{
    state: TableInvitationDeliveryState;
    attemptCount: number;
    lastAttemptAt: string | null;
  }>;
  table: Readonly<{
    tableId: string;
    title: string;
    localDate: string;
    startLocalTime: string;
    neighborhood: string;
    seatPriceCents: 2500;
    currency: "USD";
    stops: readonly TableStopDTO[];
    itineraryAvailable: boolean;
  }>;
}>;

export type AdminTableInvitationAttemptDTO = Readonly<{
  attemptNumber: number;
  state: TableInvitationAttemptState;
  startedAt: string;
  finishedAt: string | null;
  safeErrorCode: string | null;
}>;

export type AdminTableInvitationDTO = Readonly<{
  invitationId: string;
  invitationState: TableInvitationState;
  createdAt: string;
  guest: Readonly<{ guestId: string; displayName: string }>;
  table: Readonly<{
    tableId: string;
    title: string;
    localDate: string;
    startLocalTime: string;
    neighborhood: string;
  }>;
  delivery: Readonly<{
    outboxId: string;
    state: TableInvitationDeliveryState;
    attemptCount: number;
    queuedAt: string;
    nextAttemptAt: string;
    lastAttemptAt: string | null;
    safeErrorCode: string | null;
  }>;
  attempts: readonly AdminTableInvitationAttemptDTO[];
}>;

export type AdminTableInvitationListDTO = Readonly<{
  items: readonly AdminTableInvitationDTO[];
  nextCursor: string | null;
}>;

export type RetryTableInvitationDeliveryRequest = Readonly<{
  operationId: string;
  expectedAttemptCount: number;
}>;

export type RetryTableInvitationDeliveryResultDTO = Readonly<{
  invitationId: string;
  deliveryState: "queued";
  attemptCount: number;
  queuedAt: string;
  nextAttemptAt: string;
}>;

export type ReconcileTableInvitationDeliveryRequest = Readonly<{ expectedAttemptCount: number }>;
export type ReconcileTableInvitationDeliveryResultDTO = Readonly<{
  invitationId: string;
  deliveryState: "accepted" | "unknown";
  attemptCount: number;
}>;

export type TableInvitationErrorCode = "unauthenticated" | "forbidden" | "not_found" | "invalid_input"
  | "operation_conflict" | "attempt_not_retryable" | "attempt_reconciliation_required" | "attempt_busy"
  | "temporarily_unavailable";

export type TableInvitationResponse<T> =
  | Readonly<{ ok: true; data: T; correlationId: string }>
  | Readonly<{ ok: false; error: Readonly<{
      code: TableInvitationErrorCode;
      safeMessage: string;
      retryable: boolean;
      correlationId: string;
    }> }>;
