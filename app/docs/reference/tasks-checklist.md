# Fifthwheel MVP — Development Backlog and Acceptance Checklist

Version 2 · 2026-11-11 · Implement in dependency order. Product decisions D01–D13 are recorded in [PRD](PRD.md); technical defaults/contracts in [Architecture](architecture.md); route and state behavior in [Flow/UI](flow-ui-brief.md). This is the development hand-off, not a record of completed application work.

## 1. Start conditions and sequencing

B01 is ready for local development and read-only provider discovery. B02–B06 can start when their listed foundations and upstream contracts pass. B07 is required before production payment/launch. No unresolved external configuration may be replaced by guessed credentials, schemas or imported facts. No application code, migrations, live accounts, deployments or data have been changed to author this packet.

Named hats identify responsibility, not claims that a human or agent has accepted an assignment: Finn engineering, Luke domain contracts, Relay integration, Cipher permissions/privacy, Charlie/Iris experience, Sentry acceptance, Harbor cutover, admin operational queues. Aaron/release owner supplies external access and exact live-action authorization at cutover. [Review disposition](review-disposition.md) records independent assessment and evidence debt.

### B01 — Transactional foundation, identity mapping and supply synchronization

Owner: Finn/Relay, with Luke/Cipher review. Requirements R01/R03/R04/R09/R10. No upstream task dependency. Guest-facing switch stays disabled.

| Task | Actor/permission and state change | Failure/recovery | Observable completion |
| --- | --- | --- | --- |
| B01.1 — Inventory source/provider contracts | Developer read-only; redacted field/type dictionary, page counts, live/test mapping, existing RLS/storage/role assignments and deployment scheduler inventory | Missing access becomes evidence debt, not invented schema | Complete manifest lists known and unavailable facts; no credentials or guest exports in repo. A23/A24 fixtures defined. |
| B01.2 — Core schema and migrations | Trusted migrations; implement Architecture §3 with grants/RLS/private RPCs, row locks and uniqueness; generate updated Supabase types | Reapply/rebuild disposable DB; no rewriting existing migration history | Reset migration replay passes; owner/other-user/host/restaurant/anon/service matrix denies unauthorized access, including raw Data API/RPC. A03/A09/A14/A19/A22. |
| B01.3 — Auth identity and legacy mapping | Service migration + verified guest claim; durable external→UUID maps and quarantine | Duplicate/conflicting email/DOB/payment rows cannot auto-merge; manual reconciliation queue | Same import/claim twice preserves IDs and balances; name/phone alone cannot claim account. A01/A24. |
| B01.4 — Supply sync and staff supply writes | Admin publishes; host edits/proposes draft supply; staged Airtable read → accepted Supabase revision | Incomplete scan/unknown create outcome keeps last-good snapshot and unresolved operation; reconcile by operation UUID | Failed page, missing linked venue, malformed time, same hash replay, upstream deletion and post-invitation edits pass A23. |
| B01.5 — Workers and verification harness | Internal worker auth only; durable inbox/outbox/jobs, leases/dedupe and heartbeat | Unknown provider outcome retained; independent monitor notices missed worker | Pinned Vitest/Playwright/local Supabase harness and fixtures; crashed worker resumes without duplicate domain action. A22. |

**Gate:** transactional schema, role policies, stable mappings, staged sync and test harness demonstrably work locally. Actual hosted schema/configuration remains a cutover gate if unavailable. Build new features against Supabase contracts; no new Airtable core writers.

### B02 — Authentication, profiles, private uploads and identity review

Owner: Finn with Charlie/Iris/Cipher review. Depends B01.2/B01.3/B01.5. Requirements R01/R02/R09/R11.

| Task | Actor/permission and state change | Failure/recovery | Observable completion |
| --- | --- | --- | --- |
| B02.1 — Route shells and verified sign-in | Guest owns account; explicit guest/staff/restaurant shells, safe internal return | Used/expired magic link → fresh link; unknown role → no access | Direct route, refresh, back/forward and shared Table continuation; no screen-index bypass. A01/A04/A25. |
| B02.2 — Profile and private upload | Verified owner; draft→submitted; normalized images with private owner paths; DOB/ranges validation | Partial upload retained as draft or cleaned; invalid file never reviewed | Boundary birthdays, range validation, required photo/selfie, no HEIC claim, anonymous/other-user deny. A02/A03. |
| B02.3 — Staff review and profile revisions | Admin approves/resubmits current profile version; critical edits reset review and invalidate offers | Stale review conflicts; saved guest copy explains correction | Review+31d approved-version checkout remains allowed after evidence purge; critical edit requires fresh evidence. Review persists across devices, no synthetic queue; host/restaurant cannot read identity images. A02/A03/A06. |
| B02.4 — App waitlist and guest requests shell | Visitor intake email; verified same-email claim; honest waitlist state | Duplicate intake reuses record; incomplete signup not a curated Guest | Signup never grants Seat/profile approval; core app intake changes only, marketing site excluded. A05/A08. |

