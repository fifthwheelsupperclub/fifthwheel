---
id: fifthwheel-w05-supply-sync-slice
type: slice-report
status: in-progress
date: 2026-11-12
owner: liza
related_objects: [object-table, object-venue]
related_evidence: [../PRD.md, ../tasks-checklist.md, acceptance-ledger.md, w05-supply-contract.md, interface-direction.md]
related_decisions: []
---

# W05.1 staged supply sync — local slice report

## Outcome

The first W05.1 admin sync journey works in the fresh rewrite against the isolated local test stack:

1. An authorized admin opens `/admin/tables` and sees provider readiness, the last-good published snapshot and the latest sync state.
2. The admin runs a per-run synthetic provider sync through `POST /api/admin/supply/sync`.
3. A complete local snapshot creates a durable `staged` candidate with one Table and two Venues. It is explicitly not accepted or published.
4. Refreshing the page reads the persisted run, while the last-good pointer remains unchanged.
5. Anonymous and authenticated non-admin API requests are denied.

This is a working local supply milestone, not complete W05 acceptance or Airtable readiness. Draft editing, acceptance and publication have working local evidence in W05.2. W05.3 weekly clone/undo has passed its local browser and rollback-only database acceptance, including partial writes, marker conflicts and uncertain create/delete recovery. W05.4 supply/runtime boundaries and verified Airtable mappings remain outstanding.

## Routes and ownership

| Route | Behavior exercised |
|---|---|
| `/admin/tables` | Branded admin supply workspace; provider, latest run, counts, last-good snapshot, staged-vs-published distinction and retry/error/conflict states |
| `GET /api/admin/supply/sync` | Cookie-authenticated authorized admin reads durable latest run and last-good pointer |
| `POST /api/admin/supply/sync` | Exact-Origin, bounded JSON, cookie-authenticated authorized admin starts an idempotent staged sync |

The Tables link is available from the existing admin waitlist and identity-review workspaces. Other unfinished admin sections remain non-interactive.

## Persistence and provider boundary

- Added `20261112200122_supply_sync_staging.sql` to the isolated local test project without resetting it. It defines private sync-run, immutable staged revision, source-mapping and supply-pointer tables plus service-role-only begin/finish/read RPCs.
- Sync uses a durable operation ID and one audit record for its first start. Replay does not repeat the provider scan. Complete scans may stage a candidate; incomplete/invalid scans preserve accepted and published pointers.
- Last-good published supply is a separate pointer. W05.1 has no accept or publish operation.
- Airtable provider mode remains disabled because no real Airtable field dictionary, IDs, credentials or base mapping have been verified. A synthetic provider requires explicit run ID, loopback app/Supabase URLs and a non-production runtime; each run uses namespaced source identifiers and visibly labels itself synthetic.
- Public DTOs omit provider source IDs, credentials, raw provider payloads and raw database errors. RLS and direct-table grants deny anon/authenticated access.

## Verification evidence

- `pnpm test` — 148/148 passed, including W05 service pagination/replay, partial-page handling, stable mappings, missing venue and unmapped intent conflicts, role gates, DST gap/fold checks and fixture-mode gating.
- `pnpm typecheck` — passed after the W05 service and route additions.
- `pnpm build` — passed after the final bounded-body route edit with `/admin/tables` and `/api/admin/supply/sync` route bundles.
- `node scripts/test-supply-sync.mjs` — passed against `fifthwheel-rewrite-test`, verifying migration/RPC grants, admin gate, operation replay, audit start/finish and unchanged published pointer. Its SQL fixture transaction rolled back.
- `node scripts/run-w05-browser.mjs` — passed 1/1 against the local app `127.0.0.1:8086` and `fifthwheel-rewrite-test` API/database `127.0.0.1:57421/57422`. The actual browser staged one Table/two Venues, refreshed and verified persistence, confirmed the published pointer stayed unchanged, and verified anonymous/non-admin denials. Exact test Auth users, role, run, revision, mappings and staged pointer were cleaned; append-only PII-free audit events remain.
- Screenshots from the integrated route: [desktop](screenshots/w05-admin-supply-sync-desktop.png) and [390px phone](screenshots/w05-admin-supply-sync-390px.png).
- `git diff --check` — passed at the latest root verification.

## Known limits and next work

- Provider field names, types, source options, IDs, base/table identity, credentials, rate limits and live record quality remain unverified. No Airtable request was made.
- Complete provider-specific failure matrix remains open: repeated cursor, cap, malformed response, timeout/rate limit, duplicate source IDs, invalid schedule/stops, missing/ambiguous venue, upstream deletion after a complete scan, and recovery while preserving a prior published snapshot.
- W05.2 admin Table list/detail/draft editor, accepted revisions and publication now have local DB/browser evidence.
- W05.3 preview, durable operation history, idempotent clone, marker recovery, draft-only result and safe undo now work through the integrated admin route. The accepted browser/database evidence covers multi-item partial batches, duplicate provider markers, lost browser/provider create responses, both uncertain delete outcomes, same-operation undo binding, source edits during provider work, protected activity and exact rollback. A literal provider-process restart exercise remains open; database-backed marker reconciliation is verified.
- W05.4 must prove protected post-invitation schedule/venue conflict and the supply/runtime boundary.
- No host draft/proposal workflow, guest published-Table browse or production provider configuration is claimed by this slice.

