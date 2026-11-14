/** Service-role RPC adapter for owner-checked W07.3 Seat reads. */

import type {
  MemberPendingCheckoutDTO, MemberSeatCancellationDTO, MemberSeatDetailDTO,
  MemberSeatListDTO, MemberSeatPaymentDTO, MemberSeatPaymentSummaryDTO, MemberSeatRefundDTO,
  MemberSeatState, MemberSeatSummaryDTO, MemberSeatTableDTO, MemberSeatTableSummaryDTO,
  SeatStatusReaderResult,
} from "../seats.contract.ts";
import type { SeatRepository } from "./seats.contract.server.ts";

export type SeatRepositoryErrorCode = "request_failed" | "response_invalid" | "not_found" | "invalid_input" | "forbidden";
export class SeatRepositoryError extends Error {
  readonly code: SeatRepositoryErrorCode;
  constructor(code: SeatRepositoryErrorCode) { super(code); this.name = "SeatRepositoryError"; this.code = code; }
}
type Config = Readonly<{ url: string; secretKey: string; fetch?: typeof fetch }>;
type RecordValue = Record<string, unknown>;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const record = (x: unknown): x is RecordValue => typeof x === "object" && x !== null && !Array.isArray(x);
const instant = (x: unknown): x is string => typeof x === "string" && Number.isFinite(Date.parse(x));
function requireText(x: unknown, max = 500): string {
  if (typeof x !== "string" || x.length > max) throw new SeatRepositoryError("response_invalid");
  return x;
}
function requireEnum<T extends string>(x: unknown, values: readonly T[]): T {
  if (typeof x !== "string" || !values.includes(x as T)) throw new SeatRepositoryError("response_invalid");
  return x as T;
}
const seatStates = ["confirmed", "cancellation_requested", "cancelled", "completed"] as const;
const paymentStates = ["paid", "refund_pending", "refunded", "unknown"] as const;
const refundStates = ["open", "pending", "submitted", "unknown", "failed", "succeeded"] as const;
const pendingStates = ["checkout_open", "processing", "unknown", "failed", "expired"] as const;
const actions = ["resume_checkout", "check_status", "retry_invitation", "contact_support", "none"] as const;
const roles = ["drinks", "dinner", "dessert"] as const;

