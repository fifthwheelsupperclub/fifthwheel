/** W06.3-W06.4 role gates, input validation and safe failure mapping. */

import { authorize, type ServerVerifiedPrincipal } from "./authorization.server.ts";
import type {
  RosterProposalActionInput, RosterListInput, RosterContextInput, SaveRosterInput,
  RosterService, RosterServiceDependencies, RosterServiceFailure, RosterServiceResult,
} from "./roster.contract.server.ts";
import type {
  AssignedCurationTablesDTO, RosterApprovalResultDTO, RosterErrorCode, RosterProposalDTO, TableRosterContextDTO,
} from "../roster.contract.ts";
import { RosterRepositoryError } from "./roster.repository.server.ts";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const tableCursorPattern = /^\d{4}-\d{2}-\d{2}\|(?:[01]\d|2[0-3]):[0-5]\d\|[0-9a-f-]{36}$/i;
const applicantCursorPattern = /^\d{4}-\d{2}-\d{2}T[^|]{1,40}\|[0-9a-f-]{36}$/i;

function fail<T>(code: RosterErrorCode, safeMessage: string, issues?: RosterServiceFailure["issues"]): RosterServiceResult<T> {
  return { ok: false, error: { code, safeMessage, ...(issues ? { issues } : {}) } };
}

function repositoryFailure<T>(error: unknown): RosterServiceResult<T> {
  if (error instanceof RosterRepositoryError) {
    const issues = error.issues;
    switch (error.code) {
      case "forbidden": return fail("forbidden", "You are not assigned to this Table or cannot access roster curation.");
      case "not_found": return fail("not_found", "The Table could not be found.");
      case "request_not_found": return fail("request_not_found", "One or more Seat requests could not be found for this Table.");
      case "invalid_input": return fail("invalid_input", "Check the roster request and try again.");
      case "validation_failed": return fail("validation_failed", "Review the roster rules before submitting it.", issues);
      case "revision_conflict": return fail("revision_conflict", "The roster changed. Reload it and review the latest version.");
      case "stale_table": return fail("stale_table", "The Table changed or is no longer published. Reload before continuing.");
      case "stale_profile": return fail("stale_profile", "A selected profile changed. Refresh candidates and review the roster.");
      case "request_not_pending": return fail("request_not_pending", "A selected Seat request is no longer pending.");
      case "proposal_not_submitted": return fail("proposal_not_submitted", "Submit the current roster proposal before approval.");
      case "proposal_not_editable": return fail("proposal_not_editable", "This proposal can no longer be edited.");
      case "profile_not_approved": return fail("profile_not_approved", "A selected member no longer has a current approved profile.");
      case "member_not_admitted": return fail("member_not_admitted", "A selected member is no longer eligible.");
      case "roster_already_active": return fail("roster_already_active", "This Table already has an active roster. Use the replacement workflow.");
      case "capacity_conflict": return fail("capacity_conflict", "The Table has no remaining roster capacity.");
      case "operation_conflict": return fail("operation_conflict", "This operation identifier was already used for a different change.");
      case "configuration_invalid":
      case "request_failed":
      case "response_invalid": return fail("temporarily_unavailable", "Roster curation is temporarily unavailable.");
    }
  }
  return fail("temporarily_unavailable", "Roster curation is temporarily unavailable.");
}

function isAdmin(principal: ServerVerifiedPrincipal): boolean {
  return authorize(principal, { workspace: "admin", action: "roster:read" }).allowed;
}

function canCurate(principal: ServerVerifiedPrincipal, tableId: string): boolean {
  if (isAdmin(principal)) return true;
  return authorize(principal, { workspace: "host", action: "roster:read", tableId }).allowed;
}

function canPropose(principal: ServerVerifiedPrincipal, tableId: string): boolean {
  if (isAdmin(principal)) return true;
  return authorize(principal, { workspace: "host", action: "roster:propose", tableId }).allowed;
}

function validPage(input: RosterListInput): boolean {
  return Number.isSafeInteger(input.limit) && input.limit >= 1 && input.limit <= 50
    && (input.cursor === undefined || input.cursor.length <= 160 && tableCursorPattern.test(input.cursor));
}

function validContextPage(input: RosterContextInput): boolean {
  return Number.isSafeInteger(input.limit) && input.limit >= 1 && input.limit <= 50
    && (input.cursor === undefined || input.cursor.length <= 180 && applicantCursorPattern.test(input.cursor));
}

function validSaveRequest(request: SaveRosterInput["request"]): boolean {
  return uuidPattern.test(request.operationId) && uuidPattern.test(request.supplyRevisionId)
    && (request.expectedProposalRevision === null || Number.isSafeInteger(request.expectedProposalRevision) && request.expectedProposalRevision > 0)
    && Array.isArray(request.selectedRequestIds) && request.selectedRequestIds.length <= 6
    && request.selectedRequestIds.every((id) => uuidPattern.test(id))
    && new Set(request.selectedRequestIds).size === request.selectedRequestIds.length;
}

function validActionRequest(request: RosterProposalActionInput["request"]): boolean {
  return uuidPattern.test(request.operationId) && Number.isSafeInteger(request.expectedProposalRevision)
    && request.expectedProposalRevision > 0;
}

