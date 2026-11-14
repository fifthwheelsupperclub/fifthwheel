---
id: run-fifthwheel-rewrite
type: run-packet
status: in-progress
date: 2026-11-13
owner: liza
related_objects: []
related_evidence: []
related_decisions: [decision-fresh-app-rewrite, decision-separate-member-admission]
expected_artifacts: [run-packet, flow, interface-direction, integration-contract, quality-strategy, threat-model, slice-report, challenge, ops-readiness, runbook]
---

# Fifth Wheel fresh rewrite — execution packet

## Outcome

Implement the full MVP in `app/` from the current [requirements](../PRD.md), [flows](../flow-ui-brief.md), [architecture](../architecture.md), and [task list](../tasks-checklist.md). Preserve the archived app’s visual styling while improving layouts, information architecture and navigation. Keep all old app source under the archive for reference only.

## Owners and sequence

| Order | Owner | Artifact or decision | Depends on |
| --- | --- | --- | --- |
| 1 | Liza | Scope, W task assignment, integration, user updates, acceptance ledger | Current requirements; user's explicit resume |
| 2 | Iris | Initial style/IA reference and six-screen checkpoint | W01.1–W01.4 |
| 3 | Finn | Fresh runtime, shared UI, all client routes/features | Style/route contracts; Relay DTOs |
| 4 | Relay | Isolated migrations, service contracts/providers/workers | Read-only provider/source inventory |
| 5 | Sentry (rotating slot) | Independent functional, privacy, recovery and browser verification | Integrated slices |
| 6 | Luke/Cipher/Harbor/Allie (rotating reviews) | Domain, security/privacy, operations and independent challenge | Relevant slice handoff |

Four active slots maximum including Liza. Finn exclusively owns package/runtime config/routes/shared UI; Relay exclusively owns schema/migrations/generated DB types and server contracts; Sentry owns independent acceptance cases. Agents request shared-file edits from the owner. No concurrent dependency installation, route generation, migration application or global reset.

## Human gates

- The user reviewed the six-screen direction and approved continuing with it, including Lucide icons, refined spacing/type/alignment, styled choice controls and clearer navigation. Keep implementation aligned with [interface direction](interface-direction.md); this approval is for visual direction, not for fictional/demo behavior or final feature acceptance.
- Resume implementation only under the user's explicit instruction (received for this run).
- Exact live email, hosted provider writes/data access, charges/refunds, deployment, publication and PR destination require separate authorization.

## Expected artifacts

- W01 interface direction and screen/state inventory.
- Relay integration contract plus current provider evidence gaps.
- Slice-specific privacy/threat model for profile and identity evidence.
- Sentry quality strategy and one acceptance ledger mapped to A01–A35.
- Finn slice reports after integrated gates.
- Allie's independent challenge at the full app gate.
- Harbor operational readiness and cutover/rollback runbook before any production action.

## W02.5 external-contract inventory (read-only source review)

This is an inventory of source-level statements and local implementation boundaries, not proof of live provider configuration. No production credentials, hosted records, or external provider endpoints were read for this table.

| Integration | Source-backed fact | External fact still unverified | Affected work |
| --- | --- | --- | --- |
| Marketing waitlist | Existing Astro form keeps its JSON contract; `PUBLIC_WAITLIST_URL` can point at a local rewrite endpoint, otherwise `src/data/site.ts` names `https://app.fifthwheel.community/api/waitlist`. The guarded W03 journey verified the form against local intake. | Whether the deployed marketing build has an override, the live endpoint currently receiving submissions, its source store, and legacy row counts/quality. | W02.5, W03, W11 |
| Supabase | Local projects are named `fifthwheel-rewrite-dev` and `fifthwheel-rewrite-test`; the test project is verified on `57421/57422` and migrated incrementally through `20261113142334`. Local app server adapters require server-only credentials and the test runner refuses linked/hosted targets. | Hosted project reference/schema, Auth settings, RLS/storage policies, backup state and current waitlist/payment data. The dev project’s latest migration history has not been rechecked. | W02.5, W02.6, W11 |
| Airtable | Current rewrite development uses an explicit synthetic fixture provider; W05 source mappings and durable operation marker are not enabled for live writes. | Base/table/field IDs, dictionary, record counts, pagination limits, venue links, marker-field semantics, credentials and live record quality. No live request was made. | W05.4, W11 |
| Email | Admission and Table invitation development adapters are loopback-only and use Mailpit; the W03 intercepted-link journey is verified. | Production sender/domain, Auth redirect allowlist, inbox event/webhook support and delivery/reconciliation API configuration. No live email was sent. | W02.5, W03, W06.5, W10, W11 |
| Stripe | The new app has no Stripe dependency or payment integration yet; W07 remains not started. | Account and mode mapping, webhook/signature configuration, historical sessions/charges/refunds and pending financial obligations. No live read or payment action was made. | W07, W11 |
| Hosting and scheduler | The fresh app has local Vite dev/preview commands and strict local ports. Marketing source constants name product/admin Render domains, which are source declarations only. | Deployed app host/version, environment/start command, scheduled-job service, webhook ingress, alert monitor, backup and rollback owner. | W02.5, W02.6, W11 |
| Legacy data and obligations | The rewrite keeps legacy data out of the local synthetic projects and does not auto-send, charge or import. | Counts and identity linkage for waitlist/users/Tables, future paid Seats, Stripe balances/refunds, attendance and unresolved obligations. | W11 |

This source review narrows unknowns and supports local work; it does not complete W02.5’s external discovery or authorize access to hosted data. Reconcile each external fact through a separately authorized, read-only inventory before migration planning; do not infer deployed configuration from source constants.

## Completion evidence

Use [acceptance-ledger.md](acceptance-ledger.md) alongside W00–W12. Evidence must be from this rewrite's routes/database/providers, not archived test summaries. A feature passes only with its real screen, durable authorized behavior, failure/recovery state and relevant checks. Local MVP completion and production release are separate decisions.
