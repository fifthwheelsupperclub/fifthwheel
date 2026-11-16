// Every visible state label lives here, keyed by the contract's state type.
// `Record<Union, …>` makes tsc fail when a state is added without a label.
// Wording is unchanged from the previous inline strings; the authored labels
// in docs/implementation/language-refactor-plan.md §C4 replace these in step 2.
export type RequestState = "pending" | "withdrawn" | "declined" | "closed_by_table";
export type InvitationState = "active" | "revoked" | "closed";

export const REQUEST_STATE_LABEL: Record<RequestState, string> = {
  pending: "Requested",
  withdrawn: "Withdrawn",
  declined: "Declined",
  closed_by_table: "Table cancelled",
};

export const INVITATION_STATE_HEADING: Record<InvitationState, string> = {
  active: "Your invitation is open",
  revoked: "Invitation revoked",
  closed: "Invitation closed",
};

export const INVITATION_STATE_PILL: Record<InvitationState, string> = {
  active: "Active",
  revoked: "Revoked",
  closed: "Closed",
};
