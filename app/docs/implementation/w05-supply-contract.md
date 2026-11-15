---
id: fifthwheel-w05-supply-contract
type: integration-contract
status: w05_1_to_w05_3_local_fixture_implementation_w05_4_open
date: 2026-11-12
owner: relay
related_evidence:
  - docs/PRD.md
  - docs/tasks-checklist.md
  - docs/reference/architecture.md
  - docs/reference/objects/table.md
  - ../archives/app-2026-11-11-before-restart/src/lib/airtable.server.ts
  - ../archives/app-2026-11-11-before-restart/src/lib/events.server.ts
  - ../../src/supply.contract.ts
  - ../../src/server/supply.service.server.ts
  - ../../src/supply.management.contract.ts
  - ../../supabase/migrations/20261112200122_supply_sync_staging.sql
related_decisions: []
---

# W05 Airtable supply integration contract

Current implementation status is tracked in the [task ledger](task-ledger.md); this contract preserves its 2026-11-12 provider-boundary evidence and may contain dated implementation notes. W05.2 and W05.3 are now implemented locally, while W05.4 activity wiring and verified production Airtable mappings remain open.

**State:** W05.1/W05.2 have local fixture-backed backend foundations; W05.3 contract is frozen and backend implementation is in progress. Production Airtable mappings remain unverified. This document records the approved product boundary and the implemented local behavior; it does not assert that provider schema, credentials, current Airtable records, or a live sync has been inspected.

## Evidence boundary

### Product and architecture facts

- The PRD assigns Table and venue supply fields to Airtable and transactional/application state to Supabase. Supabase is the app read model. Airtable cannot set payment, roster, attendance, cancellation, completion, or other runtime state. See PRD R06/R10 and Architecture §§2, 3, and 7.
- The app server performs Airtable operations. Guest requests and UI code do not access Airtable directly or submit provider-specific field names as authority.
- A complete sync stages both supply collections, validates records and linked venues, then accepts a revision. Partial scans do not mark records absent. A missing record after a complete scan is a review conflict, not deletion/cancellation.
- A published snapshot remains readable through sync failure. Admin publication points at an accepted revision. After invitations exist, schedule or venue changes conflict; Tables are not rescheduled in place. Cosmetic public-title correction may be applied with audit. See Architecture §2.
- The rewrite has typed browser/server contracts, admin-authorized staged sync, private Supabase sync tables/RPCs, an explicit local-only synthetic provider, and integrated admin sync and Table-management routes. W05.2 draft/accept/publish and W05.3 weekly clone/undo are implemented against local fixture providers; no Airtable provider is configured or claimed here.

### Historical archive observations, not mappings

The archived app contains a server adapter and event builder. The adapter enumerates legacy table labels such as `Events` and `Venues` alongside guest, booking, and other operational tables; those names are not verified against a live base. The archived builder refers to labels for event title, date, start time, neighborhood, status, three stop links, host, notes, venue, venue neighborhood, venue role, and partner status. Treat these as historical field-name clues only. Do not use them as field IDs or assume their current types, values, linkage, or availability.

The archived adapter paginates with provider offsets and supports a record cap, but its completeness behavior and field mappings are not evidence of a safe current sync. It also contains generic create/update/delete operations and a configurable operation-marker field; the actual marker field is explicitly unverified in that source. Do not import its booking/payment writers into the new runtime. The current architecture requires a dedicated, verified operation marker before enabling idempotent supply writes or cloning.

No provider credentials were read or used, no Airtable request was made, and no provider field IDs or record contents are included here.

## Current W05.1 local implementation

