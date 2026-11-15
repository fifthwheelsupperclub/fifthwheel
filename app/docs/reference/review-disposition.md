# Fifthwheel MVP — Independent Review and Hand-off Disposition

Version 2 · 2026-11-11 · Review target: the four linked MVP specification documents.

## 1. Readiness

The packet is ready for local development in dependency order, starting with B01. Product decisions D01–D13 are recorded; all material findings from the three fresh reviewers have corrections and targeted rechecks. This is a specification-readiness result, not a production, privacy/legal, deployment or payment-system certification.

B01 can begin now with local schemas, fixtures, permission contracts and read-only discovery. B02–B06 begin as their explicit prerequisites pass. B07 includes external configuration, migration, sandbox/live rehearsal and release gates. No application implementation, provider change, production data access, deployment or live charge was performed for this hand-off.

## 2. Review method and evidence

Applied the [Elephant Goldfish model](https://github.com/google/elephant-goldfish-model) as context-led drafting followed by independent fresh-context review. The human requested fresh reviewer agents. Three agents were created with `fork_turns=none`; each received the four artifact paths, relevant role/skill instructions and permission to inspect referenced local source. They did not receive the planning conversation or implementation ownership. This adapts EGM to four linked artifacts; it does not claim the full plugin workflow or formal certification.

| Reviewer focus | Original review | Targeted recheck |
| --- | --- | --- |
| Product completeness and clarity (Allie responsibility) | [Product findings](reviews/product.md) | [Product recheck](reviews/product-recheck.md) |
| Architecture, external boundaries and implementation readiness (Relay responsibility) | [Architecture findings](reviews/architecture.md) | [Architecture recheck](reviews/architecture-recheck.md) |
| Permissions, data privacy and lifecycle (Cipher responsibility) | [Privacy findings](reviews/privacy.md) | [Privacy recheck](reviews/privacy-recheck.md) |

The original reports are preserved unchanged. Their conditional initial verdicts are superseded only by the corrections/rechecks recorded here; original report line references refer to the initial review revision. Initial target SHA-256 prefixes: PRD `98b4337ae900`, Architecture `c4354a875790`, Flow/UI `9c6db9c26bc7`, Backlog `7c3c3d7ff116`.

## 3. Findings and disposition

Eight reported findings represented seven distinct defects (the snapshot-timing defect was independently found twice). Two were P1 and six were P2. Severity describes a specification defect, not a demonstrated deployed exploit.

| ID | Reviewer finding | Disposition and changed contract | Acceptance/task evidence |
| --- | --- | --- | --- |
| AR1 · P1 | Submitted refunds omitted from reserved balance | Resolved: Architecture §5 counts pending/submitted/unknown/failed-still-owed and succeeded allocations; Table cancellation adds only uncovered remainder. Same-key retries retain allocation. | A14/A15; B04.4 fixture submits partial refund, cancels Table and receives delayed first settlement. Architecture recheck resolved. |
| AR2 · P1 | Durable ingress introduced after final migration delta | Resolved: Architecture §9 installs durable ingress first, disables/drains old webhook and return writers, then imports final delta and starts one mapped processor. Pre-write rollback preserves queued events. | A24; B07.3 injects events at ingress/drain/delta/switch boundaries. Architecture recheck resolved. |
| AR3 · P2 / CP1 · P2 | Scheduler could freeze ballot eligibility at Table start | Resolved: Architecture §8 explicitly freezes at start+90m, forbids early materialization and specifies timestamp/lock ordering and delayed-worker equivalence. | A19; B06.1 includes +45m/+60m arrivals and delayed worker. Both rechecks resolved. |
| GP1 · P2 | Pending cancellation could strip attendance/vote eligibility | Resolved: PRD R05 and Architecture §3 share active_paid predicate including cancellation_requested; release occurs only on staff-confirmed removal. | A13/A19; B05.3/B06.1 pending request at opening, denial afterward. Product recheck resolved. |
| GP2 · P2 | Identity/open-to domain and migration semantics unspecified | Resolved by human D13: one Woman/Man/Non-binary identity, single Women/Men/Everyone preference. Architecture §3 defines normalization, derived sets, unknown quarantine and rejects arbitrary API combinations. | A02/A06; B03.2 complete identity/menu, non-binary coverage and legacy-value fixtures. Product recheck resolved. |
| CP2 · P2 | 30-day ballot purge incompatible with 90-day reveal | Resolved: private mutual_results schema, idempotent close finalization, prerequisite before purge, removal/account-deletion invalidation, explicit results_unavailable response. | A20; B06.2 day-31/day-90, removal/deletion and interrupted-finalizer fixtures. Privacy recheck resolved. |
| CP3 · P2 | Required photos conflicted with retention deletion | Resolved: evidence required on review submission; approved unchanged version remains complete after purge using minimal received/deleted markers. Critical edits require new evidence. | A02; B02.3 review+31d checkout and fresh-review regression fixture. Privacy recheck resolved. |

Each specialist claim was checked against the packet and, for current-behavior claims, the referenced source. In particular, the old webhook calls Airtable fulfillment directly and can acknowledge a fulfillment error; the cutover correction removes that old-writer gap rather than assuming Stripe will replay every event. No automated application test is claimed for these document corrections.

## 4. Evidence debt and production gates

These are discoverable external facts or required implementation evidence, not unanswered product choices. No credentials or guest data are included in this packet.

| Debt | Responsible role / task | Required evidence before release |
| --- | --- | --- |
| Current deployed repository/release, runtime and scheduler capability | Release owner + Harbor / B01.1, B01.5, B07.4 | Identified artifact/environment, authenticated worker wiring, independent heartbeat alert; no assumption that historical Next.js/Render config is current. |
| Real Airtable field types, complete counts, operation-ID field and data quality | Relay / B01.1, B01.4, B07.1 | Redacted dictionary/mapping, pagination/reconciliation results and repeatable timeout/clone behavior. |
| Hosted Supabase grants, RPC exposure, roles/assignments, buckets and backup expiry | Cipher/Finn / B01.2, B02.2, B05.4, B07.4 | Owner/other-user/admin/host/partner/anon adversarial DB/API checks; private normalized uploads; UUID assignments. |
| Stripe live/test identity, webhook signature/config, existing money/session/refund references | Relay / B04, B07.3 | Sandbox concurrency/replay/recovery evidence, verified import balances and exact human-authorized live dry-run. No live charge authorized by these docs. |
| Legacy identity/payment ambiguity and future paid booking linkage | Finn + operational admin / B01.3, B07.3 | Every source row accounted for; zero unresolved future paid identity/payment links; historical quarantine explicit. |
| Runtime acceptance and accessibility | Finn/Sentry/Charlie/Iris / all slices | A01–A25 passing evidence, build/lint/type checks, keyboard/screen-reader/reflow review. No application tests have been run for this document-only task. |
| Cancellation/terms/privacy/consent copy and retention/backups | Release owner + accountable policy/finance reviewer / B07.4 | Discretionary refund policy replaces all old tier promises; consent versions and proposed retention/financial retention approved and reflected in jobs/runbook. |
| Staff ownership and low-fill/refund/incident handling | Operational admin + release owner / B05/B07 | Queue owners, escalation/support contact, late-decision behavior, refund reconciliation and maintenance/rollback drill accepted. Role names in backlog are responsibility placeholders, not confirmed assignments. |

Development can resolve these through the backlog. Public payment/cutover stays gated until the relevant evidence and exact external-action authorization exist. Shared historical knowledge is not silently edited; the packet's D01–D13 record is the implementation authority for the stated scope.

## 5. Packet validation

Performed direct file/source inspections and documentation consistency checks: internal Markdown links resolve, R01–R11 and A01–A25 map to backlog tasks, D01–D13 are present, task dependencies and route states agree, and the seven distinct findings have recorded remediation/rechecks. Mermaid diagrams are supplied as source; a graphical renderer was not exercised. No build, migration or runtime test was needed or claimed for editing this packet.

Final target fingerprints are listed below for reproducibility. Any subsequent requirement change should update traceability and repeat the affected review.

| Final document | SHA-256 |
| --- | --- |
| PRD.md | `599d24c0863c48775fd0b49a725726f46e592b6919708bef3a2792e59d2f597c` |
| architecture.md | `6c0ad937b644e16a1d886674826142d828ba2e404501d1cd871ec26958f74f58` |
| flow-ui-brief.md | `f8d7bdc6cb671ea04d37a42ea1f2a7a01fbf37101461a84db27b9a901ca75cde` |
| tasks-checklist.md | `3d6459736ee3c4759bf5a53a4abf4ae04e7de106407c55007bb2dc1bc7ec014b` |
