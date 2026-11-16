/** Server-only PostgREST adapter for a member's own Table placements and their invitations. */

import type { OwnTableRequestDTO, TableRequestHistoryDTO, TableRequestHistoryItemDTO } from "../tables.contract.ts";
import type { SupabaseServerConfig } from "./supabase.server.ts";
import type { TablesRepository } from "./tables.contract.server.ts";
import type { TableInvitationHistorySummaryDTO } from "../table-invitations.contract.ts";

type Fetcher = typeof fetch;
type Config = SupabaseServerConfig & Readonly<{ fetch?: Fetcher }>;
export type TablesRepositoryErrorCode = "configuration_invalid" | "request_failed" | "response_invalid" | "forbidden"
  | "not_found" | "invalid_input" | "operation_conflict";

export class TablesRepositoryError extends Error {
  readonly code: TablesRepositoryErrorCode;
  constructor(code: TablesRepositoryErrorCode) { super(code); this.name = "TablesRepositoryError"; this.code = code; }
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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
      if (message === "not_found" || message === "PGRST116") throw new TablesRepositoryError("not_found");
      if (message === "invalid_input") throw new TablesRepositoryError("invalid_input");
      if (message === "operation_conflict") throw new TablesRepositoryError("operation_conflict");
      if (response.status === 401 || response.status === 403) throw new TablesRepositoryError("forbidden");
      throw new TablesRepositoryError("request_failed");
    }
    try { return await response.json() as unknown; } catch { throw new TablesRepositoryError("response_invalid"); }
  }
  return Object.freeze({
    async listMemberRequests(actorUserId: string, input: Readonly<{ cursor?: string; limit: number }>) {
      return parseHistory(await rpc("list_member_table_requests", { p_auth_user_id: actorUserId, p_cursor: input.cursor ?? null, p_limit: input.limit }));
    },
  });
}