- `GET /api/admin/supply/sync` returns provider mode, the last-good published pointer, and the latest durable run. `POST /api/admin/supply/sync` accepts only an operation UUID; the verified admin principal supplies the actor. The route is `src/routes/api/admin/supply/sync.ts`; the browser DTO is in `src/supply.contract.ts`.
- The service completes both paginated collections before normalization/staging. Transport/page failures are `incomplete`; invalid records or unresolved venue links are `conflict`; only a complete valid snapshot is staged. Sync does not set the accepted or published pointer. Operation UUID replay returns the prior run without another provider read.
- The only provider available now is synthetic, test-run scoped, and only enabled by explicit `SUPPLY_PROVIDER_MODE=fixture`, non-production `NODE_ENV`, a loopback `APP_ORIGIN`, loopback `SUPABASE_URL`, and `SUPPLY_FIXTURE_RUN_ID` (UUID or 12 lowercase hex characters). Every other configuration reports `disabled_unmapped`. No Airtable credentials are consumed.
- Migration `20261112200122_supply_sync_staging.sql` was applied incrementally to the isolated `fifthwheel-rewrite-test` project on 57421/57422. It adds private run/revision/mapping/control tables and service-only transactional RPCs. The additive migration does not reset either local database.
- W05.1 service/repository tests passed (12/12); the guarded local DB harness passed RPC grants, admin gate, replay, audit and unchanged published pointer in a rollback-only fixture transaction. The coordinator reports the integrated W05.1 browser run passed 1/1 with cookie-authenticated staged sync, refresh persistence, last-good pointer preservation, and anonymous/non-admin denial; desktop/mobile screenshots are in `implementation/screenshots/w05-admin-supply-sync-*.png`. No live Airtable schema or records were used.

## W05.2 draft/editor and publication contract

Browser-safe operation types are frozen in `src/supply.management.contract.ts`. Role-aware routes are:

- `GET /api/supply/tables?state=&cursor=&limit=` returns authorized Tables and staged candidates, plus provider state and a `mutationsEnabled` capability.
- `GET /api/supply/tables/:tableId` returns draft, accepted and published revision summaries and allowed actions for the current verified actor.
- `GET /api/supply/venues?query=` returns only server-validated venue options visible to the actor.
- `POST /api/supply/drafts` takes `{operationId,source}`. `source` is either `{kind:"candidate",revisionId,tableId}` from the safe staged-candidate list or `{kind:"manual",content}`. It returns `{tableId,draft}`.
- `PUT /api/supply/drafts/:draftId` takes `{operationId,expectedDraftRevision,content}` and creates the next draft revision with compare-and-swap semantics.
- `POST /api/supply/drafts/:draftId/preview` takes `{expectedDraftRevision}` and returns validation, Atlanta UTC conversion, and a staff-only diff without mutating state.
- `POST /api/supply/drafts/:draftId/accept` takes `{operationId,expectedDraftRevision}`. Only admins can accept a valid current draft.
- `POST /api/supply/drafts/:draftId/publish` takes `{operationId,expectedDraftRevision}`. Only admins can publish the exact accepted revision.

Every mutation uses a unique operation UUID. Replaying the same operation/request returns its stored result; reusing an operation UUID for a different actor/action/body conflicts. Stale draft revisions return `revision_conflict`; save creates a new immutable content revision and leaves accepted/published pointers unchanged. Accept updates only the accepted pointer. Publish updates only the per-Table published pointer; a failure leaves the prior pointers intact. A provider sync never publishes a revision.

Admins may list all supply, create from an imported candidate or manual draft, edit, accept and publish. Hosts may list/read and edit only Tables named by trusted server-side assignments; host assignments are loaded from a private table, and API/service/RPC checks all enforce ownership. Hosts cannot create unassigned Tables, accept or publish. Public stop notes and private `hostNotes` are separate fields; `hostNotes` appears only in admin/assigned-host management DTOs and never in member/public Table DTOs.

W05.2 create/update/accept/publish mutations are enabled only in the explicit synthetic fixture mode on a loopback non-production runtime. Airtable mappings and credentials remain unverified, so production mutations return a safe provider-unavailable result. Schedule, neighborhood, venue or stop-time edits on a Table marked as protected by active invitations/paid Seats conflict; public/host notes and title-only corrections remain separate from those critical fields. W06/W07 must set that protection marker as soon as activity begins.

## W05.3 weekly preview, clone and undo contract

Browser-safe DTOs live in `src/supply.weekly-clone.contract.ts`; provider record IDs, operation-marker values, credentials and raw provider payloads remain server-only. Weeks are Monday through Sunday in `America/New_York`. Inputs are strict `YYYY-MM-DD` date-only week starts. A target may be any other week; each clone preserves weekday/local time/itinerary and shifts `localDate` by the exact whole-week delta between source and target week starts.

Routes are admin-only and use the standard bounded JSON, exact `APP_ORIGIN`, cookie-session, private/no-store response boundary:

- `POST /api/admin/supply/weekly-clone/preview` accepts `{sourceWeekStart,targetWeekStart}` and returns provider capability, `planHash`, whole-week delta, source rows, target local dates and per-source eligibility/conflict. It is read-only and does not reserve an operation ID.
- `POST /api/admin/supply/weekly-clone` accepts `{operationId,sourceWeekStart,targetWeekStart,expectedPlanHash}`. It creates drafts only, and rejects a stale plan before any write. Only current draft revisions in the selected source week are eligible.
- `GET /api/admin/supply/weekly-clone/operations/:operationId` returns the durable, sanitized manifest and `manifestRevision`.
- `POST /api/admin/supply/weekly-clone/operations/:operationId/reconcile` reads exact operation markers and persists only verified results; it never creates or deletes provider records.
- `POST /api/admin/supply/weekly-clone/operations/:operationId/undo` accepts `{undoOperationId,expectedManifestRevision}`. Undo is a separate idempotent operation and is allowed only when every clone is unchanged and has no active invitation, paid Seat or other protected activity.

Batch states are `running`, `partial`, `outcome_unknown`, `completed`, `undoing`, `undo_unknown`, `undone`, or `undo_refused`. Per-item states distinguish pending/creating/created/failed/unknown and undoing/undone/unknown/refused. The durable manifest binds each source Table/revision/hash, target content/hash, operation marker, and any resulting provider/app IDs; only app UUIDs and safe states appear in browser DTOs. Reusing the batch operation UUID with the same canonical request replays its stored result; different actor/body conflicts. A stale preview hash returns a conflict before provider effects. Any uncertain create/delete is reconciled by the exact marker before retry; the app never guesses by title/date. A confirmed no-write may retry only with the same operation key, while a confirmed write is adopted into the manifest without creating a duplicate. A marker collision with a different source/manifest is a conflict.

Provider writes remain disabled unless actual Airtable table/field mappings and the dedicated marker field have been verified. The only implementation/test provider is the existing run-scoped synthetic fixture mode; production and unverified configurations return `provider_unavailable`. The fixture models lost responses, duplicate markers and partial batches without contacting Airtable. Supabase stores the durable operation/manifest and audit trail, while provider-side create/delete effects are never represented as successful until marker reconciliation confirms them. Undo checks the current target hash/revision and authoritative protected-activity state transactionally immediately before deletion. If a provider deletion response is lost, the state is `undo_unknown` until the same exact marker is reconciled; repeated undo cannot delete a changed or newly active Table.

Week selection uses a Monday date in Atlanta local time, not a UTC instant. Preview and clone recheck the ordered source revisions and normalized hashes under transaction/operation lock; a source edited, deleted, moved outside the source week or no longer in draft becomes an item conflict. Preview returns a deterministic hash over week bounds plus ordered source app IDs/revision IDs/content hashes. No clone modifies a source, accepted/published pointer, Table runtime lifecycle, roster, invitation, Seat, payment, attendance or cancellation state. A cloned record starts as a new draft with independent IDs and preserves private `hostNotes` only in staff/host DTOs.

W05.3 acceptance requires preview hash stale protection, duplicate same-op replay and different-body conflict, concurrent operation serialization, partial-batch recovery, duplicate-marker adoption/conflict, lost-create reconciliation, undo of unchanged inactive clones, refusal after target edit or activity, lost-delete reconciliation, and proof that source/published/runtime/financial pointers remain unchanged. Browser evidence must exercise the actual local fixture provider and refresh-persistent operation history. No Airtable mapping or write is claimed.

## Ownership and trust boundary

| Concern | Authority | Contract |
|---|---|---|
| Supply title, scheduled local date/time, neighborhood, three-stop itinerary, host-facing supply notes, draft/publication intent | Airtable, through an app server adapter | Import and staff edits produce staged/accepted supply revisions. Unknown or invalid fields remain conflicts. Private notes are never copied into guest/public DTOs. |
| Stable Table/Venue UUIDs, accepted revisions, published read snapshot and Table runtime | Supabase | Airtable record IDs map to stable internal UUIDs. Publication and runtime lifecycle are controlled by authorized app operations. |
| Applications, roster, invitations, checkout, Seats, payments/refunds, attendance, votes, roles, audit | Supabase | Never inferred, created, or changed by Airtable supply status or row deletion. |
| Airtable credentials and provider payloads | Server-only integration | Credentials never reach browser bundles, logs, error messages, screenshots, audit metadata, or client DTOs. |

