/** Service-role RPC adapter for owner/admin cancellation operations. */

import type {
  AdminCancellationDetailDTO, AdminCancellationQueueDTO, AdminCancellationQueueItemDTO,
  CancellationRequestState, DecideCancellationInput, MemberCancellationHistoryDTO,
  MemberCancellationRequestDTO, RequestAvailabilityReason,
} from "../seat-cancellation.contract.ts";
import type { AdminCancellationCursor, SeatCancellationRepository } from "./seat-cancellation.contract.server.ts";

export type CancellationRepositoryErrorCode =
  | "request_failed" | "response_invalid" | "not_found" | "forbidden" | "invalid_input"
  | "request_pending" | "seat_not_cancellable" | "stale_version" | "refund_amount_exceeds_balance"
  | "decision_finalized" | "operation_conflict";
export class CancellationRepositoryError extends Error {
  readonly code: CancellationRepositoryErrorCode;
  constructor(code: CancellationRepositoryErrorCode) { super(code); this.name = "CancellationRepositoryError"; this.code = code; }
}
type Config = Readonly<{ url: string; secretKey: string; fetch?: typeof fetch }>;
type RecordValue = Record<string, unknown>;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const record = (x: unknown): x is RecordValue => typeof x === "object" && x !== null && !Array.isArray(x);
const instant = (x: unknown): x is string => typeof x === "string" && Number.isFinite(Date.parse(x));
function text(x: unknown, max: number, allowEmpty = true): string {
  if (typeof x !== "string" || x.length > max || (!allowEmpty && x.trim().length === 0)) throw new CancellationRepositoryError("response_invalid");
  return x;
}
function enumValue<T extends string>(x: unknown, values: readonly T[]): T {
  if (typeof x !== "string" || !values.includes(x as T)) throw new CancellationRepositoryError("response_invalid");
  return x as T;
}
function money(x: unknown): number {
  if (!Number.isSafeInteger(x) || Number(x) < 0 || Number(x) > 2500) throw new CancellationRepositoryError("response_invalid");
  return Number(x);
}
const requestStates = ["pending", "approved", "denied"] as const;
const availabilityReasons = ["available", "request_pending", "seat_not_active", "payment_unresolved", "table_closed"] as const;

function parseRequest(x: unknown): MemberCancellationRequestDTO {
  if (!record(x) || !uuid.test(String(x.requestId)) || !uuid.test(String(x.seatId))
    || !Number.isSafeInteger(x.version) || Number(x.version) < 1
    || !instant(x.requestedAt) || !(x.decidedAt === null || instant(x.decidedAt))
    || !(x.memberReason === null || typeof x.memberReason === "string" && x.memberReason.length <= 2000)
    || !(x.memberSafeReason === null || typeof x.memberSafeReason === "string" && x.memberSafeReason.length <= 500)
    || !(x.refundCents === null || Number.isSafeInteger(x.refundCents) && Number(x.refundCents) >= 0 && Number(x.refundCents) <= 2500)) {
    throw new CancellationRepositoryError("response_invalid");
  }
  const state = enumValue(x.state, requestStates);
  if ((state === "pending") !== (x.version === 1) || (state === "pending") !== (x.decidedAt === null)
    || (state === "pending") !== (x.refundCents === null) || (state === "pending") !== (x.memberSafeReason === null)) {
    throw new CancellationRepositoryError("response_invalid");
  }
  return Object.freeze({ requestId: x.requestId as string, seatId: x.seatId as string, state, version: Number(x.version),
    requestedAt: x.requestedAt as string, decidedAt: x.decidedAt as string | null,
    memberReason: x.memberReason as string | null, memberSafeReason: x.memberSafeReason as string | null,
    refundCents: x.refundCents as number | null });
}
function parseHistory(x: unknown): MemberCancellationHistoryDTO {
  if (!record(x) || !Array.isArray(x.items) || x.nextCursor !== null || !record(x.requestAvailability)
    || typeof x.requestAvailability.canRequest !== "boolean") throw new CancellationRepositoryError("response_invalid");
  const seatState = enumValue(x.seatState, ["confirmed", "cancellation_requested", "cancelled", "completed"] as const);
  const reason = enumValue(x.requestAvailability.reason, availabilityReasons);
  if (x.requestAvailability.canRequest !== (reason === "available")) throw new CancellationRepositoryError("response_invalid");
  const items = x.items.map(parseRequest);
  return Object.freeze({ seatState, items: Object.freeze(items), nextCursor: null,
    requestAvailability: Object.freeze({ canRequest: x.requestAvailability.canRequest, reason: reason as RequestAvailabilityReason }) });
}
function parseAdminItem(x: unknown): AdminCancellationQueueItemDTO {
  if (!record(x) || !record(x.member) || !record(x.table) || !record(x.seat)
    || !uuid.test(String(x.member.guestId)) || !uuid.test(String(x.table.tableId)) || !uuid.test(String(x.seat.seatId))
    || !/^\d{4}-\d{2}-\d{2}$/.test(String(x.table.localDate)) || !/^\d{2}:\d{2}$/.test(String(x.table.startLocalTime))
    || !instant(x.seat.paidAt) || x.seat.amountCents !== 2500) throw new CancellationRepositoryError("response_invalid");
  return Object.freeze({ request: parseRequest(x.request),
    member: Object.freeze({ guestId: x.member.guestId as string, displayName: text(x.member.displayName, 202, false) }),
    table: Object.freeze({ tableId: x.table.tableId as string, title: text(x.table.title, 180, false),
      localDate: x.table.localDate as string, startLocalTime: x.table.startLocalTime as string }),
    seat: Object.freeze({ seatId: x.seat.seatId as string,
      state: enumValue(x.seat.state, ["confirmed", "cancellation_requested", "cancelled", "completed"] as const),
      paidAt: x.seat.paidAt as string, amountCents: 2500, refundAvailableCents: money(x.seat.refundAvailableCents) }) });
}
function parseAdminDetail(x: unknown): AdminCancellationDetailDTO {
  if (!record(x) || !record(x.refundBalance) || x.refundBalance.paidCents !== 2500) throw new CancellationRepositoryError("response_invalid");
  const item = parseAdminItem(x);
  const committed = money(x.refundBalance.refundCommittedCents);
  const available = money(x.refundBalance.refundAvailableCents);
  if (committed + available !== 2500 || item.seat.refundAvailableCents !== available) throw new CancellationRepositoryError("response_invalid");
  return Object.freeze({ ...item, refundBalance: Object.freeze({ paidCents: 2500, refundCommittedCents: committed, refundAvailableCents: available }) });
}
function parseQueue(x: unknown): AdminCancellationQueueDTO {
  if (!record(x) || !Array.isArray(x.items) || !(x.nextCursor === null || typeof x.nextCursor === "string"
    && x.nextCursor.length <= 512 && /^[A-Za-z0-9_-]+$/.test(x.nextCursor))) throw new CancellationRepositoryError("response_invalid");
  return Object.freeze({ items: Object.freeze(x.items.map(parseAdminItem)), nextCursor: x.nextCursor as string | null });
}
function validate(config: Config): URL {
  let url: URL;
  try { url = new URL(config.url); } catch { throw new CancellationRepositoryError("request_failed"); }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || !config.secretKey.trim()) throw new CancellationRepositoryError("request_failed");
  return url;
}

