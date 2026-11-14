/** Server-only PostgREST adapter for W06 published Table and Seat-request RPCs. */

import type {
  MinimalTablePreviewDTO, OwnTableRequestDTO, TableDetailDTO, TableDetailResponseDTO,
  TableListDTO, TableRequestHistoryDTO, TableRequestHistoryItemDTO, TableStopDTO, TableSummaryDTO,
} from "../tables.contract.ts";
import type { SupabaseServerConfig } from "./supabase.server.ts";
import type { TablesRepository } from "./tables.contract.server.ts";
import type { TableInvitationHistorySummaryDTO } from "../table-invitations.contract.ts";

type Fetcher = typeof fetch;
type Config = SupabaseServerConfig & Readonly<{ fetch?: Fetcher }>;
export type TablesRepositoryErrorCode = "configuration_invalid" | "request_failed" | "response_invalid" | "forbidden"
  | "not_found" | "not_future" | "profile_incomplete" | "invalid_input" | "invalid_transition" | "operation_conflict";

export class TablesRepositoryError extends Error {
  readonly code: TablesRepositoryErrorCode;
  constructor(code: TablesRepositoryErrorCode) { super(code); this.name = "TablesRepositoryError"; this.code = code; }
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const roles = new Set(["drinks", "dinner", "dessert"]);
const states = new Set(["pending", "withdrawn", "declined", "closed_by_table"]);
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function uuid(value: unknown): value is string { return typeof value === "string" && uuidPattern.test(value); }
function validDate(value: unknown): value is string { return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)); }
function validTime(value: unknown): value is string { return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value); }
function validInstant(value: unknown): value is string { return typeof value === "string" && Number.isFinite(Date.parse(value)); }

function parseOwnRequest(value: unknown): OwnTableRequestDTO {
  if (!isRecord(value) || !uuid(value.requestId) || !uuid(value.tableId) || !states.has(String(value.state))
    || !(value.declineReason === null || typeof value.declineReason === "string" && value.declineReason.length <= 2000)
    || !validInstant(value.createdAt) || !validInstant(value.updatedAt)) throw new TablesRepositoryError("response_invalid");
  return Object.freeze({ requestId: value.requestId, tableId: value.tableId, state: value.state as OwnTableRequestDTO["state"],
    declineReason: value.declineReason as string | null, createdAt: value.createdAt, updatedAt: value.updatedAt });
}

function parseSummary(value: unknown): TableSummaryDTO {
  if (!isRecord(value) || !uuid(value.tableId) || typeof value.title !== "string" || value.title.length > 180
    || !validDate(value.localDate) || !validTime(value.startLocalTime) || typeof value.neighborhood !== "string"
    || value.neighborhood.length > 120 || value.seatPriceCents !== 2500 || value.currency !== "USD"
    || !(value.ownRequest === null || isRecord(value.ownRequest))) throw new TablesRepositoryError("response_invalid");
  return Object.freeze({ tableId: value.tableId, title: value.title, localDate: value.localDate, startLocalTime: value.startLocalTime,
    neighborhood: value.neighborhood, seatPriceCents: 2500, currency: "USD", ownRequest: value.ownRequest === null ? null : parseOwnRequest(value.ownRequest) });
}

function parseStop(value: unknown, index: number): TableStopDTO {
  const expected = ["drinks", "dinner", "dessert"][index];
  if (!isRecord(value) || value.role !== expected || !roles.has(String(value.role)) || typeof value.venueName !== "string"
    || value.venueName.length > 180 || typeof value.venueAddress !== "string" || value.venueAddress.length > 400
    || !Number.isInteger(value.minutesFromStart) || Number(value.minutesFromStart) < 0 || Number(value.minutesFromStart) > 720
    || typeof value.publicNotes !== "string" || value.publicNotes.length > 500) throw new TablesRepositoryError("response_invalid");
  return Object.freeze({ role: value.role as TableStopDTO["role"], venueName: value.venueName, venueAddress: value.venueAddress,
    minutesFromStart: Number(value.minutesFromStart), publicNotes: value.publicNotes });
}