Only an admin may accept/publish a supply revision. Hosts may edit or propose draft supply only within authorized scope; they cannot publish. A provider row ID, URL, or status value is not an authorization decision.

## Stable identities and canonical field mapping

1. Use one durable mapping for each source object: `(provider, entity_kind, external_record_id) → internal_uuid`, with a unique constraint on the source tuple. `entity_kind` distinguishes at least Table supply and Venue. Do not derive identity from title, date, neighborhood, email, or a linked-record display name.
2. Preserve internal UUIDs across syncs, renamed records, duplicate runs, and draft edits. Never expose Airtable record IDs as public app identifiers.
3. Normalize a provider row through a versioned allowlisted mapping into a typed candidate. Unknown provider fields are ignored or surfaced as unmapped diagnostics; they do not flow into DTOs automatically.
4. Compute a deterministic source hash over normalized, relevant supply fields and linked provider IDs. Equal source hash is a no-op for the accepted revision; a changed hash produces a candidate revision and does not by itself publish it.
5. Resolve each stop through the stable Venue mapping. An absent, ambiguous, deleted, or malformed link blocks acceptance of the affected candidate and creates a staff-visible conflict. Do not silently replace it with a similarly named venue.
6. Never auto-create a new internal Table because a title/date matches. Only a stable provider ID or a separately authorized, reconciled create operation can establish its mapping.

The actual provider table/field dictionary, types, exact linked-record shapes, select options, and source counts are **pending W02.5 provider discovery**. No field IDs are specified in this artifact.

## Staged synchronization and revision states

One sync run covers the configured Table and Venue collections as a consistent candidate set:

1. Create a durable run ID and record its start time, provider/environment label, mapping version, pages read, records staged, validation counts, and safe errors. Never store credentials or full private provider payloads in run logs.
2. Read every page for both collections using the provider continuation token. Enforce configured page/record/time bounds. A transport error, invalid response, repeated cursor, cap hit, or incomplete collection makes the run `incomplete`; no record is inferred absent and no accepted or published pointer moves.
3. Stage raw response references only as needed for bounded diagnostics; normalize the allowlisted fields into typed Table/Venue candidates. Validate row identity, required logical fields, date/time, all three stop links, uniqueness, and cross-record references before acceptance.
4. Commit the complete validated staged revision atomically in Supabase. Keep validation failures and linked-record conflicts addressable to staff. A failed candidate does not partially overwrite the prior accepted supply or published snapshot.
5. Admin preview names the exact candidate revision/hash and its differences. Admin acceptance records actor, timestamp, revision, mapping version, and validation result. A revision can be accepted without publishing; guests continue to receive the current published snapshot.
6. Admin publication atomically points the Table’s public/read-model pointer at an accepted revision. Persist `published_at`, revision/hash, and audit outcome. No guest query reads a mutable staging row or Airtable directly.

These states are distinct:

- **Staged:** both collections were completely read and validated, and an immutable candidate was committed. A staged revision is not accepted or published.
- **Accepted:** a complete, validated, immutable normalized revision is available to staff.
- **Published:** an admin-selected accepted revision is the current guest/read-model snapshot.
- **Last-good published:** the last successfully published snapshot, retained unchanged through later partial/failed syncs, invalid candidates, provider outage, or upstream deletion conflict.
- **Conflict:** a required mapping/reference is missing, a candidate is invalid, a protected post-invitation field changed, or a completed scan no longer contains a mapped source record. Conflict blocks the affected new acceptance/publication as appropriate but does not erase the last-good snapshot or alter runtime state.

Absence is meaningful only after a complete scan of both required collections. An upstream deletion marks the mapped record `upstream_missing` for admin review. It does not delete the Supabase UUID/mapping, unpublish a paid Table, cancel a Table, revoke invitations, or rewrite the roster.

## Calendar and itinerary semantics