function parseTableSummary(x: unknown): MemberSeatTableSummaryDTO {
  if (!record(x) || !uuid.test(String(x.tableId)) || !instant(x.startsAt) || x.timeZone !== "America/New_York"
    || !/^\d{4}-\d{2}-\d{2}$/.test(String(x.localDate)) || !/^\d{2}:\d{2}$/.test(String(x.startLocalTime))) {
    throw new SeatRepositoryError("response_invalid");
  }
  return Object.freeze({ tableId: x.tableId as string, title: requireText(x.title, 180), localDate: x.localDate as string,
    startLocalTime: x.startLocalTime as string, timeZone: "America/New_York", startsAt: x.startsAt as string,
    neighborhood: requireText(x.neighborhood, 180) });
}
function parseTable(x: unknown): MemberSeatTableDTO {
  if (!record(x) || !Array.isArray(x.itinerary) || x.itinerary.length !== 3) throw new SeatRepositoryError("response_invalid");
  const base = parseTableSummary(x);
  const itinerary = x.itinerary.map((stop, index) => {
    if (!record(stop) || stop.role !== roles[index] || !Number.isSafeInteger(stop.minutesFromStart)
      || Number(stop.minutesFromStart) < 0 || Number(stop.minutesFromStart) > 720) throw new SeatRepositoryError("response_invalid");
    return Object.freeze({ role: roles[index]!, venueName: requireText(stop.venueName, 180),
      venueAddress: requireText(stop.venueAddress, 400), minutesFromStart: Number(stop.minutesFromStart),
      publicNotes: requireText(stop.publicNotes, 500) });
  }) as unknown as MemberSeatTableDTO["itinerary"];
  return Object.freeze({ ...base, itinerary });
}
function parseRefund(x: unknown): MemberSeatRefundDTO | null {
  if (x === null) return null;
  if (!record(x) || x.currency !== "USD" || !Number.isSafeInteger(x.amountCents) || Number(x.amountCents) < 0 || Number(x.amountCents) > 2500) {
    throw new SeatRepositoryError("response_invalid");
  }
  return Object.freeze({ state: requireEnum(x.state, refundStates), amountCents: Number(x.amountCents), currency: "USD" });
}
function parsePaymentSummary(x: unknown): MemberSeatPaymentSummaryDTO {
  if (!record(x) || x.amountCents !== 2500 || x.currency !== "USD" || !(x.paidAt === null || instant(x.paidAt))) {
    throw new SeatRepositoryError("response_invalid");
  }
  return Object.freeze({ state: requireEnum(x.state, paymentStates), amountCents: 2500, currency: "USD", paidAt: x.paidAt as string | null });
}
function parseSummary(x: unknown): MemberSeatSummaryDTO {
  if (!record(x) || !uuid.test(String(x.seatId)) || !instant(x.createdAt)
    || typeof x.calendar !== "object" || x.calendar === null || !record(x.calendar) || typeof x.calendar.available !== "boolean") {
    throw new SeatRepositoryError("response_invalid");
  }
  const state = requireEnum(x.state, seatStates);
  const participationState = requireEnum(x.participationState, ["current", "past"] as const);
  if ((state === "cancelled" || state === "completed") && x.calendar.available) throw new SeatRepositoryError("response_invalid");
  const href = x.calendar.available ? `/api/me/seats/${String(x.seatId)}/calendar.ics` : null;
  if (x.calendar.href !== href) throw new SeatRepositoryError("response_invalid");
  return Object.freeze({ seatId: x.seatId as string, state, participationState, createdAt: x.createdAt as string,
    table: parseTableSummary(x.table), payment: parsePaymentSummary(x.payment), refund: parseRefund(x.refund),
    calendar: Object.freeze({ available: x.calendar.available, href }) });
}
function parseCancellation(x: unknown): MemberSeatCancellationDTO {
  if (!record(x) || !Array.isArray(x.history)) throw new SeatRepositoryError("response_invalid");
  const history = x.history.map((row) => {
    if (!record(row) || !uuid.test(String(row.requestId)) || !instant(row.requestedAt)
      || !(row.decidedAt === null || instant(row.decidedAt)) || !(row.safeReason === null || typeof row.safeReason === "string")) {
      throw new SeatRepositoryError("response_invalid");
    }
    return Object.freeze({ requestId: row.requestId as string,
      status: requireEnum(row.status, ["pending", "approved", "denied"] as const), requestedAt: row.requestedAt as string,
      decidedAt: row.decidedAt as string | null, safeReason: row.safeReason as string | null });
  });
  const expected = history[0]?.status ?? "none";
  const status = requireEnum(x.status, ["none", "pending", "approved", "denied"] as const);
  if (status !== expected) throw new SeatRepositoryError("response_invalid");
  return Object.freeze({ status, history: Object.freeze(history) });
}
function parsePayment(x: unknown): MemberSeatPaymentDTO {
  if (!record(x) || !record(x.receipt) || !(x.receipt.state === "available" || x.receipt.state === "unavailable" || x.receipt.state === "unknown")) {
    throw new SeatRepositoryError("response_invalid");
  }
  const summary = parsePaymentSummary(x);
  let receipt: MemberSeatPaymentDTO["receipt"];
  if (x.receipt.state === "available") {
    let url: URL;
    try { url = new URL(String(x.receipt.url)); } catch { throw new SeatRepositoryError("response_invalid"); }
    if (url.protocol !== "https:" || url.hostname !== "pay.stripe.com" || url.username || url.password || url.port) {
      throw new SeatRepositoryError("response_invalid");
    }
    receipt = Object.freeze({ state: "available", url: url.toString() });
  } else {
    if (x.receipt.url !== null) throw new SeatRepositoryError("response_invalid");
    receipt = Object.freeze({ state: x.receipt.state, url: null });
  }
  return Object.freeze({ ...summary, receipt });
}
function parseDetail(x: unknown): MemberSeatDetailDTO {
  if (!record(x)) throw new SeatRepositoryError("response_invalid");
  const summary = parseSummary(x);
  return Object.freeze({ ...summary, table: parseTable(x.table), payment: parsePayment(x.payment), cancellation: parseCancellation(x.cancellation) });
}
function parsePending(x: unknown): MemberPendingCheckoutDTO {
  if (!record(x) || !uuid.test(String(x.attemptId)) || !uuid.test(String(x.invitationId)) || !instant(x.createdAt) || !instant(x.holdUntil)
    || !record(x.price) || x.price.amountCents !== 2500 || x.price.currency !== "USD" || !record(x.payment)
    || x.payment.amountCents !== 2500 || x.payment.currency !== "USD" || !(x.payment.paidAt === null || instant(x.payment.paidAt))) {
    throw new SeatRepositoryError("response_invalid");
  }
  const state = requireEnum(x.state, [...pendingStates, "refund_pending"] as const);
  const nextAction = requireEnum(x.nextAction, actions);
  const paymentState = requireEnum(x.payment.state, ["not_started", "processing", "paid", "refund_pending", "refunded", "unknown"] as const);
  const refund = parseRefund(x.refund);
  if ((state === "refund_pending") !== (paymentState === "refund_pending")
    || (state === "refund_pending" && (nextAction !== "contact_support" || refund === null))) {
    throw new SeatRepositoryError("response_invalid");
  }
  return Object.freeze({ attemptId: x.attemptId as string, invitationId: x.invitationId as string,
    state, nextAction, createdAt: x.createdAt as string,
    holdUntil: x.holdUntil as string, price: Object.freeze({ amountCents: 2500, currency: "USD" }),
    payment: Object.freeze({ state: paymentState, amountCents: 2500, currency: "USD", paidAt: x.payment.paidAt as string | null }),
    refund, table: parseTableSummary(x.table) });
}
function parseList(x: unknown): MemberSeatListDTO {
  if (!record(x) || !Array.isArray(x.items) || !Array.isArray(x.pendingCheckouts)
    || !(x.nextCursor === null || typeof x.nextCursor === "string" && x.nextCursor.length <= 512 && /^[A-Za-z0-9_-]+$/.test(x.nextCursor))) {
    throw new SeatRepositoryError("response_invalid");
  }
  return Object.freeze({ items: Object.freeze(x.items.map(parseSummary)), pendingCheckouts: Object.freeze(x.pendingCheckouts.map(parsePending)), nextCursor: x.nextCursor as string | null });
}
function validate(config: Config): URL {
  let url: URL;
  try { url = new URL(config.url); } catch { throw new SeatRepositoryError("request_failed"); }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || !config.secretKey.trim()) throw new SeatRepositoryError("request_failed");
  return url;
}