export function createSeatCancellationRepository(config: Config): SeatCancellationRepository {
  const base = validate(config), fetcher = config.fetch ?? globalThis.fetch;
  async function rpc(name: string, args: Record<string, unknown>): Promise<unknown> {
    let response: Response;
    try { response = await fetcher(new URL(`/rest/v1/rpc/${name}`, base), { method: "POST", headers: {
      apikey: config.secretKey, authorization: `Bearer ${config.secretKey}`, "content-type": "application/json", accept: "application/json",
    }, body: JSON.stringify(args), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000) }); }
    catch { throw new CancellationRepositoryError("request_failed"); }
    let body: unknown;
    try { body = await response.json() as unknown; } catch { if (response.ok) throw new CancellationRepositoryError("response_invalid"); body = null; }
    if (!response.ok) {
      const message = record(body) && typeof body.message === "string" ? body.message : "";
      const mapped: Record<string, CancellationRepositoryErrorCode> = {
        not_found: "not_found", member_not_admitted: "forbidden", admin_required: "forbidden", invalid_input: "invalid_input",
        request_pending: "request_pending", seat_not_cancellable: "seat_not_cancellable", stale_version: "stale_version",
        refund_amount_exceeds_balance: "refund_amount_exceeds_balance", decision_finalized: "decision_finalized",
        operation_conflict: "operation_conflict",
      };
      if (mapped[message]) throw new CancellationRepositoryError(mapped[message]!);
      if (response.status === 401 || response.status === 403) throw new CancellationRepositoryError("forbidden");
      throw new CancellationRepositoryError("request_failed");
    }
    return body;
  }
  return Object.freeze({
    async listOwnCancellationRequests(actorUserId: string, seatId: string) {
      return parseHistory(await rpc("read_my_seat_cancellation_requests", { p_actor: actorUserId, p_seat_id: seatId }));
    },
    async requestCancellation(actorUserId: string, seatId: string, request: Readonly<{ operationId: string; memberReason: string | null }>) {
      return parseRequest(await rpc("request_seat_cancellation", { p_actor: actorUserId, p_seat_id: seatId,
        p_operation_id: request.operationId, p_member_reason: request.memberReason }));
    },
    async listAdminCancellations(actorUserId: string, cursor: AdminCancellationCursor | null, limit: number) {
      return parseQueue(await rpc("list_admin_seat_cancellations", { p_actor: actorUserId,
        p_cursor_requested_at: cursor?.requestedAt ?? null, p_cursor_request_id: cursor?.requestId ?? null, p_limit: limit }));
    },
    async readAdminCancellation(actorUserId: string, requestId: string) {
      return parseAdminDetail(await rpc("read_admin_seat_cancellation", { p_actor: actorUserId, p_request_id: requestId }));
    },
    async decideCancellation(actorUserId: string, requestId: string, request: DecideCancellationInput) {
      return parseAdminDetail(await rpc("decide_seat_cancellation", { p_actor: actorUserId, p_request_id: requestId,
        p_operation_id: request.operationId, p_expected_version: request.expectedVersion, p_decision: request.decision,
        p_refund_cents: request.refundCents, p_member_safe_reason: request.memberSafeReason }));
    },
  });
}
