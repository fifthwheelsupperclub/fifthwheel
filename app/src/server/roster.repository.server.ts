/** Server-only PostgREST adapter for W06 roster, approval and Table Invitation RPCs. */

import type {
  AssignedCurationTablesDTO, AssignedCurationTableDTO, RosterApplicantDTO, RosterApprovalResultDTO,
  RosterIssueCode, RosterProposalDTO, RosterProposalState, RosterValidationDTO, TableRosterContextDTO,
} from "../roster.contract.ts";
import type { SupabaseServerConfig } from "./supabase.server.ts";
import type { RosterContextInput, RosterListInput, RosterRepository, RosterProposalActionInput, SaveRosterInput } from "./roster.contract.server.ts";

type Fetcher = typeof fetch;
type Config = SupabaseServerConfig & Readonly<{ fetch?: Fetcher }>;
export type RosterRepositoryErrorCode =
  | "configuration_invalid" | "request_failed" | "response_invalid" | "forbidden" | "not_found" | "request_not_found"
  | "invalid_input" | "validation_failed" | "revision_conflict" | "stale_table" | "stale_profile"
  | "request_not_pending" | "proposal_not_submitted" | "proposal_not_editable" | "profile_not_approved"
  | "member_not_admitted" | "roster_already_active" | "capacity_conflict" | "operation_conflict";

