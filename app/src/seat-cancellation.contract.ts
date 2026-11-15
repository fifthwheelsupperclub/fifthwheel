/** Browser-safe W07.4 member/admin cancellation request contracts. */

export type CancellationRequestState = "pending" | "approved" | "denied";
export type RequestAvailabilityReason = "available" | "request_pending" | "seat_not_active" | "payment_unresolved" | "table_closed";

export type MemberCancellationRequestDTO = Readonly<{
  requestId: string;
  seatId: string;
  state: CancellationRequestState;
  version: number;
  requestedAt: string;
  decidedAt: string | null;
  memberReason: string | null;
  memberSafeReason: string | null;
  refundCents: number | null;
}>;

export type RequestAvailabilityDTO = Readonly<{
  canRequest: boolean;
  reason: RequestAvailabilityReason;
}>;

export type MemberCancellationHistoryDTO = Readonly<{
  /** Server state, including Table completion, so pending-review copy stays accurate. */
  seatState: "confirmed" | "cancellation_requested" | "cancelled" | "completed";
  items: readonly MemberCancellationRequestDTO[];
  /** This compact per-Seat history currently returns in one response. */
  nextCursor: null;
  requestAvailability: RequestAvailabilityDTO;
}>;

export type RequestCancellationInput = Readonly<{
  operationId: string;
  memberReason?: string;
}>;

export type AdminCancellationQueueItemDTO = Readonly<{
  request: MemberCancellationRequestDTO;
  member: Readonly<{ guestId: string; displayName: string }>;
  table: Readonly<{ tableId: string; title: string; localDate: string; startLocalTime: string }>;
  seat: Readonly<{
    seatId: string;
    state: "confirmed" | "cancellation_requested" | "cancelled" | "completed";
    paidAt: string;
    amountCents: 2500;
    refundAvailableCents: number;
  }>;
}>;

export type AdminCancellationQueueDTO = Readonly<{
  items: readonly AdminCancellationQueueItemDTO[];
  nextCursor: string | null;
}>;

export type AdminCancellationDetailDTO = AdminCancellationQueueItemDTO & Readonly<{
  refundBalance: Readonly<{
    paidCents: 2500;
    refundCommittedCents: number;
    refundAvailableCents: number;
  }>;
}>;

export type DecideCancellationInput = Readonly<{
  operationId: string;
  expectedVersion: number;
  decision: "approve" | "deny";
  refundCents: number;
  memberSafeReason: string;
}>;

export type CancellationErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "invalid_input"
  | "request_pending"
  | "seat_not_cancellable"
  | "stale_version"
  | "refund_amount_exceeds_balance"
  | "decision_finalized"
  | "operation_conflict"
  | "temporarily_unavailable";

export type CancellationResponse<T> =
  | Readonly<{ ok: true; data: T; correlationId: string }>
  | Readonly<{ ok: false; correlationId: string; error: Readonly<{
      code: CancellationErrorCode;
      safeMessage: string;
      retryable: boolean;
      correlationId: string;
    }> }>;
