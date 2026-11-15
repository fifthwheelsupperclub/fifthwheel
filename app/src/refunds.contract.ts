/** Browser-safe W07.5 refund operations DTOs. Never add provider IDs or raw provider errors. */

export type RefundObligationSource = "late_checkout_ineligible" | "cancellation";
export type RefundObligationState = "open" | "pending" | "submitted" | "unknown" | "failed" | "succeeded";
export type RefundOperationState = "pending" | "submitted" | "unknown" | "failed" | "succeeded";

export type RefundOperationDTO = Readonly<{
  operationId: string;
  amountCents: number;
  state: RefundOperationState;
  createdAt: string;
  updatedAt: string;
  safeCode: string | null;
  canRetry: boolean;
  canReconcile: boolean;
}>;

export type RefundObligationSummaryDTO = Readonly<{
  obligationId: string;
  source: RefundObligationSource;
  state: RefundObligationState;
  amountCents: number;
  currency: "USD";
  createdAt: string;
  updatedAt: string;
  memberName: string;
  tableTitle: string;
  reservedCents: number;
  availableCents: number;
  latestSafeCode: string | null;
  canDispatch: boolean;
  dispatchBlockedReason: null | "balance_reserved" | "operation_in_progress" | "manual_review" | "settled" | "provider_unavailable";
}>;

export type RefundDetailDTO = RefundObligationSummaryDTO & Readonly<{
  paymentAmountCents: number;
  refundedCents: number;
  operations: readonly RefundOperationDTO[];
}>;

export type RefundObligationDetailDTO = RefundDetailDTO;

export type RefundListDTO = Readonly<{
  items: readonly RefundObligationSummaryDTO[];
  nextCursor: string | null;
}>;

export type RefundActionDTO = Readonly<{
  operation: RefundOperationDTO;
  obligation: RefundObligationSummaryDTO;
}>;

export type RefundErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "invalid_input"
  | "conflict"
  | "operation_conflict"
  | "balance_exhausted"
  | "not_retryable"
  | "not_reconcilable"
  | "already_settled"
  | "temporarily_unavailable";

export type RefundResponse<T> =
  | Readonly<{ ok: true; data: T; correlationId: string }>
  | Readonly<{ ok: false; correlationId: string; error: Readonly<{
      code: RefundErrorCode;
      safeMessage: string;
      retryable: boolean;
      correlationId: string;
    }> }>;