## W05.2 — Admin Table list, detail and publication

### Outcome

The fresh app now has working admin supply list/detail routes and durable draft management. From `/admin/tables`, an admin can inspect staged candidates and existing records, start candidate review, edit a draft, preview its server-validated revision, accept it, and publish it. Published guest-visible and accepted snapshots are shown separately from a subsequent private draft. Staff-only host notes remain in the protected management DTO; public itinerary notes remain distinct.

Routes are `/admin/tables`, `/admin/tables/$tableId`, and the eight bounded `/api/supply/*` operations (table list, detail, venues, draft create/update/preview/accept/publish). Admin may create, accept and publish. An assigned host can read and edit only assigned draft records and cannot accept or publish. Member, anonymous and unassigned roles are denied.

### Fix discovered during integrated verification

The initial candidate-create request matched the listed staged candidate IDs, but SQLSTATE 42883 arose while projecting venue JSON because the lateral alias was a record (`vn`) and the code tried `vn->>'name'`. This was initially mapped to a misleading HTTP 404. Additive migration `20261112211128_supply_candidate_venue_projection_fix.sql` now reads `vn.value->>'name'` and `vn.value->>'address'`. The repository now maps only the precise database `not_found` signal to domain not-found; unknown REST errors remain safe service failures.

### Verification

- `node scripts/test-supply-sync.mjs` — passes against verified `fifthwheel-rewrite-test`, with exact run-scoped rollback fixtures. The populated baseline includes a non-null last-good marker and a previously published Table. Incomplete/invalid scans do not infer absence; complete omission records a safe conflict, changes only `sync_state`, preserves lifecycle, source/revision/published pointers and mapping rows, and blocks accept/publish without consuming operation IDs. Reappearance clears only the sync flag and records resolution. The exact residual-row check passes after rollback.
- `node --experimental-strip-types --test src/server/supply.service.server.test.ts` — 12/12 passed, including malformed Table/Venue page envelopes and Venue-page failure followed by successful recovery with a fresh operation ID.
- `node scripts/test-supply-management.mjs` — passes against `fifthwheel-rewrite-test`, with rollback-only synthetic fixtures. Covers candidate/manual create and replay, update, preview, accept/publish, grants, admin/host/member boundaries, stale conflict, pointer protection, host-scoped venues and audit. Audit count stayed 218 after rollback.
- `node scripts/run-w05-browser.mjs` — latest combined run passes 2/2 against local app `127.0.0.1:8086` and isolated local Supabase. W05.1 confirms sync persistence/last-good pointer and denials. W05.2 confirms candidate creation, public/private field save, refresh persistence, server-side 422 validation and unchanged revision on failure, preview, accept, publish, phone reflow and access denials. A simulated dropped PUT shows the unknown-result message; retry reuses the same operation UUID, and a fresh read confirms exactly one new revision. Labeled response fault injections verify disabled-provider behavior and missing-source list/detail warnings while retaining the actual published row and disabling accept/publish. These verify presentation only; DB evidence proves the real missing transition. Exact synthetic users/role/run/draft/revisions/operations/mappings were removed; append-only audit events remain.
- The guarded management database harness passes candidate/manual create and replay, update, preview, accept/publish, grants and role boundaries, stale conflict, pointer protection, host-scoped venues and audit. Audit count remained 257 after rollback. The guarded sync harness passes the complete/malformed scan and missing/reappearance/pointer invariants. Applied migrations through `20261112215610_supply_list_capability_envelope.sql` without database reset.
- `pnpm test` — 163/163 passed on the latest full unit/server run.
- `pnpm typecheck`, `pnpm build`, browser-runner syntax and `git diff --check` — pass after the final UI change.

Screenshots are from the integrated local app: [Table list desktop](screenshots/w05-admin-tables-list-desktop.png), [Table list phone](screenshots/w05-admin-tables-list-390px.png), [draft desktop](screenshots/w05-admin-table-detail-draft-desktop.png), [draft phone](screenshots/w05-admin-table-detail-draft-390px.png), [uncertain-save recovery desktop](screenshots/w05-admin-table-detail-save-uncertain-desktop.png), [disabled-provider UI fault injection phone](screenshots/w05-admin-tables-disabled-unmapped-response-fault-injection-390px.png), [missing-source UI fault injection phone](screenshots/w05-admin-table-source-missing-ui-injection-390px.png), and [published phone](screenshots/w05-admin-table-detail-published-390px.png).

