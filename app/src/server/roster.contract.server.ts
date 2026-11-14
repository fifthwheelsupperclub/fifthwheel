/** Server-only W06.3-W06.4 use case, repository and validated-input types. */

import type {
  AssignedCurationTablesDTO, RosterApprovalResultDTO, RosterProposalDTO,
  RosterProposalMutationRequest, SaveRosterProposalRequest, TableRosterContextDTO,
} from "../roster.contract.ts";

export type RosterServiceFailure = Readonly<{
  code: import("../roster.contract.ts").RosterErrorCode;
  safeMessage: string;
  issues?: readonly import("../roster.contract.ts").RosterValidationIssue[];
}>;

export type RosterServiceResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; error: RosterServiceFailure }>;

export type RosterListInput = Readonly<{ accessToken?: string | null; cursor?: string; limit: number }>;
export type RosterContextInput = Readonly<{ accessToken?: string | null; tableId: string; cursor?: string; limit: number }>;
export type SaveRosterInput = Readonly<{ accessToken?: string | null; tableId: string; request: SaveRosterProposalRequest }>;
export type RosterProposalActionInput = Readonly<{ accessToken?: string | null; tableId: string; request: RosterProposalMutationRequest }>;

export interface RosterRepository {
  listAdminSeatRequests(actorUserId: string, input: Omit<RosterListInput, "accessToken">): Promise<AssignedCurationTablesDTO>;
  listAssignedCurationTables(actorUserId: string, input: Omit<RosterListInput, "accessToken">): Promise<AssignedCurationTablesDTO>;
  readTableRoster(actorUserId: string, tableId: string, input: Omit<RosterContextInput, "accessToken" | "tableId">): Promise<TableRosterContextDTO>;
  saveRosterProposal(actorUserId: string, tableId: string, request: SaveRosterProposalRequest): Promise<RosterProposalDTO>;
  submitRosterProposal(actorUserId: string, tableId: string, request: RosterProposalMutationRequest): Promise<RosterProposalDTO>;
  approveRoster(actorUserId: string, tableId: string, request: RosterProposalMutationRequest): Promise<RosterApprovalResultDTO>;
}

export type RosterServiceDependencies = Readonly<{
  resolvePrincipal: (accessToken: string | null | undefined) => Promise<import("./authorization.server.ts").ServerVerifiedPrincipal | null>;
  repository: RosterRepository;
}>;

export interface RosterService {
  listAdminSeatRequests(input: RosterListInput): Promise<RosterServiceResult<AssignedCurationTablesDTO>>;
  listAssignedCurationTables(input: RosterListInput): Promise<RosterServiceResult<AssignedCurationTablesDTO>>;
  readTableRoster(input: RosterContextInput): Promise<RosterServiceResult<TableRosterContextDTO>>;
  saveRosterProposal(input: SaveRosterInput): Promise<RosterServiceResult<RosterProposalDTO>>;
  submitRosterProposal(input: RosterProposalActionInput): Promise<RosterServiceResult<RosterProposalDTO>>;
  approveRoster(input: RosterProposalActionInput): Promise<RosterServiceResult<RosterApprovalResultDTO>>;
}
