/** Browser-safe W06.3-W06.4 roster and Table Invitation queue contracts. */

export type RosterProposalState = "draft" | "submitted" | "approved" | "superseded";

export type RosterIssueCode =
  | "select_three_to_five"
  | "candidate_not_found"
  | "request_not_pending"
  | "member_not_admitted"
  | "profile_not_approved"
  | "profile_incomplete"
  | "stale_profile"
  | "age_under_21"
  | "age_range_invalid"
  | "candidate_already_invited"
  | "pair_age_mismatch"
  | "age_span_exceeded"
  | "missing_mutual_open_connection"
  | "stale_table";

export type RosterValidationIssue = Readonly<{
  code: RosterIssueCode;
  guestIds?: readonly string[];
}>;

export type RosterValidationDTO = Readonly<{
  valid: boolean;
  issues: readonly RosterValidationIssue[];
}>;

export type AssignedCurationTableDTO = Readonly<{
  tableId: string;
  title: string;
  localDate: string;
  startLocalTime: string;
  neighborhood: string;
  publishedRevisionId: string;
  pendingRequestCount: number;
  currentProposal: Readonly<{
    proposalId: string;
    revision: number;
    state: RosterProposalState;
    selectedCount: number;
    valid: boolean;
  }> | null;
}>;

export type AssignedCurationTablesDTO = Readonly<{
  items: readonly AssignedCurationTableDTO[];
  nextCursor: string | null;
}>;

export type RosterApplicantDTO = Readonly<{
  requestId: string;
  guestId: string;
  displayName: string;
  requestCreatedAt: string;
  eligible: boolean;
  reasonCodes: readonly string[];
  recommendationRank: number | null;
  selected: boolean;
}>;

export type RosterProposalDTO = Readonly<{
  proposalId: string;
  revision: number;
  state: RosterProposalState;
  supplyRevisionId: string;
  selectedRequestIds: readonly string[];
  selectedGuests: readonly Readonly<{ guestId: string; displayName: string }>[];
  validation: RosterValidationDTO;
  createdAt: string;
  updatedAt: string;
}>;

export type TableRosterContextDTO = Readonly<{
  table: Readonly<{
    tableId: string;
    title: string;
    localDate: string;
    startLocalTime: string;
    neighborhood: string;
    publishedRevisionId: string | null;
    readOnlyReason: "past" | "unpublished" | "revision_changed" | null;
  }>;
  applicants: Readonly<{ items: readonly RosterApplicantDTO[]; nextCursor: string | null }>;
  currentProposal: RosterProposalDTO | null;
  permissions: Readonly<{ canEditProposal: boolean; canSubmit: boolean; canApprove: boolean }>;
}>;

export type SaveRosterProposalRequest = Readonly<{
  operationId: string;
  expectedProposalRevision: number | null;
  supplyRevisionId: string;
  selectedRequestIds: readonly string[];
}>;

export type RosterProposalMutationRequest = Readonly<{
  operationId: string;
  expectedProposalRevision: number;
}>;

export type RosterApprovalResultDTO = Readonly<{
  proposal: Readonly<{ proposalId: string; revision: number; state: "approved" }>;
  invitations: readonly Readonly<{
    invitationId: string;
    guestId: string;
    state: "active";
    deliveryState: "queued";
  }>[];
}>;

export type RosterErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "invalid_input"
  | "not_found"
  | "request_not_found"
  | "validation_failed"
  | "revision_conflict"
  | "stale_table"
  | "stale_profile"
  | "request_not_pending"
  | "proposal_not_submitted"
  | "proposal_not_editable"
  | "profile_not_approved"
  | "member_not_admitted"
  | "roster_already_active"
  | "capacity_conflict"
  | "operation_conflict"
  | "temporarily_unavailable";

export type RosterError = Readonly<{
  code: RosterErrorCode;
  message: string;
  retryable: boolean;
  correlationId: string;
  details?: Readonly<{ issues: readonly RosterValidationIssue[] }>;
}>;

export type RosterResponse<T> =
  | Readonly<{ ok: true; data: T; correlationId: string }>
  | Readonly<{ ok: false; error: RosterError }>;