export function createRosterService(dependencies: RosterServiceDependencies): RosterService {
  type ActorResolution =
    | Readonly<{ ok: true; actor: ServerVerifiedPrincipal }>
    | Readonly<{ ok: false; code: "unauthenticated" | "temporarily_unavailable" }>;

  async function resolve(token: string | null | undefined): Promise<ActorResolution> {
    if (typeof token !== "string" || token.trim().length === 0) return { ok: false, code: "unauthenticated" };
    try {
      const actor = await dependencies.resolvePrincipal(token);
      return actor ? { ok: true, actor } : { ok: false, code: "unauthenticated" };
    } catch {
      return { ok: false, code: "temporarily_unavailable" };
    }
  }

  function resolutionFailure<T>(resolution: Extract<ActorResolution, { ok: false }>): RosterServiceResult<T> {
    return resolution.code === "unauthenticated"
      ? fail("unauthenticated", "Sign in to continue.")
      : fail("temporarily_unavailable", "Roster curation is temporarily unavailable.");
  }

  return Object.freeze({
    async listAdminSeatRequests(input: RosterListInput): Promise<RosterServiceResult<AssignedCurationTablesDTO>> {
      if (!validPage(input)) return fail("invalid_input", "Check the seat-request queue page and filters.");
      const resolution = await resolve(input.accessToken);
      if (!resolution.ok) return resolutionFailure<AssignedCurationTablesDTO>(resolution);
      const actor = resolution.actor;
      if (!isAdmin(actor)) return fail("forbidden", "Only an admin may review all Table requests.");
      try { return { ok: true, value: await dependencies.repository.listAdminSeatRequests(actor.userId, input) }; }
      catch (error) { return repositoryFailure(error); }
    },

    async listAssignedCurationTables(input: RosterListInput): Promise<RosterServiceResult<AssignedCurationTablesDTO>> {
      if (!validPage(input)) return fail("invalid_input", "Check the assigned Tables page and filters.");
      const resolution = await resolve(input.accessToken);
      if (!resolution.ok) return resolutionFailure<AssignedCurationTablesDTO>(resolution);
      const actor = resolution.actor;
      if (!isAdmin(actor) && !actor.staffRoles.has("host")) return fail("forbidden", "Staff curation access is required.");
      try { return { ok: true, value: await dependencies.repository.listAssignedCurationTables(actor.userId, input) }; }
      catch (error) { return repositoryFailure(error); }
    },

    async readTableRoster(input: RosterContextInput): Promise<RosterServiceResult<TableRosterContextDTO>> {
      if (!uuidPattern.test(input.tableId) || !validContextPage(input)) return fail("invalid_input", "Check the Table roster link and page.");
      const resolution = await resolve(input.accessToken);
      if (!resolution.ok) return resolutionFailure<TableRosterContextDTO>(resolution);
      const actor = resolution.actor;
      if (!canCurate(actor, input.tableId)) return fail("forbidden", "You are not assigned to this Table.");
      try { return { ok: true, value: await dependencies.repository.readTableRoster(actor.userId, input.tableId, input) }; }
      catch (error) { return repositoryFailure(error); }
    },

    async saveRosterProposal(input: SaveRosterInput): Promise<RosterServiceResult<RosterProposalDTO>> {
      if (!uuidPattern.test(input.tableId) || !validSaveRequest(input.request)) return fail("invalid_input", "Check the proposed roster and try again.");
      const resolution = await resolve(input.accessToken);
      if (!resolution.ok) return resolutionFailure<RosterProposalDTO>(resolution);
      const actor = resolution.actor;
      if (!canPropose(actor, input.tableId)) return fail("forbidden", "You are not assigned to this Table.");
      try { return { ok: true, value: await dependencies.repository.saveRosterProposal(actor.userId, input.tableId, input.request) }; }
      catch (error) { return repositoryFailure(error); }
    },

    async submitRosterProposal(input: RosterProposalActionInput): Promise<RosterServiceResult<RosterProposalDTO>> {
      if (!uuidPattern.test(input.tableId) || !validActionRequest(input.request)) return fail("invalid_input", "Check the proposal revision and try again.");
      const resolution = await resolve(input.accessToken);
      if (!resolution.ok) return resolutionFailure<RosterProposalDTO>(resolution);
      const actor = resolution.actor;
      if (!canPropose(actor, input.tableId)) return fail("forbidden", "You are not assigned to this Table.");
      try { return { ok: true, value: await dependencies.repository.submitRosterProposal(actor.userId, input.tableId, input.request) }; }
      catch (error) { return repositoryFailure(error); }
    },

    async approveRoster(input: RosterProposalActionInput): Promise<RosterServiceResult<RosterApprovalResultDTO>> {
      if (!uuidPattern.test(input.tableId) || !validActionRequest(input.request)) return fail("invalid_input", "Check the proposal revision and try again.");
      const resolution = await resolve(input.accessToken);
      if (!resolution.ok) return resolutionFailure<RosterApprovalResultDTO>(resolution);
      const actor = resolution.actor;
      if (!isAdmin(actor)) return fail("forbidden", "Only an admin may approve a roster.");
      try { return { ok: true, value: await dependencies.repository.approveRoster(actor.userId, input.tableId, input.request) }; }
      catch (error) { return repositoryFailure(error); }
    },
  });
}
