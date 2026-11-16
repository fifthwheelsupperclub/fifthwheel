---

> **Superseded 2026-11-16.** This flow was removed; staff place guests directly from the waitlist queue (`place_guest_at_table`). See [PRD §0](../PRD.md#0-version-4-change-2026-11-16-no-approval-steps). Kept as history.
id: quality-w06-roster
type: quality-strategy
status: proposed
date: 2026-11-13
owner: liza
related_objects: [object-guest, object-table]
related_evidence: []
related_decisions: []
---

# W06 roster composition quality strategy

Coordinator-authored strategy for implementation planning; independent Sentry review is unavailable in the current run and is not claimed.

## Release decision

Scope is local W06.3–W06.4: candidate eligibility/order, versioned roster proposals, composition validation, host proposal/admin approval, and durable invitation queueing. A wrong roster or duplicate invitation can expose member data or create unauthorized payment access, so these paths require database-level atomicity and role tests before any roster UI is accepted. Use synthetic fixtures and intercepted email only.

## Risks ranked

| Risk | Impact | Reach | Likelihood | Detectability | Recoverability |
|---|---|---|---|---|---|
| Invalid/stale roster approved | High | All selected members | Medium | High with rule-specific assertions | Medium; no invites may be committed |
| Duplicate or partial invitations | High | Selected members | Medium | High through operation/audit/outbox counts | Medium; reconciliation required after uncertain delivery |
| Host or unrelated admin actor can approve another Table | High | Members/Table owner | Medium | High through direct API role/assignment probes | High before queueing; otherwise revoke/close exact invitation |
| Incorrect age or identity compatibility | High | Applicants | Medium | Medium; needs boundary and set-matrix coverage | Low after invites are sent; block approval |
| Candidate rank is nondeterministic or implies a false score | Medium | Applicants/staff | Medium | High with stable-order snapshots | High; reorder deterministically |
| Private DOB/preferences leak in host or member DTO | High | Applicants | Medium | Medium; assert allowlisted DTOs | Low after disclosure; prevent at repository boundary |

## Mapped acceptance criteria

| Acceptance criterion | Observable check | Status |
|---|---|---|
| A06 | Pair/profile/Table revision changes reject approval atomically; no invite/outbox/audit partial rows; retry creates no duplicate | planned |
| A07 | T−48 reminder reports active unpaid invitations and changes no invitation state | W06.5 |
| A08 | Sharing is an ordinary Table URL; recipient follows app/profile/request gates; no invite/hold created | W06.1 accepted |
| R03 rules | Candidate ranking is exactly request time then UUID; preference sets preserve each of seven non-empty combinations | planned |

## Coverage plan

- Unit: every identity pair and all seven non-empty `openTo` sets; ages at Table-date birthday boundary, min/max inclusion, 12-year inclusive span and 13-year rejection; groups 2, 3, 4, 5 and 6; each guest's mutual-open graph degree; missing DOB/profile/preference; critical profile revision change.
- Service/database: individual eligibility vs group compatibility; stable recommendation order under identical timestamps; host proposal but admin-only approval; wrong-Table assignment; stale profile/Table/proposal revision; concurrent proposal update and approval; idempotent approval replay; unique one-invitation-per-selected-member; rollback/no side effects on any validation error.
- Browser: applicant queue, valid/invalid roster feedback, stale revision recovery, host vs admin actions, no sensitive field leakage, responsive table/editor layout, keyboard ordering and actionable errors.
- Recovery: provider acceptance/unknown/failure after the durable invitation queue is committed; reconcile/send retry uses the same invitation and delivery operation, without recreating approval.

## Residual risk

Independent Sentry review, browser execution and production sender/invitation behavior remain pending. Do not claim real email delivery or production readiness from local Mailpit evidence.
