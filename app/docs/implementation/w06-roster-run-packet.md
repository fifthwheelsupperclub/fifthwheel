---
id: run-fifthwheel-w06-roster
type: run-packet
status: in-progress
date: 2026-11-13
owner: liza
related_objects: [object-guest, object-table]
related_evidence: []
related_decisions: []
expected_artifacts: [run-packet, flow, integration-contract, quality-strategy, slice-report]
---

# W06 roster composition and recommendations

## Outcome

Implement W06.3 and the connected W06.4 roster workflow in the fresh app. Staff can review Seat-request applicants, build a versioned 3–5 person roster, see clear pair/group validation reasons, and receive deterministic recommendations based only on eligibility and request time. Assigned hosts may propose a roster; only admins may approve. Approval must atomically revalidate the current profiles/Table revision and queue one Table invitation per selected guest. No invitation, payment access, or provider email is created by an invalid, stale, or replayed approval.

Use the accepted [PRD R03](../PRD.md#r03-composition-approval-and-invitations), [task checklist](../tasks-checklist.md#-w06--browse-seat-requests-curation-and-separate-table-invitations), and W06.1–W06.2 contract. Preserve exact identity preference sets, compute age on the Table date, require every pair's mutual age inclusion, limit total age span to 12, require at least one mutually open connection per selected guest, and keep the roster at 3–5. Deterministic order is request time then guest UUID; do not invent scores.

## Owners and sequence

| Order | Owner | Artifact or decision | Depends on |
|---|---|---|---|
| 1 | Luke | Roster, applicant, and invitation state/rule review; exact eligibility and validation reasons | PRD R01/R03; existing Guest/Table objects |
| 2 | Relay | Versioned roster and approval integration contract, atomicity, idempotency, stale-revision and delivery-outbox behavior | Luke rules; existing W06 request/profile/supply schemas |
| 3 | Finn | Integrated staff roster queue/editor, candidate ordering, validation, host-proposal/admin-approval interface | Frozen domain/contract; current admin and W06 routes |
| 4 | Liza | Acceptance cases, integrated review, checklist and acceptance-ledger updates | Working UI/API plus local test evidence |

Four active slots maximum including Liza. Finn owns route registration/shared UI; Relay owns migrations/server contracts; Luke owns product object knowledge. No parallel migration application, route generation, dependency installation or fixture reset.

## Human gates

- No external email, hosted provider write, live charge/refund, publication, merge or deployment is authorized by this run.
- Use isolated local test Supabase, synthetic profiles/Tables, and intercepted email only.
- No schema reset or hosted target is permitted.
- Product rules are already explicit in R03; surface a contract conflict to Liza instead of inventing a new rule.

## Expected artifacts

- A focused roster flow with member, host, and admin permissions and invalid/stale/replay cases.
- A shared API/integration contract for versioned proposals, deterministic candidate ranking, atomic approval and invitation outbox behavior.
- A risk-based quality strategy covering pairwise compatibility, all seven preference sets, age/date boundaries, 12/13-year span, groups 2–6, stale revisions and duplicate approvals.
- Finn's integrated slice report with routes, changed files, checks and screenshots.

## Completion evidence

The browser can open a Table's request queue, see only currently eligible candidates in deterministic order, propose and edit a versioned roster, understand every rejected rule, and approve only a current valid 3–5 roster as an admin. Assigned hosts cannot approve or send. Concurrent profile/roster changes and duplicate operations do not create partial or duplicate invitations. A rollback-only DB harness and browser journey pass against the isolated test stack. W06.3/W06.4 and A06 acceptance rows are updated only after root review of the integrated evidence.

Residual W06.5 invitation delivery/reminder states remain separate work unless required by the approval integration boundary; production email remains disabled.
