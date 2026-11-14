/** Server-only repository for W05.2 transactional draft/revision operations. */

import type {
  SupplyCreateDraftRequest, SupplyCreateDraftResultDTO, SupplyDraftContent, SupplyRevisionActionRequest,
  SupplyRevisionSummaryDTO, SupplyTableDetailDTO, SupplyTableListDTO, SupplyUpdateDraftRequest,
  SupplyVenueListDTO,
} from "../supply.management.contract.ts";
import type { SupabaseServerConfig } from "./supabase.server.ts";
import type { SupplyManagementRepository, SupplyStoredTableDetail } from "./supply.management.contract.server.ts";

type Fetcher = typeof fetch;
type Config = SupabaseServerConfig & Readonly<{ fetch?: Fetcher }>;
export type SupplyManagementRepositoryErrorCode = "configuration_invalid" | "request_failed" | "response_invalid" | "forbidden" | "not_found" | "revision_conflict" | "operation_conflict" | "protected_change" | "validation_failed" | "provider_unavailable";

export class SupplyManagementRepositoryError extends Error {
  readonly code: SupplyManagementRepositoryErrorCode;
  constructor(code: SupplyManagementRepositoryErrorCode) { super(code); this.name = "SupplyManagementRepositoryError"; this.code = code; }
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function uuid(value: unknown): value is string { return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value); }
function iso(value: unknown): value is string { return typeof value === "string" && Number.isFinite(Date.parse(value)); }

function parseRevision(value: unknown): SupplyRevisionSummaryDTO {
  if (!isRecord(value) || !uuid(value.revisionId) || !Number.isInteger(value.revision)
    || !["draft", "accepted", "published"].includes(String(value.state)) || !iso(value.createdAt) || !iso(value.updatedAt)
    || !isRecord(value.content)) throw new SupplyManagementRepositoryError("response_invalid");
  return value as unknown as SupplyRevisionSummaryDTO;
}

function parseDetail(value: unknown): SupplyStoredTableDetail {
  if (!isRecord(value) || !uuid(value.tableId) || !["draft", "accepted", "published", "review_required", "upstream_missing"].includes(String(value.lifecycle))
    || !["current", "stale", "missing"].includes(String(value.currentSyncState))) throw new SupplyManagementRepositoryError("response_invalid");
  const parseMaybe = (revision: unknown) => revision === null ? null : parseRevision(revision);
  const detail = value as unknown as SupplyTableDetailDTO;
  parseMaybe(detail.draft); parseMaybe(detail.accepted); parseMaybe(detail.published);
  const draftContent = detail.draft?.content ?? null;
  return { detail, draftContent };
}