**Gate:** guest identity is durable and photo-review permissions pass; staff/partner workspaces expose only authorized navigation and server data.

### B03 — Published Tables, requests, composition approval and invitations

Owner: Finn/Luke with Charlie/Iris/Relay review. Depends B01 sync/workers and B02. Requirements R02/R03/R06/R09/R11.

| Task | Actor/permission and state change | Failure/recovery | Observable completion |
| --- | --- | --- | --- |
| B03.1 — Browse/detail/share/request | Approved guest requests/withdraws; public minimal share preview only | Last-good supply/error; safe return after onboarding; duplicate request reuses row | Filters and route state survive navigation; full Table accepts waiting requests without Pay promise. A04/A05/A08/A25. |
| B03.2 — Rules and recommendation | Staff sees actual eligible applicants; deterministic order then rule validation | Missing DOB/preferences excluded with reason; no inferred values or fake temperament | 21st birthday, 12/13-year span, asymmetric age ranges, mutual-open coverage, groups of 2/3/4/5/6 and profile change fixtures pass. Include every identity with Women/Men/Everyone, non-binary mutual coverage, blank/unsupported values, source-string normalization and API rejection of arbitrary preference combinations per D13. A06. |
| B03.3 — Approve roster/send offer | Admin approves current 3–5 version; host proposes only; transaction commits invitation/outbox | Stale/invalid approval commits no sends; repeated action reuses result | ≤5 active roster members, no Pay before named offer, sent time after actual send; replay passes A06/A07/A22. |
| B03.4 — T−48 follow-up and offer account view | Worker alerts admin; guest sees own open offers | Late worker backfills; no invitation expiry or auto-seat | Unpaid list consistent with payment state; timed checkout expiry never expires offer. A07. |

**Gate:** no guest can obtain payment authority by sharing URL, manipulating IDs or calling invite APIs. Approved rules and profiles are versioned and enforced server-side.

### B04 — Transactional checkout, My Seats, cancellation and refunds

Owner: Finn/Relay with Cipher/Sentry review. Depends B01–B03. Requirements R04/R05/R09/R10/R11.

| Task | Actor/permission and state change | Failure/recovery | Observable completion |
| --- | --- | --- | --- |
| B04.1 — Hold and Stripe session | Named invitation owner; Table lock→30m attempt→server-configured $25 card session | Stripe timeout reused operation; abandon/expiry releases only unpaid allocation | Last-slot concurrency, repeat checkout, caller price/env/identity forgery, stale roster and expired hold pass A09/A10. |
| B04.2 — Unified fulfillment/inbox | Signed provider event or owner return verification; payment→Seat or refund obligation | Durable retry on DB error; late payment safely allocates/refunds | Parallel webhook/return, duplicate/out-of-order events, wrong amount/mode, delayed paid after revoke/cancel, email failure pass A09–A12/A15. |
| B04.3 — My Seats, calendar and receipts | Owner reads own payment/Seat/refund states | Pending/reconcile states never prompt blind repayment; safe support route | Current/past Seat lists no legacy name/email impersonation; pending vs confirmed/refund states match server. A10/A12/A14/A25. |
| B04.4 — Cancellation review | Owner requests; admin denies or removes and records refund cents/reason | Request retains capacity; removal succeeds with durable money obligation when Stripe fails | Repeat review, denial, zero/full/partial refund, concurrent refund and failed settlement pass A13/A14. Include submitted-but-unsettled partial refund followed by full Table cancellation and delayed first settlement; settled plus all reserved/owed allocations never exceed paid. |
| B04.5 — Full Table cancellation | Admin cancels under Table lock; close offers/holds and cancel Seats; full remaining balance owed | Continue durable money recovery after partial provider failure | Replayed cancellation plus concurrent paid webhook cannot oversell/overrefund/drop charge. A11/A15. |

**Gate:** sandbox money/concurrency/recovery scenarios pass with ledger assertions. No public paid rollout; a human-authorized live dry-run belongs to B07.

