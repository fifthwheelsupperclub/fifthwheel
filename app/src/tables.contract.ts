/** Browser-safe guest Table and Seat-request DTOs. Never expose supply source IDs. */

export type OwnTableRequestDTO = Readonly<{
  requestId: string;
  tableId: string;
  state: "pending" | "withdrawn" | "declined" | "closed_by_table";
  declineReason: string | null;
  createdAt: string;
  updatedAt: string;
}>;

export type TableSummaryDTO = Readonly<{
  tableId: string;
  title: string;
  localDate: string;
  startLocalTime: string;
  neighborhood: string;
  seatPriceCents: 2500;
  currency: "USD";
  ownRequest: OwnTableRequestDTO | null;
}>;

export type TableStopDTO = Readonly<{
  role: "drinks" | "dinner" | "dessert";
  venueName: string;
  venueAddress: string;
  minutesFromStart: number;
  publicNotes: string;
}>;

export type TableDetailDTO = TableSummaryDTO & Readonly<{
  stops: readonly TableStopDTO[];
  seatPriceCents: 2500;
}>;

export type MinimalTablePreviewDTO = Readonly<{
  tableId: string;
  title: string;
  localDate: string;
  neighborhood: string;
}>;

export type TableDetailResponseDTO =
  | Readonly<{ view: "preview"; table: MinimalTablePreviewDTO }>
  | Readonly<{ view: "member"; table: TableDetailDTO }>;

export type TableListDTO = Readonly<{
  items: readonly TableSummaryDTO[];
  nextCursor: string | null;
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

export type TableRequestErrorCode = "unauthenticated" | "forbidden" | "profile_incomplete" | "not_found"
  | "not_future" | "invalid_input" | "invalid_transition" | "operation_conflict" | "temporarily_unavailable";

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

export type TableRequestMutation = Readonly<{ operationId: string }>;
