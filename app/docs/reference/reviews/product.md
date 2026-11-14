---
id: fifthwheel-mvp-fresh-product-review
type: challenge
status: complete
date: 2026-11-11
owner: allie
related_objects: [Guest, Table, Seat, Invitation, Ballot]
related_evidence: [app/docs/refactor/PRD.md, app/docs/refactor/architecture.md, app/docs/refactor/flow-ui-brief.md, app/docs/refactor/tasks-checklist.md]
related_decisions: [D02, D04, D06, D08]
---

# Challenge

## What I am challenging

The completeness and consistency of the four-document MVP development hand-off, reviewed independently from its author conversation. Intended outcome: a guest can progress from reviewed application through a durable paid Seat, attendance, private mutual result and feedback while staff operate the Table safely. Scope: product requirements, consequential choices, consistency and traceability. No implementation or production-readiness claim was evaluated.

Read AGENTS.md, agents/allie.md, the local critique-product-decision skill, agent-context/INDEX.md, and all four specified packet files. Inspected the referenced prototype's identity/open-to inputs and matching predicate where the packet leaves that contract undefined. Did not read the earlier review disposition or rely on stakeholder conversation. Verification was direct document/source inspection; no tests were needed or run.

## Strongest case against

The packet is substantially implementable, but two small contract gaps can produce materially different guest eligibility depending on which document an engineer follows. They should be resolved before the corresponding profile/attendance work is accepted. They do not justify stopping transactional foundation work.

## Findings

| Finding | Severity | Evidence or assumption | Impact | Smallest next step |
| --- | --- | --- | --- | --- |
| F1 — Pending cancellation is both a separate Seat state and promised to preserve voting rights, without one shared active-paid predicate. | P2 — resolve before attendance/ballot implementation | `app/docs/refactor/PRD.md`, **R05 — My Seats, cancellation and refunds**, explicitly says requesting cancellation does not change voting eligibility. **R07 — Attendance, vote and reveal** freezes guests with “confirmed paid Seats.” `app/docs/refactor/architecture.md`, **§3 Core schema contract**, makes `cancellation_requested` a separate Seat status; **§4 State machines and authorization**, Check in, requires a “Confirmed paid Seat.” `tasks-checklist.md`, **B05.3/B06.1** and traceability lack a pending-cancellation eligibility fixture. | An otherwise paid, attending guest waiting for admin review can be excluded from check-in or the ballot snapshot merely because their status is no longer literally `confirmed`. The resulting frozen exclusion cannot be repaired by later denying the request. | Define one normative active-paid predicate including `confirmed` and `cancellation_requested` for paid counts, check-in, ballot eligibility and reveal; removal alone ends those rights. Alternatively retain confirmed Seat status and represent the pending request solely in its own record. Add a fixture with a pending request before snapshot and denial after snapshot. |
| F2 — The identity/open-to matching domain is unspecified despite being a non-overridable eligibility rule. | P2 — resolve before B02.2/B03.2 | `app/docs/refactor/PRD.md`, **R01 — Identity, profile and access**, requires “identity” and “open-to identities,” while **R03 — Composition approval and invitations** uses mutual openness as a hard rule. `architecture.md`, **§3 Core schema contract**, declares `identity` and `open-to set`, but neither these sections nor `flow-ui-brief.md`, **Profile and manual review**, specifies allowed values, identity cardinality, empty-set behavior or normalization. The referenced current prototype, `app/src/prototype/FifthWheelPrototype.tsx:283` and `:2079`, instead has single-choice Woman/Man/Non-binary and Women/Men/Everyone, with explicit string mapping. | Engineers must invent an inclusion/migration policy, or silently preserve a prototype restriction that prevents specifically selecting non-binary people. Different implementations can approve different rosters from the same stated preferences. This is a product/domain choice, not an external-provider fact. | Record the supported identity value set and single/multiple cardinality, normalized open-to membership semantics, required/nonempty behavior and legacy mapping. Either explicitly adopt the existing choices or choose the intended new set. Add non-binary, mixed selections, empty and unrecognized legacy-value fixtures to B03.2. Do not infer or broaden a guest's preferences during migration. |

## Evidence gaps and deliberate tradeoffs

- Provider schemas, hosted roles/storage policies, Stripe history/modes, scheduler availability and release-authorized retention/legal copy remain external evidence debt. The packet correctly gates production on those facts; their unavailability is not a defect blocking local foundation development.
- Manual minimum-size cancellation, no payment rescue after the T−24 checkpoint, discretionary refund review, no late ballot entry, no chat/contact exchange, and retaining Airtable supply are explicit choices. This review does not reopen them as missing features.
- Testable operational risk: profile edits/removals can invalidate a proceeding Table, and the hybrid supply model creates reconciliation work. The packet names the resulting queues, enforcement and recovery. Validate those flows with operators during implementation; no new product decision is needed merely because these choices have costs.
- Approval history was supplied by the packet's own decision record, not independently corroborated by this review. No stakeholder confirmation is claimed here.

## Simplification options

The smallest useful simplification is a shared active-paid Seat predicate (or leaving cancellation pending solely in `cancellation_requests`). Keep the existing bounded MVP scope; there is no evidence here to add chat, automated identity checks, synthetic matching scores or another supply platform.

## Recommended tests

Extend the existing mandatory acceptance fixtures with (1) a paid checked-in guest whose cancellation is pending at vote open and later denied, and (2) mutual-open normalization across every supported identity, mixed preference sets and invalid/legacy values. These are recommended implementation checks, not tests executed during this documentation review.

## Preserve list

- Clear request/invitation/hold/payment distinctions and durable recovery for uncertain money outcomes.
- Requirement-to-task/acceptance traceability and explicit separation of local development from production cutover.
- Hard-rule composition validation without synthetic personality scoring or staff override.
- Own-only mutual reveal, explicit Nobody/non-submission privacy, private conduct reports and restricted staff roles.
- Narrow migration claims, quarantine instead of inferred identity facts, and single-writer cutover/rollback constraints.

## Verdict

**Proceed with conditions.** B01 foundation/read-only discovery can proceed. Resolve F2 before finalizing profile/matching contracts, and F1 before accepting attendance/voting behavior. This is not release approval: the packet already requires implementation, acceptance evidence, provider reconciliation and exact human authorization for live actions.