export class RosterRepositoryError extends Error {
  readonly code: RosterRepositoryErrorCode;
  readonly issues?: RosterValidationDTO["issues"];
  constructor(code: RosterRepositoryErrorCode, issues?: RosterValidationDTO["issues"]) {
    super(code); this.name = "RosterRepositoryError"; this.code = code; this.issues = issues;
  }
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const proposalStates = new Set<RosterProposalState>(["draft", "submitted", "approved", "superseded"]);
const issueCodes = new Set<RosterIssueCode>([
  "select_three_to_five", "candidate_not_found", "request_not_pending", "member_not_admitted", "profile_not_approved",
  "profile_incomplete", "stale_profile", "age_under_21", "age_range_invalid", "candidate_already_invited",
  "pair_age_mismatch", "age_span_exceeded", "missing_mutual_open_connection", "stale_table",
]);

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function isUuid(value: unknown): value is string { return typeof value === "string" && uuidPattern.test(value); }
function isInstant(value: unknown): value is string { return typeof value === "string" && Number.isFinite(Date.parse(value)); }
function nullableUuid(value: unknown): value is string | null { return value === null || isUuid(value); }

function parseIssues(value: unknown): RosterValidationDTO["issues"] {
  if (!Array.isArray(value)) throw new RosterRepositoryError("response_invalid");
  return Object.freeze(value.map((raw) => {
    if (!isRecord(raw) || typeof raw.code !== "string" || !issueCodes.has(raw.code as RosterIssueCode)
      || raw.guestIds !== undefined && (!Array.isArray(raw.guestIds) || raw.guestIds.some((id) => !isUuid(id)))) {
      throw new RosterRepositoryError("response_invalid");
    }
    return Object.freeze({ code: raw.code as RosterIssueCode,
      ...(raw.guestIds === undefined ? {} : { guestIds: Object.freeze(raw.guestIds as string[]) }) });
  }));
}

function parseValidation(value: unknown): RosterValidationDTO {
  if (!isRecord(value) || typeof value.valid !== "boolean") throw new RosterRepositoryError("response_invalid");
  return Object.freeze({ valid: value.valid, issues: parseIssues(value.issues) });
}

function parseProposal(value: unknown): RosterProposalDTO {
  if (!isRecord(value) || !isUuid(value.proposalId) || !Number.isInteger(value.revision) || Number(value.revision) < 1
    || typeof value.state !== "string" || !proposalStates.has(value.state as RosterProposalState)
    || !isUuid(value.supplyRevisionId) || !Array.isArray(value.selectedRequestIds) || value.selectedRequestIds.some((id) => !isUuid(id))
    || !Array.isArray(value.selectedGuests) || value.selectedGuests.some((guest) => !isRecord(guest)
      || !isUuid(guest.guestId) || typeof guest.displayName !== "string" || guest.displayName.length > 201)
    || !isInstant(value.createdAt) || !isInstant(value.updatedAt)) throw new RosterRepositoryError("response_invalid");
  return Object.freeze({ proposalId: value.proposalId, revision: Number(value.revision), state: value.state as RosterProposalState,
    supplyRevisionId: value.supplyRevisionId, selectedRequestIds: Object.freeze(value.selectedRequestIds as string[]),
    selectedGuests: Object.freeze(value.selectedGuests.map((guest) => Object.freeze({
      guestId: (guest as Record<string, unknown>).guestId as string,
      displayName: (guest as Record<string, unknown>).displayName as string,
    }))),
    validation: parseValidation(value.validation), createdAt: value.createdAt, updatedAt: value.updatedAt });
}

function parseAssignedTable(value: unknown): AssignedCurationTableDTO {
  if (!isRecord(value) || !isUuid(value.tableId) || typeof value.title !== "string" || value.title.length > 180
    || typeof value.localDate !== "string" || !datePattern.test(value.localDate) || typeof value.startLocalTime !== "string" || !timePattern.test(value.startLocalTime)
    || typeof value.neighborhood !== "string" || value.neighborhood.length > 120 || !isUuid(value.publishedRevisionId)
    || !Number.isSafeInteger(value.pendingRequestCount) || Number(value.pendingRequestCount) < 0) throw new RosterRepositoryError("response_invalid");
  let currentProposal: AssignedCurationTableDTO["currentProposal"] = null;
  if (value.currentProposal !== null) {
    const proposal = value.currentProposal;
    if (!isRecord(proposal) || !isUuid(proposal.proposalId) || !Number.isInteger(proposal.revision) || Number(proposal.revision) < 1
      || typeof proposal.state !== "string" || !proposalStates.has(proposal.state as RosterProposalState)
      || !Number.isSafeInteger(proposal.selectedCount) || Number(proposal.selectedCount) < 0 || typeof proposal.valid !== "boolean") {
      throw new RosterRepositoryError("response_invalid");
    }
    currentProposal = Object.freeze({ proposalId: proposal.proposalId, revision: Number(proposal.revision),
      state: proposal.state as RosterProposalState, selectedCount: Number(proposal.selectedCount), valid: proposal.valid });
  }
  return Object.freeze({ tableId: value.tableId, title: value.title, localDate: value.localDate,
    startLocalTime: value.startLocalTime, neighborhood: value.neighborhood, publishedRevisionId: value.publishedRevisionId,
    pendingRequestCount: Number(value.pendingRequestCount), currentProposal });
}

function parseAssignedTables(value: unknown): AssignedCurationTablesDTO {
  if (!isRecord(value) || !Array.isArray(value.items) || value.items.length > 50
    || !(value.nextCursor === null || typeof value.nextCursor === "string" && value.nextCursor.length <= 180)) {
    throw new RosterRepositoryError("response_invalid");
  }
  return Object.freeze({ items: Object.freeze(value.items.map(parseAssignedTable)), nextCursor: value.nextCursor as string | null });
}

function parseApplicant(value: unknown): RosterApplicantDTO {
  if (!isRecord(value) || !isUuid(value.requestId) || !isUuid(value.guestId) || typeof value.displayName !== "string"
    || value.displayName.length > 201 || !isInstant(value.requestCreatedAt) || typeof value.eligible !== "boolean"
    || !Array.isArray(value.reasonCodes) || value.reasonCodes.some((code) => typeof code !== "string")
    || !(value.recommendationRank === null || Number.isSafeInteger(value.recommendationRank) && Number(value.recommendationRank) > 0)
    || typeof value.selected !== "boolean") throw new RosterRepositoryError("response_invalid");
  return Object.freeze({ requestId: value.requestId, guestId: value.guestId, displayName: value.displayName,
    requestCreatedAt: value.requestCreatedAt, eligible: value.eligible, reasonCodes: Object.freeze(value.reasonCodes as string[]),
    recommendationRank: value.recommendationRank as number | null, selected: value.selected });
}

function parseContext(value: unknown): TableRosterContextDTO {
  if (!isRecord(value) || !isRecord(value.table) || !isUuid(value.table.tableId) || typeof value.table.title !== "string"
    || value.table.title.length > 180 || typeof value.table.localDate !== "string" || !datePattern.test(value.table.localDate)
    || typeof value.table.startLocalTime !== "string" || !timePattern.test(value.table.startLocalTime)
    || typeof value.table.neighborhood !== "string" || value.table.neighborhood.length > 120
    || !(value.table.publishedRevisionId === null || isUuid(value.table.publishedRevisionId))
    || !(value.table.readOnlyReason === null || ["past", "unpublished", "revision_changed"].includes(String(value.table.readOnlyReason)))
    || !isRecord(value.applicants) || !Array.isArray(value.applicants.items) || value.applicants.items.length > 50
    || !(value.applicants.nextCursor === null || typeof value.applicants.nextCursor === "string" && value.applicants.nextCursor.length <= 180)
    || !(value.currentProposal === null || isRecord(value.currentProposal)) || !isRecord(value.permissions)
    || typeof value.permissions.canEditProposal !== "boolean" || typeof value.permissions.canSubmit !== "boolean"
    || typeof value.permissions.canApprove !== "boolean") throw new RosterRepositoryError("response_invalid");
  const table = Object.freeze({ tableId: value.table.tableId, title: value.table.title, localDate: value.table.localDate,
    startLocalTime: value.table.startLocalTime, neighborhood: value.table.neighborhood, publishedRevisionId: value.table.publishedRevisionId,
    readOnlyReason: value.table.readOnlyReason as TableRosterContextDTO["table"]["readOnlyReason"] });
  return Object.freeze({ table, applicants: Object.freeze({ items: Object.freeze(value.applicants.items.map(parseApplicant)), nextCursor: value.applicants.nextCursor as string | null }),
    currentProposal: value.currentProposal === null ? null : parseProposal(value.currentProposal),
    permissions: Object.freeze({ canEditProposal: value.permissions.canEditProposal, canSubmit: value.permissions.canSubmit, canApprove: value.permissions.canApprove }) });
}

function parseApproval(value: unknown): RosterApprovalResultDTO {
  if (!isRecord(value) || !isRecord(value.proposal) || !isUuid(value.proposal.proposalId) || !Number.isInteger(value.proposal.revision)
    || value.proposal.state !== "approved" || !Array.isArray(value.invitations) || value.invitations.length < 3 || value.invitations.length > 5) {
    throw new RosterRepositoryError("response_invalid");
  }
  const invitations = value.invitations.map((row) => {
    if (!isRecord(row) || !isUuid(row.invitationId) || !isUuid(row.guestId) || row.state !== "active" || row.deliveryState !== "queued") {
      throw new RosterRepositoryError("response_invalid");
    }
    return Object.freeze({ invitationId: row.invitationId, guestId: row.guestId, state: "active" as const, deliveryState: "queued" as const });
  });
  return Object.freeze({ proposal: Object.freeze({ proposalId: value.proposal.proposalId, revision: Number(value.proposal.revision), state: "approved" }),
    invitations: Object.freeze(invitations) });
}

function safeIssues(detail: unknown): RosterValidationDTO["issues"] | undefined {
  if (typeof detail !== "string" || detail.length > 4000) return undefined;
  try {
    const parsed = JSON.parse(detail) as unknown;
    if (isRecord(parsed) && Array.isArray(parsed.issues)) return parseIssues(parsed.issues);
  } catch { /* Never expose SQL or provider text. */ }
  return undefined;
}

function mapDatabaseError(message: string, details: unknown): RosterRepositoryError {
  const issues = safeIssues(details);
  const codeMap: Record<string, RosterRepositoryErrorCode> = {
    forbidden: "forbidden", not_assigned: "forbidden", not_found: "not_found", request_not_found: "request_not_found",
    invalid_input: "invalid_input", duplicate_request_id: "invalid_input", validation_failed: "validation_failed",
    revision_conflict: "revision_conflict", stale_table: "stale_table", table_not_future: "stale_table",
    stale_profile: "stale_profile", request_not_pending: "request_not_pending", proposal_not_submitted: "proposal_not_submitted",
    proposal_not_editable: "proposal_not_editable", profile_not_approved: "profile_not_approved", member_not_admitted: "member_not_admitted",
    roster_already_active: "roster_already_active", capacity_conflict: "capacity_conflict", operation_conflict: "operation_conflict",
  };
  return new RosterRepositoryError(codeMap[message] ?? "request_failed", issues);
}

function validateConfig(config: Config): URL {
  let url: URL;
  try { url = new URL(config.url); } catch { throw new RosterRepositoryError("configuration_invalid"); }
  if (!["https:", "http:"].includes(url.protocol) || (url.protocol === "http:" && !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
    || !config.secretKey.trim() || !config.publishableKey.trim() || config.secretKey === config.publishableKey) {
    throw new RosterRepositoryError("configuration_invalid");
  }
  return url;
}

export function createRosterRepository(config: Config): RosterRepository {
  const baseUrl = validateConfig(config);
  const fetchImpl = config.fetch ?? fetch;
  async function rpc(name: string, payload: Record<string, unknown>): Promise<unknown> {
    let response: Response;
    try {
      response = await fetchImpl(new URL(`/rest/v1/rpc/${name}`, baseUrl), { method: "POST", headers: {
        apikey: config.secretKey, authorization: `Bearer ${config.secretKey}`, "content-type": "application/json", accept: "application/json",
      }, body: JSON.stringify(payload), cache: "no-store", signal: AbortSignal.timeout(10_000) });
    } catch { throw new RosterRepositoryError("request_failed"); }
    if (!response.ok) {
      let message = ""; let details: unknown;
      try { const body = await response.clone().json() as unknown; if (isRecord(body)) { if (typeof body.message === "string") message = body.message; details = body.details; } } catch { /* discard body */ }
      const error = mapDatabaseError(message, details);
      if (response.status === 401 || response.status === 403) throw new RosterRepositoryError("forbidden");
      throw error;
    }
    try { return await response.json() as unknown; } catch { throw new RosterRepositoryError("response_invalid"); }
  }
  return Object.freeze({
    async listAdminSeatRequests(actorUserId: string, input: Omit<RosterListInput, "accessToken">) {
      return parseAssignedTables(await rpc("list_curation_assigned_tables", { p_actor_user_id: actorUserId, p_cursor: input.cursor ?? null, p_limit: input.limit }));
    },
    async listAssignedCurationTables(actorUserId: string, input: Omit<RosterListInput, "accessToken">) {
      return parseAssignedTables(await rpc("list_curation_assigned_tables", { p_actor_user_id: actorUserId, p_cursor: input.cursor ?? null, p_limit: input.limit }));
    },
    async readTableRoster(actorUserId: string, tableId: string, input: Omit<RosterContextInput, "accessToken" | "tableId">) {
      return parseContext(await rpc("read_table_roster_context", { p_actor_user_id: actorUserId, p_table_id: tableId, p_cursor: input.cursor ?? null, p_limit: input.limit }));
    },
    async saveRosterProposal(actorUserId: string, tableId: string, request: SaveRosterInput["request"]) {
      return parseProposal(await rpc("save_table_roster_proposal", { p_actor_user_id: actorUserId, p_table_id: tableId, p_request: request }));
    },
    async submitRosterProposal(actorUserId: string, tableId: string, request: RosterProposalActionInput["request"]) {
      return parseProposal(await rpc("submit_table_roster_proposal", { p_actor_user_id: actorUserId, p_table_id: tableId, p_request: request }));
    },
    async approveRoster(actorUserId: string, tableId: string, request: RosterProposalActionInput["request"]) {
      return parseApproval(await rpc("approve_table_roster", { p_actor_user_id: actorUserId, p_table_id: tableId, p_request: request }));
    },
  });
}