function parseDetail(value: unknown): TableDetailResponseDTO {
  if (!isRecord(value) || (value.view !== "preview" && value.view !== "member") || !isRecord(value.table)) throw new TablesRepositoryError("response_invalid");
  if (value.view === "preview") {
    const table = value.table;
    if (!uuid(table.tableId) || typeof table.title !== "string" || table.title.length > 180 || !validDate(table.localDate)
      || typeof table.neighborhood !== "string" || table.neighborhood.length > 120) throw new TablesRepositoryError("response_invalid");
    return Object.freeze({ view: "preview", table: Object.freeze({ tableId: table.tableId, title: table.title,
      localDate: table.localDate, neighborhood: table.neighborhood }) });
  }
  const summary = parseSummary(value.table);
  const raw = value.table;
  if (raw.seatPriceCents !== 2500 || raw.currency !== "USD" || !Array.isArray(raw.stops) || raw.stops.length !== 3) throw new TablesRepositoryError("response_invalid");
  const detail: TableDetailDTO = Object.freeze({ ...summary, seatPriceCents: 2500, currency: "USD",
    stops: Object.freeze(raw.stops.map((stop, index) => parseStop(stop, index))) });
  return Object.freeze({ view: "member", table: detail });
}

function parseList(value: unknown): TableListDTO {
  if (!isRecord(value) || !Array.isArray(value.items) || (value.nextCursor !== null && typeof value.nextCursor !== "string")) throw new TablesRepositoryError("response_invalid");
  return Object.freeze({ items: Object.freeze(value.items.map(parseSummary)), nextCursor: value.nextCursor as string | null });
}

function parseHistoryItem(value: unknown): TableRequestHistoryItemDTO {
  if (!isRecord(value) || !isRecord(value.table) || typeof value.table.isCurrentlyPublished !== "boolean"
    || !(value.tableInvitation === null || isRecord(value.tableInvitation))) throw new TablesRepositoryError("response_invalid");
  const request = parseOwnRequest(value);
  const table = value.table;
  if (table.tableId !== request.tableId || !uuid(table.tableId) || typeof table.title !== "string" || table.title.length > 180
    || !validDate(table.localDate) || !validTime(table.startLocalTime) || typeof table.neighborhood !== "string" || table.neighborhood.length > 120) {
    throw new TablesRepositoryError("response_invalid");
  }
  let tableInvitation: TableInvitationHistorySummaryDTO | null = null;
  if (value.tableInvitation !== null) {
    const invitation = value.tableInvitation;
    if (!isRecord(invitation) || !uuid(invitation.invitationId) || !["active", "revoked", "closed"].includes(String(invitation.state))
      || !["queued", "sending", "accepted", "delivered", "failed", "unknown"].includes(String(invitation.deliveryState))
      || !validInstant(invitation.createdAt)) throw new TablesRepositoryError("response_invalid");
    tableInvitation = Object.freeze({ invitationId: invitation.invitationId,
      state: invitation.state as TableInvitationHistorySummaryDTO["state"],
      deliveryState: invitation.deliveryState as TableInvitationHistorySummaryDTO["deliveryState"], createdAt: invitation.createdAt });
  }
  return Object.freeze({ ...request, table: Object.freeze({ tableId: table.tableId, title: table.title, localDate: table.localDate,
    startLocalTime: table.startLocalTime, neighborhood: table.neighborhood, isCurrentlyPublished: table.isCurrentlyPublished as boolean }), tableInvitation });
}

function parseHistory(value: unknown): TableRequestHistoryDTO {
  if (!isRecord(value) || !Array.isArray(value.items) || (value.nextCursor !== null && typeof value.nextCursor !== "string")) throw new TablesRepositoryError("response_invalid");
  return Object.freeze({ items: Object.freeze(value.items.map(parseHistoryItem)), nextCursor: value.nextCursor as string | null });
}