### B05 — Attendance, low-fill decisions, replacements and restaurant views

Owner: Finn with Luke/Cipher/Harbor review. Depends B03/B04. Requirements R06/R07/R09/R11.

| Task | Actor/permission and state change | Failure/recovery | Observable completion |
| --- | --- | --- | --- |
| B05.1 — T−24 operational decision | Worker persistent alert; admin proceed/cancel; runtime request gate pauses checkout until decision | Scheduler failure cannot bypass cutoff; invalid paid subset requires review/cancel | Below-three cannot proceed; valid 3–5 may; later removal suspends invalid proceeding. A16. |
| B05.2 — Removal/replacement | Admin chooses Yes/No on one eligible suggestion; lock→remove/revalidate/new offer | Original removal persists if suggestion stale; no unsafe invite; money follows B04 | No candidate, incomplete signup, profile revision race, 3-person removal, Yes/No and double-click pass A17. |
| B05.3 — Host attendance | Admin/assigned host checks in paid guest | Wrong Table/role denied; late check-in not ballot eligible | Persisted attendance and timestamps; no guest self-toggle can add eligibility. Pending-cancellation guest checked in before open remains eligible even if request is denied afterward. A13/A18/A19. |
| B05.4 — Restaurant scope | Assigned venue member gets service DTO | No assignment → empty/no-access; revoked membership immediate deny | Same role/wrong venue denied via direct API; no guest/DOB/photo/payment/ballot/report fields. A18/A22. |

**Gate:** operational Table validity and attendance are authoritative before private voting is enabled.

### B06 — Persisted voting, own mutual reveal, ratings and conduct

Owner: Finn with Luke/Cipher/Charlie/Iris review. Depends B01 private schema and B04/B05. Requirements R07/R08/R11.

| Task | Actor/permission and state change | Failure/recovery | Observable completion |
| --- | --- | --- | --- |
| B06.1 — Eligibility snapshot and ballot | Server freezes paid checked-in eligible set at open; owner submits one other guest/null | Lazy snapshot matches on-time worker; late choice rejected; changed replay conflicts | 89:59/90:00/119:59/120:00, DST-converted start, late arrival, +45m/+60m check-in with on-time versus delayed snapshot, pending cancellation, removal, wrong Table, Nobody and duplicate choice pass A19. No materialization before start+90m. |
| B06.2 — Own mutual reveal | Owner after close gets first name or null | No submission/one-way/Nobody same empty result; retention expiry unavailable | Mutual pair visible only to involved active guests, no global pair list or staff ballot route. Idempotent close finalization stores private results before ballot purge; day-31 reveal, day-90 expiry, post-purge removal/account deletion and interrupted finalization pass A20. |
| B06.3 — Rating and report | Attended owner upserts rating or submits separate private report; admin triages | Validation preserves text; receipt on retry uses operation ID | Per-stop bounds, report unauthorized read, aggregate <3 suppression and audit redaction pass A21. |
| B06.4 — Remove prototype night flows | Production routes use persisted truth; retire sample PEOPLE, outcome/chat/ballot selectors | Development fixtures isolated from production mutations | No chat/contact exchange, fake attendance/review/vote or demo production checkout remains. A19–A21/A25. |

**Gate:** direct DB/API adversarial reads cannot retrieve others' ballots, reports or results. Functional privacy checks are mandatory, not just visual inspection.

### B07 — Operator completeness, reconciliation, cutover and release

Owner: Finn/Relay/Harbor with Sentry/Cipher review; human release owner authorizes live actions. Depends B01–B06. Requirements R09/R10/R11.

| Task | Actor/permission and state change | Failure/recovery | Observable completion |
| --- | --- | --- | --- |
| B07.1 — Supply builder/clone/undo | Admin publishes; host drafts; versioned sync, operation-ID clone manifest | Unknown Airtable create reconciles before retry; undo only unchanged draft clones with no invites/Seats | Preview field merge, duplicates, partial batch and safe undo verified; active Table schedule changes conflict. A23. |
| B07.2 — Communications/audit/report/delivery | Admin recipients/template preview/send/retry; report separate restricted triage | Delivery retry never repeats payment/approval; report text excluded from general log/search | Permissions and recipient authorization; queued/sent/unknown/failed statuses; redacted audit. A22. |
| B07.3 — Rehearse migration/cutover | Trusted operator imports mappings/data, freezes writers and routes durable webhooks | Snapshot/watermark rollback before new writes; after new writes maintenance and forward reconciliation | Repeated import, paid mismatch, ambiguous email/DOB, pending legacy session, provider outage and rollback drill pass A24. Inject a paid event before durable ingress, during old-writer drain, after final delta and after switch; every payment appears in exactly one imported/new ledger path. Queued events survive pre-write rollback. |
| B07.4 — Release checks and runbook | Development proves checks; admin accepts queues; release owner authorizes deployment/live payment | Gate fails closed on missing access/config, unresolved future paid data or critical tests | All A01–A25 pass, build/lint/type checks pass, privacy matrix validated, legal/refund/consent copy aligned and retention policy confirmed. |

