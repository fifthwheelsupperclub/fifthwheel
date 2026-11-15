---
id: fifthwheel-mvp-privacy-review
status: review-complete
date: 2026-11-11
owner: cipher
---

# Independent security and privacy review

## Readiness

The packet is suitable to begin its disabled, local foundation work, with the three bounded contract corrections below. It does not establish production privacy readiness. None of the findings demonstrates an exploitable deployed vulnerability: these are implementation-specification defects. No live system was accessed, no application changes were made, and no runtime privacy checks were claimed.

## Scope

Fresh-context review of `app/docs/refactor/PRD.md`, `architecture.md`, `flow-ui-brief.md`, and `tasks-checklist.md`; repository instructions, Cipher manifest, security/privacy skill, resource index, current role/auth middleware, and local role/storage migrations. Review focuses on authorization and sensitive-data lifecycle, not legal interpretations or exhaustive implementation review.

## Assets and data inventory

| Asset | Store/flow | Sensitivity and proposed retention |
| --- | --- | --- |
| Email, DOB, identity and matching preferences | Supabase core, owner/admin DTOs | Sensitive personal data; account deletion pseudonymizes references |
| Profile photos and separate selfie | Private storage, signed owner/admin access | Sensitive images; superseded/draft 7 days, reviewed images 30 days |
| Attendance, ballots and mutual result | Private Supabase records, narrow server RPCs | Highly sensitive relationship information; ballots 30 days, mutual result 90 days |
| Conduct reports and reporter identity | Restricted report store/admin triage | Highly sensitive allegations; review deletion at 12 months, case holds |
| Payments/refunds | Stripe and Supabase ledger | Restricted financial/account linkage; finance retention still gated |
| Audit/outbox | Server jobs and administrative view | Redacted metadata; audit 90 days, delivery/operation retention needs implementation mapping |

## Trust boundaries

Verified Supabase identity must be resolved to one owned Guest UUID. Browser IDs and invitation tokens are locators, never authority. Trusted services authorize role/assignment before privileged database calls; RLS/grants deny direct client mutation. Hosts are Table-assigned; restaurant users are venue-assigned. Stripe events require signature verification and return handlers require owner-attempt binding. Airtable is supply authority only, not guest/payment authority. Email and signed storage URLs are external disclosure boundaries. Operator/service credentials remain privileged beyond normal app roles; the packet does not claim protection against a malicious database owner.

## Findings

### P2 — Eligibility snapshot scheduling contradicts the authoritative voting window

**Exact location:** `app/docs/refactor/architecture.md`, **§8. Scheduling, delivery and operational recovery**, paragraph beginning “T−48 invitation reminder”; compare `PRD.md`, **R07 — Attendance, vote and reveal**, and `tasks-checklist.md`, **B06.1 — Eligibility snapshot and ballot**.

**Evidence:** Architecture says “At start, freeze eligibility logically” and then describes checking attendance relative to `vote_open_at`. PRD requires the freeze at start+90 minutes; B06.1 says freeze “at open.” A materialized snapshot at scheduled start cannot contain attendance subsequently committed during the first 90 minutes. The architecture also says materialize once, so the discrepancy cannot be repaired by a later normal check-in.

**Impact:** An implementation following the scheduling paragraph could permanently exclude valid attendees from voting and from others' ballot choices. This is an eligibility/authorization correctness defect rather than a demonstrated privacy disclosure. Likelihood is moderate because the job implementation has two conflicting instructions.

**Minimal fix:** Replace “At start” with “At vote opening (start+90m)” and explicitly prohibit early materialization. Keep lazy recovery equivalent to the on-time snapshot. Add a fixture for attendance committed at start+45m, an on-time snapshot, and a delayed snapshot; all must produce the same eligible set.

### P2 — The 90-day reveal promise has no durable result record or materialization boundary

**Exact location:** `app/docs/refactor/architecture.md`, **§7. Roles, privacy and retention**, paragraph beginning “Engineering retention defaults”; compare **§3. Core schema contract**, **§4. State machines and authorization**, and **§6. Application contracts** (`getReveal`).

**Evidence:** The retention contract deletes ballots after 30 days but retains a per-user mutual result for 90 days. The schema defines ballots/eligibility but no durable mutual-result record; no close/finalization use case or job creates it. `getReveal` only offers `pending|closed|revealed`, while the retention contract separately requires `results_unavailable` after 90 days.