function validateConfig(config: Config): URL {
  let url: URL;
  try { url = new URL(config.url); } catch { throw new TablesRepositoryError("configuration_invalid"); }
  if (!["https:", "http:"].includes(url.protocol) || (url.protocol === "http:" && !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
    || !config.secretKey.trim() || !config.publishableKey.trim() || config.secretKey === config.publishableKey) throw new TablesRepositoryError("configuration_invalid");
  return url;
}

export function createTablesRepository(config: Config): TablesRepository {
  const baseUrl = validateConfig(config);
  const fetchImpl = config.fetch ?? fetch;
  async function rpc(name: string, payload: Record<string, unknown>): Promise<unknown> {
    let response: Response;
    try {
      response = await fetchImpl(new URL(`/rest/v1/rpc/${name}`, baseUrl), { method: "POST", headers: {
        apikey: config.secretKey, authorization: `Bearer ${config.secretKey}`, "content-type": "application/json", accept: "application/json",
      }, body: JSON.stringify(payload), cache: "no-store", signal: AbortSignal.timeout(10_000) });
    } catch { throw new TablesRepositoryError("request_failed"); }
    if (!response.ok) {
      let message = "";
      try { const body = await response.clone().json() as unknown; if (isRecord(body) && typeof body.message === "string") message = body.message; } catch { /* safe code only */ }
      if (message === "profile_incomplete") throw new TablesRepositoryError("profile_incomplete");
      if (message === "not_future") throw new TablesRepositoryError("not_future");
      if (message === "not_found" || message === "PGRST116") throw new TablesRepositoryError("not_found");
      if (message === "invalid_input") throw new TablesRepositoryError("invalid_input");
      if (message === "invalid_transition") throw new TablesRepositoryError("invalid_transition");
      if (message === "operation_conflict") throw new TablesRepositoryError("operation_conflict");
      if (response.status === 401 || response.status === 403) throw new TablesRepositoryError("forbidden");
      throw new TablesRepositoryError("request_failed");
    }
    try { return await response.json() as unknown; } catch { throw new TablesRepositoryError("response_invalid"); }
  }
  return Object.freeze({
    async listPublishedTables(actorUserId: string, input: Readonly<{ dateFrom?: string; dateTo?: string; neighborhood?: string; cursor?: string; limit: number }>) {
      return parseList(await rpc("list_published_tables", { p_auth_user_id: actorUserId, p_date_from: input.dateFrom ?? null,
        p_date_to: input.dateTo ?? null, p_neighborhood: input.neighborhood ?? null, p_cursor: input.cursor ?? null, p_limit: input.limit }));
    },
    async readPublishedPreview(tableId: string) {
      const raw = await rpc("read_published_table_preview", { p_table_id: tableId });
      if (raw === null) return null;
      const detail = parseDetail(raw);
      if (detail.view !== "preview") throw new TablesRepositoryError("response_invalid");
      return detail.table as MinimalTablePreviewDTO;
    },
    async readPublishedTable(actorUserId: string, tableId: string) {
      return parseDetail(await rpc("read_published_table_detail", { p_auth_user_id: actorUserId, p_table_id: tableId }));
    },
    async createRequest(actorUserId: string, tableId: string, operationId: string) {
      return parseOwnRequest(await rpc("create_table_request", { p_auth_user_id: actorUserId, p_table_id: tableId, p_operation_id: operationId }));
    },
    async listMemberRequests(actorUserId: string, input: Readonly<{ cursor?: string; limit: number }>) {
      return parseHistory(await rpc("list_member_table_requests", { p_auth_user_id: actorUserId, p_cursor: input.cursor ?? null, p_limit: input.limit }));
    },
    async withdrawRequest(actorUserId: string, requestId: string, operationId: string) {
      return parseOwnRequest(await rpc("withdraw_table_request", { p_auth_user_id: actorUserId, p_request_id: requestId, p_operation_id: operationId }));
    },
  });
}