## 2. Traceability and scenario fixtures

| Requirement | Primary tasks | Acceptance IDs / mandatory fixture |
| --- | --- | --- |
| R01 profile/access | B01.2–3, B02.1–3 | A01–A03; two guests plus admin/assigned+unassigned host/two venue partners/anon, critical profile edit |
| R02 browse/request | B02.4, B03.1 | A04–A05; empty/live/cached-error/full/draft Table and shared link |
| R03 composition/offer | B03.2–4 | A06–A08; boundary age and mutual-preference cases, 2–6 roster candidates, stale approval |
| R04 payment/capacity | B04.1–3 | A09–A12; parallel final-slot attempts, duplicate webhook+return, session-create timeout, late paid and email outage |
| R05 cancellations/refunds | B04.4–5 | A13–A15; request/deny/remove, duplicate partial refunds, settlement failure, cancelled Table receives late charge |
| R06 operations | B05.1–4 | A16–A18; worker late, under-three/invalid paid subset, replacement race, venue IDOR |
| R07 voting | B05.3, B06.1–2 | A19–A20; exact window boundaries, late check-in, one-way/Nobody/non-submit, removed guest |
| R08 feedback/report | B06.3 | A21; own rating upsert, report subject scope, unauthorized report read |
| R09 operator/delivery | B01.5, B03.4, B07.1–2 | A22; unknown send/retry, role bypass, heartbeat gap, safe clone undo |
| R10 migration/sync | B01.1–4, B07.3–4 | A23–A24; failed pagination, upstream delete, import twice, money reconciliation, single-writer rollback |
| R11 UI/a11y | B02.1 and every route slice | A25; keyboard/screen reader, 320px/desktop, zoom/long text, error/permission states |

Fixture data must be synthetic and mode-isolated. A passing visual happy path is insufficient for transactional or privacy acceptance. Vitest covers pure rules/service contracts; disposable local Supabase exercises actual transactions/constraints/RLS/RPC with concurrent requests; Stripe sandbox exercises signed events/provider transitions; Playwright covers routes/roles and recovery, supplemented with manual assistive-technology checks.

## 3. Completion and release gates

- [ ] Every task has linked implementation evidence and associated A scenarios passing.
- [ ] All active production routes use named features and persistent server truth; screen-index/prototype entry retired.
- [ ] No raw privileged client write or direct API bypass defeats policy; no service keys/PII/image URLs/ballot choices in audit/client payloads.
- [ ] Payment/refund replay and concurrency checks show no duplicate paid Seat, lost charge or excess refund.
- [ ] Sync source/revision ownership and clone reconciliation verified; no core runtime Airtable writers remain after cutover.
- [ ] Old automatic refund policy removed from UI/email/legal/receipt surfaces; consent versions updated with accountable copy review.
- [ ] Admin can resolve identity, stale roster, low-fill, refund, unknown payment/send and sync-conflict queues; escalation/heartbeat independently monitored.
- [ ] Retention/deletion policy and backup treatment confirmed by release owner, jobs documented and exercised locally.
- [ ] Migration report accounts for every source record and unresolved row; zero unresolved future paid identity/payment links.
- [ ] Freeze/drain, legacy webhook routing, single-writer switch and post-write rollback drill pass.
- [ ] Build/lint/type checks and A01–A25 evidence attached; no unrelated changes included.
- [ ] Exact deployment destination/action and any live charge authorized by human before execution.

## 4. Development hand-off status

B01 starts with local schema/contracts/test fixtures and read-only discovery. B02 can start after identity/schema guards; B03 after supply/identity; B04 after approved offers; B05 after paid Seat state; B06 after reliable attendance; B07 after all dependencies. Unavailable hosted access is recorded in the review evidence-debt list and blocks production verification only. No team assignment, release date or business metric target is implied by this sequence.