- Parse source dates only as real ISO calendar dates (`YYYY-MM-DD`) and local times only in the agreed strict 24-hour `HH:mm` form. Do not parse locale-formatted strings or append a server-local timezone.
- Interpret the schedule in the IANA zone `America/New_York` (Atlanta). Convert the selected local date/time to a UTC instant for storage and comparisons, while retaining the local date, local time, and zone for display/editing. UTC is authoritative for cutoffs and elapsed-time rules.
- Reject impossible dates/times, DST-gap times that do not exist, and DST-fold times that map to two instants. Return a field-level correction error; never guess which offset the provider or operator intended. The sync must not move the instant because the worker/server timezone differs.
- A publishable Table has exactly three ordered stops: **drinks → dinner → dessert**. Each stop resolves to one internal Venue UUID and a validated public name/address snapshot, order, start offset, and public notes. Reusing a venue for dinner and dessert is allowed by Architecture §2. Stop timing defaults are relative to Table start at `0`, `+45 minutes`, and `+120 minutes`; retain the configured offset explicitly rather than deriving it later from a venue label.
- Every referenced Venue must resolve to an accepted, usable Venue candidate. Missing venue/address, invalid order, duplicate/missing stop, malformed local time, or unsupported field mapping blocks publication and explains the affected source row without exposing credentials or dumping provider payloads.

The source’s actual date/time field types, locale, linked-record cardinality, venue address field, notes classification, stop-offset fields, and whether the defaults are already represented upstream remain pending provider-field decisions. The logical requirements above are the local contract; the adapter mapping must be reviewed against a redacted field/type dictionary before implementation is enabled.

## Provider failure, retry, and reconciliation

- Read retries are bounded and safe. A failure on any page means `incomplete`, retains the prior accepted/published data, and is visible with a correlation/run ID and last-success time. Do not advance watermarks or apply partial rows.
- Apply a timeout and response-size/page-count bounds. Treat malformed JSON, an unexpected response shape, rate-limit exhaustion, authentication failure, and linked-record mismatch as distinct safe operational categories; redact provider body and secrets.
- Do not retry non-idempotent provider writes blindly. A write whose response is lost becomes `outcome_unknown`; block another create/update/delete until an operator or worker reconciles by the exact operation UUID and provider record identity.
- Supply writes and weekly clone use a durable operation UUID plus a dedicated, verified Airtable marker field. The stored manifest binds the operation UUID, source/target record IDs, expected before/after source hashes, intended action, and resulting provider IDs. Duplicate operation UUID with the same manifest returns the prior result. Reuse with a different manifest conflicts.
- If the marker field cannot be verified or read back, disable Airtable create/clone writes. Do not fall back to title/date matching. After reconciliation confirms no provider write occurred, a retry may reuse the same operation UUID; if it confirms a write occurred, adopt the mapped result without creating a duplicate. If still uncertain, keep the visible `outcome_unknown` state.
- Provider outage never turns an unaccepted draft into a published Table. Staff can continue reviewing the last-good snapshot and other local operations; any action that needs fresh supply or writes Airtable remains unavailable with an honest retry/reconcile path.

## Supply/runtime separation and revision conflicts

The Airtable field representing publication intent must map only to a controlled supply-intent state after its actual value set is verified. It must never map directly to Supabase Table runtime values such as `cancelled`, `completed`, `proceeding`, paid/seat counts, roster status, check-in, or payment/refund state.

Before an invitation exists, an admin may review and publish an accepted schedule/venue revision. Once a Table has any invitation or paid Seat, a source change to scheduled date/time, zone, neighborhood, or any itinerary venue/link/timing is a `protected_supply_change` conflict. Preserve the published runtime snapshot; do not reschedule in place. The admin resolves this through the documented cancellation/new-Table workflow. A public-title-only correction may update through an audited cosmetic path if the Table’s identity and schedule remain unchanged. Whether additional fields qualify as cosmetic is a pending domain decision; default unknown changes to conflict.

Roster approval captures the accepted `supply_revision` and relevant profile/rule revisions. At every later authority boundary, consumers compare those captured revisions to current Supabase state. An Airtable refresh cannot rewrite an approved roster, send invitations, reserve capacity, create a Seat, change price/payment, change attendance eligibility, or cancel/complete a Table.

## Pending provider and mapping decisions

Do not fill these from the archive or guess. W02.5/provider discovery must resolve them in a redacted mapping manifest before provider-backed implementation:

1. Which Airtable base/environment and exact Table/Venue sources are the intended dev/test/prod supply sources? What record counts and pagination limits exist in each?
2. What are the field names, types, requiredness, select values, formulas/lookup fields, and linked-record cardinalities for Table title, date, start time, neighborhood, publication intent, three itinerary stops, Venue name/address, public notes, private/host notes, and operation marker? Which are read-only/calculated?
3. Are local schedule date and time separate fields? Is any offset/time zone stored? How are DST-sensitive values entered and reviewed? Confirm the actual source locale and whether any field embeds a UTC offset.
4. What source values mean draft, ready-for-review, or publication intent? Which status transitions can the app write? Confirm explicitly that none encode runtime cancellation/completion/payment.
5. Do linked venue fields return stable record IDs in every environment? Are missing/deactivated Venues expected? How are address changes handled for an already-published/active Table?
6. Does the dedicated operation marker field exist? If not, who will create and verify it, with what exact field name/type and uniqueness behavior? The field name remains unset here.
7. Which users/roles may edit source fields, and does the app adapter need to write Airtable or stage a local draft before writing? Architecture says server-mediated writes; the exact write workflow and admin/host field restrictions need a reviewed mapping.
8. What provider rate limits, retry headers, maximum page sizes, and availability/timeout behavior should the bounded adapter target? These values must be documented from provider/environment evidence, not copied from archived code.

Until those decisions are verified, the app may develop against synthetic typed fixtures, but must not claim an Airtable mapping, expose provider setup as complete, or enable provider writes.

## W05 acceptance evidence

### W05.1 — staged sync

Use the isolated local test project and intercepted/mocked provider responses first; no live Airtable reads or writes are needed for contract tests. Record run IDs, fixture hashes, migration version, and exact commands without provider payloads or secrets.

- Two-page Table and Venue scans fully paginate and produce the same stable internal UUID mappings when replayed; same normalized hash is a no-op.
- Duplicate source IDs, duplicate mapping candidates, malformed rows, unknown mapped values, missing/ambiguous Venue links, and a Table with fewer or more than three stops yield actionable conflict DTOs and no partial pointer changes.
- Valid date/time converts to the expected UTC instant under `America/New_York`; impossible date, invalid time, spring-forward gap, and fall-back ambiguity reject without changing accepted/published snapshots.
- Failure on the second Table page or either Venue page, a repeated cursor, cap hit, malformed provider response, timeout, rate-limit exhaustion, or provider auth failure leaves the full last-good published snapshot and watermark unchanged. A subsequent complete run recovers without duplicates.
- A mapped record absent from an incomplete scan remains unchanged. Absence from a successful complete scan creates `upstream_missing`, retains its mapping and published/runtime record, and cannot auto-cancel/delete it.
- Provider write response loss produces one durable `outcome_unknown`; duplicate request/retry reconciles by operation UUID before issuing another write. Operation UUID reuse with different intent conflicts.

### W05.4 — supply/runtime boundary

- Change Airtable publication intent/status to every verified source option and assert that only mapped supply intent changes; paid count, roster, invitations, checkout, Seats, payment/refunds, attendance, and runtime cancellation/completion are byte-for-byte unchanged.
- After an invitation/paid Seat, change source date, time, neighborhood, venue, or stop timing. Assert a staff-visible conflict, unchanged published snapshot/runtime revision, and no in-place reschedule, uninvite, or cancellation. Admin resolves through cancellation plus a new Table workflow.
- Apply a permitted cosmetic title correction and verify its audited revision; verify unknown fields default to conflict until approved mapping/domain rules exist.
- Prove host draft/proposal scope cannot accept or publish, and guest reads return only the last-good published snapshot. Direct API/RPC attempts cannot bypass these boundaries.
- Re-run each provider operation with duplicate IDs/operation UUIDs, reordered/partial pages, and lost responses. Assert no duplicate mapping, Table, invitation, Seat, or runtime lifecycle change.

No W05 acceptance evidence is claimed by this contract. A successful test requires integrated DB/provider-fixture and browser evidence for the implemented routes and actions, not only a pure mapper test. Attach the redacted field dictionary and final provider mapping decision to the W05 slice report after review.
