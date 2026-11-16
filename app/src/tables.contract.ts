/** Browser-safe DTOs for a member's own Table placements. Never expose supply source IDs. */

export type OwnTableRequestDTO = Readonly<{
  requestId: string;
  tableId: string;
  state: "pending" | "withdrawn" | "declined" | "closed_by_table";
  declineReason: string | null;
  createdAt: string;
  updatedAt: string;
}>;

export type TableStopDTO = Readonly<{
  role: "drinks" | "dinner" | "dessert";
  venueName: string;
  venueAddress: string;
  minutesFromStart: number;
  publicNotes: string;
}>;

export type TableRequestHistoryItemDTO = OwnTableRequestDTO & Readonly<{
  table: Readonly<{
    tableId: string;
    title: string;
    localDate: string;
    startLocalTime: string;
    neighborhood: string;
    isCurrentlyPublished: boolean;
  }>;
  tableInvitation: import("./table-invitations.contract.ts").TableInvitationHistorySummaryDTO | null;
}>;

export type TableRequestHistoryDTO = Readonly<{
  items: readonly TableRequestHistoryItemDTO[];
  nextCursor: string | null;
}>;

export type TableRequestErrorCode = "unauthenticated" | "forbidden" | "not_found"
  | "invalid_input" | "operation_conflict" | "temporarily_unavailable";

export type TableRequestSuccess<T> = Readonly<{ ok: true; data: T; correlationId: string }>;
export type TableRequestFailure = Readonly<{
  ok: false;
  error: Readonly<{
    code: TableRequestErrorCode;
    safeMessage: string;
    retryable: boolean;
    correlationId: string;
  }>;
}>;
export type TableRequestResponse<T> = TableRequestSuccess<T> | TableRequestFailure;
