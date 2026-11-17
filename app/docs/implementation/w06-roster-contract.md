---

> **Superseded 2026-11-16.** This flow was removed; staff place guests directly from the waitlist queue (`place_guest_at_table`). See [PRD §0](../PRD.md#0-version-4-change-2026-11-16-no-approval-steps). Kept as history.
id: integration-fifthwheel-w06-roster
type: integration-contract
status: proposed
date: 2026-11-13
owner: relay
related_objects: [object-guest, object-table]
related_evidence: [../PRD.md, ../tasks-checklist.md, w06-roster-run-packet.md, w06-roster-flow.md, w06-browse-requests-contract.md, w05-supply-contract.md, w04-slice-report.md]
related_decisions: []
---

# W06.3–W06.4 roster proposals and Table invitations

## Outcome and systems

Staff curate applicants who requested a Seat into a versioned 3–5 person roster. A verified assigned host may prepare and submit a proposal; only an admin may approve it. Approval revalidates the current Table, selected requests, profiles, and composition rules in one Supabase transaction, then creates one durable named Table Invitation and one email-outbox item per selected guest. Invalid, stale, unauthorized, or replayed approval cannot create extra invitations. W06.4 records offers and queues delivery; it does not send email inline, grant checkout authority by itself, create a paid Seat, or share state with app-admission invitations.

Participating systems and ownership:

- **Supabase** is authoritative for identity/admission, profiles/reviews, Seat requests, Table revisions, assignments, proposals, Table Invitations, outbox state, idempotency, and audit.
- **The application server** authenticates the cookie session, resolves the trusted actor and role/assignment, validates inputs, and calls service-only transactional functions.
- **Email provider/worker** is a later W06.5 integration. W06.4 commits durable delivery intent; an email send result never changes whether an invitation exists.
- **Finn** owns admin/host routes and screens; **Relay** owns schema, server contracts, authorization and services; **Liza** coordinates acceptance; **Luke** stewards the domain rules.

The UI uses separate workspaces: `/admin/seat-requests` and `/admin/seat-requests/$tableId` for admins; the assigned-host journey lives under `/host/assigned-tables` and `/host/tables/$tableId/roster`. Keep `/admin/tables/$tableId` as the W05 supply revision editor. Seat Requests navigation must not point at that supply editor.

## Source of truth and existing boundaries

- `app_member_profiles` is one-to-one with an Auth user and app admission. It stores `profile_revision`, `critical_identity_version`, `reviewed_identity_version`, `identity_status`, DOB, one identity, exact `open_to` set, age bounds, and required profile fields. Profile saves increment `profile_revision`; DOB/identity and private evidence changes invalidate identity review and advance the critical version. Preference-only changes still advance the profile revision and therefore stale a roster snapshot.
- `app_table_requests` is the W06.2 Seat application record. A request is not a Table Invitation or Seat. Its active state is `pending`; withdraw/decline history is retained. W06.4 must not rewrite a request to imply invitation delivery or payment. A selected pending request is excluded from later candidate queues by its active Table Invitation relationship. Member-facing invitation status is a separate W06.5 surface.
- `app_supply_table_heads` and immutable `app_supply_table_revisions` own Table content and the published revision pointer. `app_supply_table_assignments` maps host user UUIDs to Table UUIDs. Do not put roster pointers or runtime invitation/payment state into supply content or mutate draft/accepted/published pointers during curation.
- Existing `app_invitation_deliveries` are app-access invitations for the waitlist. They are not Table offers and must not be reused for this workflow. Add a separate Table Invitation/outbox boundary.
- The W05 `protected_by_activity` latch prevents unsafe schedule/venue edits after Table activity. Creating the first Table Invitation and creating paid Seat activity in W07 must set this latch transactionally. No direct client toggle is allowed.

## Frozen product rules and eligibility

An applicant is **individually eligible** only when all conditions hold at evaluation time:

1. The request is this Table's `pending` Seat request and belongs to an admitted member whose Auth email is verified and whose admission is activated.
2. The current profile is complete, identity-approved, and `reviewed_identity_version = critical_identity_version`.
3. The member will be at least 21 on the Table's Atlanta-local date. Compute age from DOB on that date; never use a cached age or the current date.
4. There is no existing active Table Invitation or paid Seat for this member and Table.

Roster composition requires 3–5 distinct eligible guests. For every selected pair, each person's age must lie within the other's inclusive `match_age_min`–`match_age_max`. The oldest-minus-youngest age span must be at most 12 years. Every selected guest must have at least one other selected guest with mutual openness: each person's exact identity is present in the other's exact non-empty `open_to` set. Do not require every pair to be mutually open. Preserve the seven possible non-empty subsets of `woman`, `man`, and `non_binary`; never broaden, rank, or infer preferences.

Recommendations are the eligible candidates ordered by active request creation time ascending, then guest UUID ascending as a deterministic tie-break convention. This is a queue order, not a compatibility score. Compatibility is evaluated against the current proposal only. No temperament, profile text, inferred preference, or other score is introduced.

Eligibility and compatibility are server-computed from current trusted rows. The browser never supplies age, identity, `open_to`, approval state, request owner, host assignment, or a client-generated score as authority. Candidate DTOs may show a staff-authorized display name, request time, eligibility flag and stable safe reason codes. Do not send DOB, contact details, identity evidence, exact ages, raw `open_to`, private profile fields, or host-only notes in curation DTOs. Pair validation may identify affected guest IDs/names and a rule code, but not disclose DOB or preference values.

## Proposed additive persistence contract

Use new private, RLS-enabled relations and service-only transactional RPCs. Never grant anon/authenticated Data API access to roster, invitation, outbox, or operation rows. Keep W05 supply relations intact.

- **Roster proposal versions:** durable Table-scoped proposals with an immutable revision number, creator/submitter, captured `published_revision_id`, rule-set version, selected request/guest IDs, captured profile revision and critical identity version for every selection, validation result, state, timestamps, and actor audit. Keep a distinct current-proposal pointer or equivalent compare-and-swap mechanism; do not reuse the W05 draft pointer. Persist invalid drafts for staff feedback, but only a current valid submitted proposal can be approved.
- **Proposal members:** normalized selected-request/guest rows keyed by proposal revision. Their request and guest linkage must be checked against the current request owner and Table at save and approval.
- **Table Invitations:** separate offer rows keyed by stable invitation UUID, Table UUID, named guest/auth identity, source request, approved proposal revision, approving admin, and durable offer state. Invitations do not expire. A partial unique constraint or equivalent invariant prevents duplicate active offers for the same Table/member. W06.4 creates initial roster offers only; replacing/revoking an already active offer is a later separately authorized workflow.
- **Table Invitation outbox:** one row per newly created Table Invitation, committed in the same transaction as approval. It identifies the invitation and named principal, has a stable delivery operation/idempotency key and safe queue state, and never trusts recipient or destination from the request body. Delivery attempts/provider IDs are a separate operational detail; they must not be stored in app-admission delivery rows.
- **Operations and audit:** operation UUID, actor UUID, action, canonical request hash, persisted result, and creation time; PII-free audit entries for proposal creation/revision/submission, approval, and queued invitation count. Reject operation-key reuse across actor/action/body.

Use additive migrations only. When invitation/Seat runtime relations are added, wire their creation into `protected_by_activity` in the same transaction. Do not touch external providers or apply a migration until coordinator inspection and explicit local-test approval.

## Operations

All endpoints are same-origin, cookie-authenticated, no-store. Mutation handlers enforce exact allowed request fields and origin/CSRF rules, derive the actor from the verified session, and pass it to server authorization and the database. Use the shared `{ok:true,data,correlationId}` / `{ok:false,error:{code,message,retryable,correlationId,details?}}` envelope. The host/admin UI routes are separate, but server permissions are authoritative.

| Operation | Request | Result | Authorization |
|---|---|---|---|
| `GET /api/admin/seat-requests` | `cursor`, `limit` | Admin queue of published future Tables with pending request count, proposal state and safe summary. Additional Table/date filters are deferred to W10. | Verified admin only |
| `GET /api/curation/assigned-tables` | `cursor`, `limit` | Admin sees all published future Tables; host sees only current UUID assignments. Returns Table summary, published revision, pending request count and proposal summary; no supply mutation capability | Verified admin or host |
| `GET /api/curation/tables/:tableId/roster` | `cursor`, `limit` | Current Table revision summary, pending applicants and safe eligibility reasons, eligible recommendation order, current proposal revision and validation. Existing proposal history for a past, unpublished, or revision-changed Table is read-only with no fresh candidate recommendations. | Verified admin; or verified host with current UUID assignment to this Table |
| `PUT /api/curation/tables/:tableId/roster-proposal` | `{operationId, expectedProposalRevision, supplyRevisionId, selectedRequestIds[]}`; `expectedProposalRevision:null` creates the first version | New immutable proposal revision, server-computed validation, safe summary of selected guests | Verified admin or assigned host |
| `POST /api/curation/tables/:tableId/roster-proposal/submit` | `{operationId, expectedProposalRevision}` | Current proposal marked submitted for admin review; admin may submit their own proposal too | Verified admin or assigned host |
| `POST /api/admin/seat-requests/:tableId/approve` | `{operationId, expectedProposalRevision}` | Approved proposal and invitation IDs with state `queued`; never claims provider acceptance or inbox delivery | Verified admin only |

The queue and detail DTO expose `tableId`, guest-safe Table title/date/time/neighborhood, current supply revision ID, proposal revision/state, `requestId`, `guestId`, staff-authorized display name, request creation time, `eligible`, stable reason codes, whether selected in the current proposal, and server-derived capabilities. Every proposal DTO includes `selectedGuests: [{guestId, displayName}]` alongside selected request IDs so authorized staff can inspect historical rosters when fresh applicant recommendations are unavailable. Proposal validation returns `{valid, issues:[{code, guestIds?}]}`. Avoid DOB, exact age, raw identity/preference values, contact fields, private evidence, and source/provider IDs. Only admins see the approve control; hiding it for hosts is usability, not enforcement.

Mutation bodies use UUID operation IDs, proposal revision compare-and-swap, and request IDs only. The server reads the current proposal, supply revision, request owner, active invitation state, profile, admission, Auth verification and assignment itself. Proposal save accepts a bounded list of 0–6 distinct request UUIDs so an invalid draft can be persisted with actionable validation; submit and approval require a valid 3–5 person roster. Save canonicalizes the request IDs in UUID order before hashing, so retrying the same selection in a different UI order replays the same result.

## Atomicity, replay and stale revisions

Proposal save creates the next immutable revision under a Table-scoped lock and compares `expectedProposalRevision`; a stale write returns `revision_conflict` and changes nothing. Replaying an identical operation ID, actor and canonical body returns the saved result; a different actor/action/body under that key returns `operation_conflict`. Saving or submitting never creates invitations.

Approval is one Supabase transaction/RPC. Lock in a consistent order: operation key, Table head/current published revision, current proposal, selected request rows in UUID order, selected profile rows in guest UUID order, then invitation/Seat capacity state. The locks must conflict with profile edits, request withdrawal/decline, proposal updates, supply publication/unpublish, and competing approval. Recheck, after locks:

1. Actor remains an admin; proposal is the expected current submitted revision; same Table is still published and future; `published_revision_id` exactly matches the proposal's captured revision.
2. Every selected request remains pending for the same Table and belongs to an activated admission with verified Auth email; no selected guest has an active invitation/paid Seat.
3. Every selected profile is complete and currently approved; `profile_revision`, `critical_identity_version`, and `reviewed_identity_version` match captured values.
4. Individual age, distinct-member count, all mutual age ranges, 12-year span, and per-guest mutual-open connection still pass.
5. Approval will not exceed the five active invited/paid members for this Table. For this initial-roster slice, an already active roster or any capacity requiring replacement is a `roster_already_active`/`capacity_conflict`; W08 replacement flow owns that case.

If any check fails, commit no approval, invitation, outbox entry, latch update or success audit. The invalid/stale proposal can remain visible with safe issues; a corrected proposal is a new revision. A successful approval atomically marks the proposal approved, inserts one active Table Invitation and one outbox item for each selected guest, records the operation result/audit, and sets the W05 activity latch. A unique constraint remains the final duplicate guard. Replaying approval returns the exact recorded result and creates no new offer/outbox rows.

Authorized staff may inspect an existing proposal after its Table is past, unpublished, or points at another supply revision. The read uses the proposal's captured supply revision where necessary, returns `table.readOnlyReason` (`past`, `unpublished`, or `revision_changed`) and a false `validation.valid`, omits candidate/recommendation data, and disables edit/submit/approve. A read-only historical proposal is not evidence that its members remain eligible.

Do not update the original Seat request state merely to represent a Table offer. The request and invitation are distinct objects; curation excludes a request with an active invitation, while later member UI displays both states. Do not allow a second full-roster approval to duplicate offers. Invitation revocation/replacement and conversion to paid Seat are separate operations outside W06.4.

**W06.5 member-history dependency:** because an approved Table Invitation leaves its source Seat request in `pending`, the member Requests/history UI must overlay the active invitation as a separate Table offer and suppress or clearly replace the request's normal “awaiting review”/Withdraw action while that offer is active. Acceptance evidence must show the member can see the named Table invitation without implying payment or changing the underlying request history.

Outbox work runs after commit. Email failure, timeout, or unknown outcome cannot roll back roster approval or create a second offer. W06.5 must use durable attempt state and reconciliation; provider-accepted is not inbox delivery. No W06.4 API response claims that an email was sent or delivered.

## Failure behavior

Stable safe errors:

- `unauthenticated`, `forbidden`, `not_found` (including host access to an unassigned Table), `invalid_input`.
- `validation_failed` with rule codes such as `select_three_to_five`, `candidate_ineligible`, `age_under_21`, `age_range_invalid`, `pair_age_mismatch`, `age_span_exceeded`, `missing_mutual_open_connection`, and `duplicate_guest`; never include exact DOB/ages/preferences.
- `revision_conflict`, `stale_table`, `stale_profile`, `request_not_pending`, `proposal_not_submitted`, `profile_not_approved`, `member_not_admitted`, `roster_already_active`, `capacity_conflict`, and `operation_conflict`.
- `temporarily_unavailable` with retryable/correlation ID and no SQL/provider text. On a client timeout, retry with the same operation ID and body or reload the persisted proposal/approval state; never mint a new key to guess whether approval committed.

No published future Tables or no pending requests produces a real empty queue with zero counts and an actionable empty-state message; it must not fabricate example guests or proposals. If a Table is unpublished, past, or its current revision changes, existing proposal history remains inspectable to authorized staff but cannot be newly submitted/approved against the stale revision. A host whose assignment is removed loses access on the next request. A profile change while the host editor is open makes the proposal stale and blocks approval.

## Versioning and compatibility

Treat proposal revision and profile/supply/request IDs as explicit concurrency tokens, not timestamps or client state. Add browser-safe DTOs in one shared contract and typed server-only inputs/results. Use new API routes and new tables/RPCs; do not silently change W05 supply DTOs or W06.2 request ownership/history semantics. When W06.5 adds member invitation history and delivery UI, it consumes the durable Table Invitation/outbox IDs and keeps app-admission invitations separate. W07 checkout must require the active Table Invitation to name the authenticated guest and current Table, and must recheck admission/profile/lifecycle/capacity under its own transaction; roster approval alone never creates payment authority.

## Observability and verification

Use correlation IDs across route, RPC and outbox. Audit actor UUID, Table/proposal/invitation UUIDs, action, revision, reason codes and counts only; never DOB, email, image data, raw preference sets, message body, provider secrets or tokens. Track proposal validation failures by rule code, stale approval conflicts, duplicate operation replays, queued invitations and outbox unknown/failure counts. Liza owns acceptance evidence; Relay owns DB/service diagnostics; Harbor owns future delivery recovery.

Required local evidence before W06.3–W06.4 acceptance:

- exact seven preference sets and mutual-open edges; age on Atlanta Table date including birthday/leap/date boundaries; every mutual age-range edge; 12 vs 13-year span; 2/3/5/6 candidates; missing/incomplete/unapproved profile; request not pending; candidate order/tie UUID.
- admin and assigned-host journeys; unassigned host, member, restaurant and anonymous direct API denials; host proposal but no host approval; assignment removal; sanitized DTOs.
- proposal version CAS, profile preference/critical change, request withdrawal, Table publish/unpublish/revision change, and concurrent approval races; all stale/invalid cases create zero invitation/outbox rows.
- same-key approval replay, changed-body/actor operation conflict, separate operation IDs racing for the same proposal, unique active offer/capacity guard, and activity latch set atomically without changing supply pointers.
- rollback-only local Supabase harness and browser journey with synthetic records, plus typecheck/build and route-level checks. Do not reset a database, contact hosted Supabase, send real mail, or apply a migration before coordinator review.

## Remaining scope boundary

This contract covers W06.3 composition/recommendations and W06.4 proposal/admin approval with durable invitation/outbox creation. Member invitation history, delivery worker/attempt recovery, T−48 reminder, revocation, replacement, payment, and paid Seat state remain W06.5/W07/W08 responsibilities. Cutoff behavior for Tables has not been resolved elsewhere; this contract does not add a cancellation or expiry state.
