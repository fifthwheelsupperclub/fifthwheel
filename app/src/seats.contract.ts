/** Browser-safe W07.3 member Seat read DTOs. Import types only from UI modules. */

export type MemberSeatState = "confirmed" | "cancellation_requested" | "cancelled" | "completed";
export type MemberPaymentState = "paid" | "refund_pending" | "refunded" | "unknown";
export type MemberRefundState = "open" | "pending" | "submitted" | "unknown" | "failed" | "succeeded";

export type MemberSeatItineraryStopDTO = Readonly<{
  role: "drinks" | "dinner" | "dessert";
  venueName: string;
  venueAddress: string;
  minutesFromStart: number;
  publicNotes: string;
}>;

export type MemberSeatTableDTO = Readonly<{
  tableId: string;
  title: string;
  localDate: string;
  startLocalTime: string;
  timeZone: "America/New_York";
  startsAt: string;
  neighborhood: string;
  itinerary: readonly [MemberSeatItineraryStopDTO, MemberSeatItineraryStopDTO, MemberSeatItineraryStopDTO];
}>;

export type MemberSeatTableSummaryDTO = Omit<MemberSeatTableDTO, "itinerary">;

export type MemberSeatPaymentSummaryDTO = Readonly<{
  state: MemberPaymentState;
  amountCents: 2500;
  currency: "USD";
  paidAt: string | null;
}>;

export type MemberSeatPaymentDTO = Readonly<{
  state: MemberPaymentState;
  amountCents: 2500;
  currency: "USD";
  paidAt: string | null;
  receipt:
    | Readonly<{ state: "available"; url: string }>
    | Readonly<{ state: "unavailable" | "unknown"; url: null }>;
}>;

export type MemberSeatRefundDTO = Readonly<{
  state: MemberRefundState;
  amountCents: number;
  currency: "USD";
}>;

export type MemberSeatSummaryDTO = Readonly<{
  seatId: string;
  state: MemberSeatState;
  participationState: "current" | "past";
  createdAt: string;
  table: MemberSeatTableSummaryDTO;
  payment: MemberSeatPaymentSummaryDTO;
  refund: MemberSeatRefundDTO | null;
  calendar: Readonly<{ available: boolean; href: string | null }>;
}>;

export type MemberSeatCancellationDTO = Readonly<{
  status: "none" | "pending" | "approved" | "denied";
  history: readonly Readonly<{
    requestId: string;
    status: "pending" | "approved" | "denied";
    requestedAt: string;
    decidedAt: string | null;
    safeReason: string | null;
  }>[];
}>;

export type MemberSeatDTO = MemberSeatSummaryDTO;

export type MemberSeatDetailDTO = MemberSeatSummaryDTO & Readonly<{
  table: MemberSeatTableDTO;
  payment: MemberSeatPaymentDTO;
  cancellation: MemberSeatCancellationDTO;
}>;

export type MemberPendingCheckoutDTO = Readonly<{
  attemptId: string;
  invitationId: string;
  state: "checkout_open" | "processing" | "unknown" | "failed" | "expired" | "refund_pending";
  nextAction: "resume_checkout" | "check_status" | "retry_invitation" | "contact_support" | "none";
  createdAt: string;
  holdUntil: string;
  price: Readonly<{ amountCents: 2500; currency: "USD" }>;
  payment: Readonly<{ state: "not_started" | "processing" | "paid" | "refund_pending" | "refunded" | "unknown"; amountCents: 2500; currency: "USD"; paidAt: string | null }>;
  refund: MemberSeatRefundDTO | null;
  table: MemberSeatTableSummaryDTO;
}>;

export type MemberSeatListDTO = Readonly<{
  items: readonly MemberSeatSummaryDTO[];
  pendingCheckouts: readonly MemberPendingCheckoutDTO[];
  nextCursor: string | null;
}>;

export type SeatStatusReaderResult =
  | Readonly<{ status: "confirmed_seat" }>
  | Readonly<{ status: "no_confirmed_seat" }>
  | Readonly<{ status: "unknown" }>;

export type MemberSeatErrorCode = "unauthenticated" | "forbidden" | "not_found" | "invalid_input" | "conflict" | "temporarily_unavailable";
export type MemberSeatResponse<T> =
  | Readonly<{ ok: true; data: T; correlationId: string }>
  | Readonly<{ ok: false; correlationId: string; error: Readonly<{
      code: MemberSeatErrorCode;
      safeMessage: string;
      retryable: boolean;
      correlationId: string;
    }> }>;