**Impact:** Implementers must invent a sensitive derived-data lifecycle. Computing only from ballots breaks valid days-31–90 reveals; retaining ballots to support them breaks the minimization promise; caching results without an invalidation contract risks showing a removed/deleted counterpart. This is a necessary persistence and authorization contract missing from an otherwise detailed schema, not a complaint that the feature is currently unimplemented.

**Minimal fix:** Define a private per-user result record, with a unique owner/Table key, nullable counterpart, finalized/expiry timestamps, and the same current-eligibility restrictions as reveal. Specify idempotent close finalization and guarantee it precedes ballot deletion. Synchronously invalidate counterpart results on applicable removal/deletion. Add an explicit unavailable response variant and day-31/day-90/removal/account-deletion tests. An equivalent privacy-preserving persistence design is acceptable; the contract must choose one.

### P2 — Image deletion is not reconciled with future required-photo eligibility

**Exact location:** `app/docs/refactor/architecture.md`, **§7. Roles, privacy and retention**, paragraph beginning “Engineering retention defaults”; compare `PRD.md`, **R01 — Identity, profile and access**, acceptance A02, and `tasks-checklist.md`, **B02.2/B02.3**.

**Evidence:** R01 requires at least one profile photo plus a separate selfie and A02 says missing photos/selfie block payment. Architecture deletes “verification images 30 days after final review,” retaining only reviewer/version/result. `guest_files` does not distinguish a continuing profile photo from temporary review evidence; there is no post-purge completeness rule. Invitations themselves do not expire, so an otherwise valid guest may legitimately check out well after review+30d.

**Impact:** The implementation cannot simultaneously follow the literal required-file payment check and the image deletion default without another rule. It could repeatedly force reuploads, block long-lived offers, or silently retain images to keep the eligibility check passing. The retention policy is explicitly proposed and release-gated, so this is a contract clarification for implementation, not a claim of current unlawful retention.

**Minimal fix:** Explicitly identify which files are temporary identity evidence and whether any profile photo is retained for the active profile. Define whether an approved version remains complete after evidence purge (with an evidence-deleted marker), or deliberately expires review and requires new submission. Make payment checks and guest copy match the selected policy. Add review+31d checkout and retention-job tests.

## Existing gaps already scheduled — not additional spec defects

- Current migration `app/supabase/migrations/20260816214827_277e5eb6-8fdf-4d06-a57a-57b9507aca1d.sql` permits anonymous/authenticated uploads to `guest-uploads`. Architecture §7 explicitly removes anonymous upload, makes storage private, bounds file formats/size and signed-URL lifetime; B01/B02 require actual deny tests.
- `app/src/lib/require-role.ts` authorizes broad roles and uses a free-text venue field. The packet explicitly replaces it with UUID assignments/memberships and tests wrong-venue direct API access (B05.4). It should not be accepted as the target host/restaurant boundary.
- Current auth middleware establishes a claims subject but the reviewed file does not establish the packet's verified-email/profile-review gate. B01.3/B02.1 explicitly own the missing verified-identity work.
- Prototype attendance/ballot/reveal behavior is explicitly superseded by B05/B06 private persisted contracts. No production privacy claim is supported by prototype UI.

## Controls and boundary coverage

These are verified **specification controls**, not verified deployed controls: private owner/admin image access; service-side role checks plus RLS/grants; no raw ballot listings even for app admins; own mutual-only reveal; admin-only conduct triage with redacted audit; partner counts/times/business-contact DTO; verified same-email legacy claim only for unambiguous records; no automatic name/phone merge; runtime payment authority excluded from Airtable; durable recipient-authorized outbox and redacted provider payloads. The packet adequately schedules denial/replay/concurrency verification for these boundaries. General requests for “more security” or restatements of existing backlog work are not findings.

## Prioritized mitigations and evidence debt

Correct snapshot timing and resolve derived-result/image lifecycles before implementing the corresponding schema/jobs. Local B01 may start while these small specifications are amended. Production remains gated on actual grants/RLS/storage configuration, role and membership inventory, signed URL behavior, service/provider authentication, worker configuration, retention/backup treatment, and adversarial owner/other-user/host/restaurant/anonymous tests. No tests or live configuration inspection were performed in this document-only review.

## Assumptions

The new server layer is trusted and its service credentials are not exposed to browsers. Admin permissions mean app-admin permissions, not database-owner powers. The four documents are normative; historical prototype behavior cannot override them. Human release approval still owns final retention/legal policy and exact external actions.