## W05.3 — Weekly preview, clone and guarded undo

### Outcome

`/admin/tables/weekly-clone` now presents a Monday–Sunday Atlanta calendar preview, eligible/conflicting draft items, explicit clone confirmation, persistent operation history, recovery/reconciliation, and separately confirmed safe undo. The route is linked from the admin Tables workspace. The implementation uses the approved visual system (Fraunces/Inter, brown/ivory/gold, warm borders, Lucide) and refines the layout for phone widths. Anonymous and non-admin callers are rejected by the API; production provider mode remains disabled until Airtable identifiers and marker semantics are verified.

### Persistence and recovery

- Additive migrations from `20261112220943_weekly_clone_operations.sql` through `20261113042200_weekly_clone_present_retry.sql` add the durable operation/item manifest, idempotency hashes, marker-based synthetic provider evidence, captured-source completion and all-or-nothing undo guard. They are applied only to isolated local `fifthwheel-rewrite-test`, without a reset.
- A clone shifts each local date by the exact whole-week delta and creates only a private draft. It does not alter source heads or published pointers, or copy invitations, Seats, payment/attendance records.
- Unknown provider create/delete results remain visible and require exact marker reconciliation before retry. The local fixture provider is stored durably in the isolated database and calls only its loopback API.
- Browser DTOs omit marker IDs and provider record IDs. Privileged operations use the server-only service credential; RLS and function grants deny direct anonymous/authenticated access.
- The first DB acceptance exposed an FK ordering bug on undo: the revision could not be deleted while its head referenced it. The additive fix clears only the undo-owned draft pointer and marker before deleting that revision; the trigger continues to block acceptance, publication, schedule changes and activity while undo is in progress.

### Verification evidence

- `node scripts/test-weekly-clone-db.mjs` — passed against the isolated local test DB. Its rollback-only transaction proves Monday–Sunday preview/date shifting, unauthorized role denial, service-only grants, same-operation replay and cursor history, partial batches, duplicate-marker conflict, draft-only clone/source preservation, uncertain create/delete reconciliation with both marker outcomes, undo operation/request binding, activity/changed-record refusal, source snapshot completion after a concurrent edit, and exact fixture/audit rollback.
- `node scripts/run-w05-browser.mjs` — 3/3 passed (W05.1 sync, W05.2 management, W05.3 admin weekly preview/clone/reload/undo). Browser coverage includes anon/member API denials, 390px no-horizontal-overflow, and recovery after the server committed a clone while the browser response was dropped and session storage cleared.
- `pnpm test` — 172/172; `pnpm typecheck`, `pnpm build` and `git diff --check` — passed.
- Screenshots from the integrated app: [preview desktop](screenshots/w05-weekly-clone-preview-desktop.png), [preview 390px](screenshots/w05-weekly-clone-preview-390px.png), [clone complete](screenshots/w05-weekly-clone-complete-desktop.png), [undo complete](screenshots/w05-weekly-clone-undone-desktop.png).

### Remaining evidence and scope

W05.3 is accepted against the isolated local synthetic provider. It does not establish Airtable readiness. W05.4 actual invitation/Seat-to-runtime protection and live Airtable fields, IDs, credentials, marker-field semantics and mappings remain unverified. The missing-source and disabled-provider UI states elsewhere in W05 use explicitly labeled response fault injections; they do not claim an external provider is configured. No live Airtable request was made.

## W05.4 — Supply and runtime boundary (partial)

The existing management database functions classify date, start time, neighborhood, venue identity and stop offsets as critical changes. With `protected_by_activity` enabled, updating a protected published Table's draft rejects a schedule change and a venue change with `protected_change`, does not consume either operation ID, and preserves draft/accepted/published pointers. A cosmetic title correction succeeds and emits the ordinary `supply.draft.updated` audit event. `node scripts/test-supply-management.mjs` now exercises these cases inside its guarded transaction and verifies exact rollback.

This is partial W05.4 evidence only: the harness sets the activity latch directly. W06 now provides the Table invitation relation, but the W07 paid Seat schema and the integration that derives `protected_by_activity` from actual invitation/Seat state remain open. Add tests that real invitations and paid Seats survive supply updates unchanged. Missing-source handling already changes only `sync_state` and records missing/resolved audit events; the existing rollback-only sync harness verifies lifecycle, pointers, mappings and last-good snapshot preservation. Airtable remains synthetic-only.

## Next checkpoint

W05.3 edge-case recovery passed. W05.4 activity-latch behavior now has rollback-only evidence. Table invitations now exist in W06; true invitation/Seat-derived protection remains deferred until W06/W07 integrate the existing invitation relation and add paid Seats. W05 overall remains open until that relationship is implemented and verified; live provider mappings remain unverified and disabled.