export function createSeatRepository(config: Config): SeatRepository {
  const base = validate(config);
  const fetcher = config.fetch ?? globalThis.fetch;
  async function rpc(name: string, args: Record<string, unknown>): Promise<unknown> {
    let response: Response;
    try {
      response = await fetcher(new URL(`/rest/v1/rpc/${name}`, base), { method: "POST", headers: {
        apikey: config.secretKey, authorization: `Bearer ${config.secretKey}`, "content-type": "application/json", accept: "application/json",
      }, body: JSON.stringify(args), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000) });
    } catch { throw new SeatRepositoryError("request_failed"); }
    let body: unknown;
    try { body = await response.json() as unknown; } catch { if (response.ok) throw new SeatRepositoryError("response_invalid"); body = null; }
    if (!response.ok) {
      const message = record(body) && typeof body.message === "string" ? body.message : "";
      if (message === "not_found") throw new SeatRepositoryError("not_found");
      if (message === "invalid_input") throw new SeatRepositoryError("invalid_input");
      if (message === "member_not_admitted" || response.status === 401 || response.status === 403) throw new SeatRepositoryError("forbidden");
      throw new SeatRepositoryError("request_failed");
    }
    return body;
  }
  return Object.freeze({
    async listMySeats(actorUserId: string, cursor: Readonly<{ createdAt: string; seatId: string }> | null, limit: number) {
      return parseList(await rpc("read_my_seats", { p_actor: actorUserId,
        p_cursor_created_at: cursor?.createdAt ?? null, p_cursor_seat_id: cursor?.seatId ?? null, p_limit: limit }));
    },
    async readMySeat(actorUserId: string, seatId: string) {
      return parseDetail(await rpc("read_my_seat", { p_actor: actorUserId, p_seat_id: seatId }));
    },
    async readInvitationSeatStatus(invitationId: string) {
      const value = await rpc("read_invitation_seat_status", { p_invitation_id: invitationId });
      if (!record(value)) throw new SeatRepositoryError("response_invalid");
      const status = requireEnum(value.status, ["confirmed_seat", "no_confirmed_seat", "unknown"] as const);
      return Object.freeze({ status }) as SeatStatusReaderResult;
    },
  });
}