function validateConfig(config: Config): URL {
  let url: URL;
  try { url = new URL(config.url); } catch { throw new SupplyManagementRepositoryError("configuration_invalid"); }
  if (!["https:", "http:"].includes(url.protocol) || (url.protocol === "http:" && !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
    || !config.secretKey.trim() || !config.publishableKey.trim() || config.secretKey === config.publishableKey) {
    throw new SupplyManagementRepositoryError("configuration_invalid");
  }
  return url;
}

export function createSupplyManagementRepository(config: Config): SupplyManagementRepository {
  const baseUrl = validateConfig(config);
  const fetchImpl = config.fetch ?? fetch;
  async function rpc(name: string, payload: Record<string, unknown>): Promise<unknown> {
    let response: Response;
    try {
      response = await fetchImpl(new URL(`/rest/v1/rpc/${name}`, baseUrl), {
        method: "POST", headers: { apikey: config.secretKey, authorization: `Bearer ${config.secretKey}`, "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(payload), cache: "no-store",
      });
    } catch { throw new SupplyManagementRepositoryError("request_failed"); }
    if (!response.ok) {
      let safeCode = "";
      try {
        const errorBody = await response.clone().json() as unknown;
        if (isRecord(errorBody) && typeof errorBody.message === "string") safeCode = errorBody.message;
      } catch { /* response detail is intentionally discarded */ }
      if (safeCode === "revision_conflict") throw new SupplyManagementRepositoryError("revision_conflict");
      if (safeCode === "operation_conflict" || safeCode === "draft_exists") throw new SupplyManagementRepositoryError("operation_conflict");
      if (safeCode === "protected_change") throw new SupplyManagementRepositoryError("protected_change");
      if (safeCode === "validation_failed" || safeCode === "invalid_input") throw new SupplyManagementRepositoryError("validation_failed");
      if (safeCode === "not_found") throw new SupplyManagementRepositoryError("not_found");
      if (response.status === 401 || response.status === 403) throw new SupplyManagementRepositoryError("forbidden");
      // A generic 404 can be PostgREST function/schema-cache resolution failure,
      // not an absent domain row. Only the explicit RPC `not_found` message maps
      // to the user-facing not-found state.
      if (response.status === 404) throw new SupplyManagementRepositoryError("response_invalid");
      if (response.status === 409) throw new SupplyManagementRepositoryError("revision_conflict");
      if (response.status === 422) throw new SupplyManagementRepositoryError("validation_failed");
      if (response.status === 503) throw new SupplyManagementRepositoryError("provider_unavailable");
      throw new SupplyManagementRepositoryError("request_failed");
    }
    try { return await response.json() as unknown; } catch { throw new SupplyManagementRepositoryError("response_invalid"); }
  }
  function safeList(value: unknown): SupplyTableListDTO {
    if (!isRecord(value) || typeof value.canCreateDraft !== "boolean" || !Array.isArray(value.items) || !Array.isArray(value.stagedCandidates)
      || (value.nextCursor !== null && typeof value.nextCursor !== "string")) throw new SupplyManagementRepositoryError("response_invalid");
    return value as unknown as SupplyTableListDTO;
  }
  return Object.freeze({
    async listTables(actorUserId: string, _assignedTableIds: readonly string[], input: Readonly<{ state?: string; cursor?: string; limit: number }>) {
      const result = await rpc("list_supply_tables", {
        p_actor_user_id: actorUserId, p_state: input.state ?? null, p_cursor: input.cursor ?? null, p_limit: input.limit,
      });
      return safeList(result);
    },
    async readTable(actorUserId: string, tableId: string) {
      const result = await rpc("read_supply_table_detail", { p_actor_user_id: actorUserId, p_table_id: tableId });
      if (result === null) return null;
      return parseDetail(result);
    },
    async listVenues(actorUserId: string, _assignedTableIds: readonly string[], query?: string) {
      const result = await rpc("list_supply_venues", { p_actor_user_id: actorUserId, p_query: query ?? null });
      if (!isRecord(result) || !Array.isArray(result.items)) throw new SupplyManagementRepositoryError("response_invalid");
      return result as unknown as SupplyVenueListDTO;
    },
    async readDraftTableId(actorUserId: string, draftId: string) {
      const result = await rpc("read_supply_draft_table_id", { p_actor_user_id: actorUserId, p_draft_id: draftId });
      if (result === null) return null;
      if (!uuid(result)) throw new SupplyManagementRepositoryError("response_invalid");
      return result;
    },
    async createDraft(actorUserId: string, request: SupplyCreateDraftRequest) {
      const result = await rpc("create_supply_draft", { p_actor_user_id: actorUserId, p_request: request });
      if (!isRecord(result) || !uuid(result.tableId)) throw new SupplyManagementRepositoryError("response_invalid");
      return Object.freeze({ tableId: result.tableId, draft: parseRevision(result.draft) }) satisfies SupplyCreateDraftResultDTO;
    },
    async updateDraft(actorUserId: string, draftId: string, request: SupplyUpdateDraftRequest) {
      return parseRevision(await rpc("update_supply_draft", { p_actor_user_id: actorUserId, p_draft_id: draftId, p_request: request }));
    },
    async previewDraft(actorUserId: string, draftId: string, expectedDraftRevision: number) {
      const result = await rpc("read_supply_draft_preview", { p_actor_user_id: actorUserId, p_draft_id: draftId, p_expected_revision: expectedDraftRevision });
      if (result === null) return null;
      return parseDetail(result);
    },
    async acceptDraft(actorUserId: string, draftId: string, request: SupplyRevisionActionRequest) {
      return parseRevision(await rpc("accept_supply_draft", { p_actor_user_id: actorUserId, p_draft_id: draftId, p_request: request }));
    },
    async publishDraft(actorUserId: string, draftId: string, request: SupplyRevisionActionRequest) {
      return parseDetail(await rpc("publish_supply_draft", { p_actor_user_id: actorUserId, p_draft_id: draftId, p_request: request } )).detail;
    },
  });
}

export type SupplyManagementRpcDraftContent = SupplyDraftContent;
