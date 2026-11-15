---
id: fifthwheel-admission-contract
type: integration-contract
status: w03-local-accepted-w04-implementation-in-progress
date: 2026-11-13
owner: relay
related_objects: [waitlist-signup, app-admission, invitation-delivery, app-user-role]
related_evidence: [supabase/migrations/20261112043346_app_admission_foundation.sql, supabase/migrations/20261112053915_app_audit_events.sql, supabase/migrations/20261112070000_app_admission_queue_rpc.sql, supabase/migrations/20261112080000_app_invitation_attempt_rpcs.sql, supabase/migrations/20261112171256_member_profile_identity_foundation.sql, src/server/supabase.server.ts, src/server/principal.server.ts, scripts/test-admission-operation.mjs]
related_decisions: [decision-separate-member-admission, decision-exact-preference-sets]
---

# Admission and sign-in integration contract

## W04 member profile and identity-review contract

This is the integrated behavior contract. Current implementation and evidence status lives in the [task ledger](task-ledger.md), [acceptance ledger](acceptance-ledger.md), and [W04 slice report](w04-slice-report.md); requirements below do not imply that every W04 acceptance case has passed.

This section freezes the server boundary for Finn’s W04 screens. All inputs are untrusted. The server assembles a verified principal, then authorizes the member or admin action before using the service role. No request accepts an actor ID, guest ID for member writes, email, role, admission state, storage key, object path, review state, or profile/identity revision as authority. The linked `app_admissions` row and its exact waitlist signup are the source for first profile prefill; creation starts in `draft` and never implies identity approval.

### Shared response and revision rules

Successful API responses use `{ ok: true, data, correlationId }`. Failures use `{ ok: false, code, message, retryable, correlationId, fields? }`, with safe codes `unauthenticated`, `forbidden`, `not_found`, `invalid_input`, `conflict`, and `temporarily_unavailable`. Validation retains ordinary editable form values in the UI; server errors contain field names and safe guidance only. Every mutation uses an operation UUID plus `expectedProfileRevision` when profile state is involved. A stale profile or review version returns HTTP 409 `conflict`; it never silently applies against the newer revision.

`profileRevision` (`profile_version` in storage) increments when any saved profile value changes. `criticalIdentityVersion` (`identity_version`) increments only when DOB, own identity, photo or selfie changes. `reviewedIdentityVersion` (`approved_identity_version`) records the critical version that was approved. A critical edit moves review status to `draft`, clears the current submitted version and requires new evidence; an older reviewed version remains history only and cannot approve the new critical version. Edits to matching preferences and other non-critical fields increment `profileRevision`, retain approval for the unchanged `criticalIdentityVersion`, and flag future offers for W06 revalidation. State names are `draft`, `submitted`, `approved`, and `resubmission_required`. Submitting the same current submitted version is idempotent. A resubmission creates a new review attempt for the current critical version. Roster/offer consumers compare their captured `profileRevision` against current profile revision and revalidate; payment eligibility compares `reviewedIdentityVersion = criticalIdentityVersion` plus approval state, not image existence.

Safe DTOs are exact and never expose repository rows:

```ts
type MemberProfileDTO = {
  profileRevision: number;
  criticalIdentityVersion: number;
  reviewedIdentityVersion: number | null;
  identityStatus: "draft" | "submitted" | "approved" | "resubmission_required";
  latestCorrectionReason: string | null; // latest actionable correction only; no reviewer metadata
  firstName: string; lastName: string; dateOfBirth: string;
  identity: "woman" | "man" | "non_binary";
  openTo: readonly ("woman" | "man" | "non_binary")[];
  matchAgeMin: number; matchAgeMax: number; neighborhood: string;
  nights: readonly string[]; lookingFor: "Casual" | "Open" | "Relationship";
  surpriseGame: "Yes, surprise me" | "I'd rather keep it conversational";
  phone: string | null; oneLiner: string | null;
  files: readonly { fileId: string; kind: "photo" | "selfie"; state: "pending_upload" | "ready" | "rejected" | "superseded" | "deleted" }[];
  missingFields: readonly string[];
};
type IdentityReviewQueueItem = {
  reviewId: string; guestId: string; firstName: string; lastName: string;
  submittedAt: string; profileRevision: number;
  criticalIdentityVersion: number; attemptNumber: number;
};
type IdentityReviewProfileDTO = {
  profileRevision: number; criticalIdentityVersion: number; reviewedIdentityVersion: number | null;
  identityStatus: "draft" | "submitted" | "approved" | "resubmission_required";
  firstName: string; lastName: string; dateOfBirth: string;
  identity: "woman" | "man" | "non_binary";
  files: readonly { fileId: string; kind: "photo" | "selfie"; state: string }[];
  missingFields: readonly string[];
};
type IdentityReviewDetailDTO = {
  profile: IdentityReviewProfileDTO; reviewId: string; submittedCriticalIdentityVersion: number; submittedAt: string;
  attemptNumber: number; correctionReason: string | null;
  evidence: readonly { fileId: string; kind: "photo" | "selfie"; readUrl: string; expiresAt: string }[];
};
type W04Error = { code: "unauthenticated" | "forbidden" | "not_found" | "invalid_input" | "conflict" | "temporarily_unavailable"; message: string; retryable: boolean; fields?: Record<string,string>; correlationId: string };
```

The member profile DTO is returned only to its owner and includes only the latest actionable correction reason. Admin list DTOs omit DOB, neighborhood, phone, one-liner and evidence URLs. Admin detail uses a separate minimized profile DTO (name, DOB, own identity, revisions/status, completeness and file summaries); it excludes preferences, phone, one-liner and reviewer history. It includes the review's `submittedCriticalIdentityVersion` separately from the approved `reviewedIdentityVersion`. Evidence URLs are the only signed URL exception and are never cached/shared/logged.

### Member routes

| Route | Request | Success result | Authorization and failure |
|---|---|---|---|
| `GET /api/member/profile` | No body. | Safe `MemberProfileDTO`: own profile fields, `profileRevision`, `criticalIdentityVersion`, `reviewedIdentityVersion`, `identityStatus`, missing/required field names, and file summaries (`fileId`, `kind`, `state`). Never include storage keys, raw rows, or signed URLs. First access creates/prefills only from the activated admission’s linked waitlist row. | Verified admitted member only. A host, restaurant user, other member, unadmitted identity, or anonymous caller receives a safe 401/403/404 without profile details. |
| `PUT /api/member/profile` | `{ operationId, expectedProfileRevision, firstName, lastName, dateOfBirth, identity, openTo[], matchAgeMin, matchAgeMax, neighborhood, nights[], lookingFor, surpriseGame, phone?, oneLiner? }`. Only these documented fields are writable. | Updated safe `MemberProfileDTO`; server supplies revisions/status. | Own profile only. DOB must be a real date and age ≥21 on today’s America/New_York date. `openTo` is a non-empty subset of `woman`, `man`, `non_binary`; matching ages are integers 21–120 with max≥min. No maximum applicant DOB age. Stale revision is 409; invalid fields are 400. |
| `POST /api/member/profile/files` | `{ operationId, expectedProfileRevision, expectedCriticalIdentityVersion, kind: 'photo'|'selfie', contentType, byteSize }`. No client path/key. | `{ fileId, criticalIdentityVersion, uploadUrl, uploadToken, expiresAt }`; `uploadUrl` is a same-origin app route, not a Supabase Storage signed URL. `uploadToken` is an opaque five-minute, single-use grant returned only to the owner. | Own active profile only. Accept JPEG/PNG/WebP, ≤8 MiB, at most six current photos and one selfie, counting pending intents. A selfie is separate from profile photos. Unsupported type, too many files or stale revision is rejected. Keep `uploadToken` in memory only; never place it in URL, local storage, logs, analytics, audit or email. |
| `PUT /api/member/profile/files/:fileId/content` | Raw image bytes ≤8 MiB; `Content-Type` must match the intent; `X-FW-Upload-Token: <opaque token>`. Cookie-authenticated same-origin request. No JSON, path or owner fields. | `{ fileId, received: true, byteSize }`; the app server has copied the bytes to the private generated quarantine key. | Reverify the owner session and exact `Origin`, bind file/owner/profile and critical-version intent, stream-limit before buffering and verify post-read size. Atomically consume the stored hash/expiry before writing Storage; replay, expired token, wrong owner or stale intent fails. Token is not logged. A failed upload consumes this intent; the member requests a new one. |
| `POST /api/member/profile/files/:fileId/complete` | `{ operationId, expectedProfileRevision, expectedCriticalIdentityVersion }`. | `{ fileId, state: 'ready', profileRevision, criticalIdentityVersion }` only after trusted validation, decode, normalization and EXIF stripping. | Must match authenticated owner, guest, and both revisions captured by upload intent. Reject replay/overwrite after completion; original bytes stay quarantined and inaccessible to review, normalized output uses a separate server-generated key, and original bytes are removed before status becomes ready. A small tombstone blocks reuse of a no-upsert upload grant until expiry. |
| `POST /api/member/profile/files/:fileId/read-url` | `{ operationId, expectedProfileRevision, expectedCriticalIdentityVersion }`. | `{ readUrl, expiresAt }`, TTL ≤5 minutes. Response has `Cache-Control: private, no-store` and `Referrer-Policy: no-referrer`. | Owner only; rechecks the authenticated owner/file and both current revisions at mint time, and requires the ready normalized object. URL is not included in profile DTO, logs, cache, audit or shared state. |
| `DELETE /api/member/profile/files/:fileId` | `{ operationId, expectedProfileRevision }`. | Updated file summary and revisions. | Own file only. Supersedes/removes the file from current evidence; any photo/selfie change invalidates current review. Storage cleanup is idempotent and can be retried. |
| `POST /api/member/profile/submit` | `{ operationId, expectedProfileRevision }`. | `{ profileRevision, criticalIdentityVersion, identityStatus: 'submitted', reviewId, attemptNumber }`. | Own profile only. Requires complete profile, DOB age≥21 today in Atlanta, valid matching preferences, ≥1 ready photo and exactly one ready selfie for current critical version. It atomically freezes the submitted revisions and opens a review attempt. Incomplete/current evidence errors are field-addressable. |

`ImageNormalizer` is a required server-only dependency contract: `normalize(input: { bytes: Uint8Array; claimedContentType: string }) → Promise<{ bytes: Uint8Array; contentType: 'image/jpeg'|'image/png'|'image/webp'; width: number; height: number }>`; it must reject malformed/mismatched signatures, decode the image, reject unsupported/corrupt/oversize/over-pixel/animated input, enforce the 8 MiB normalized output limit and return re-encoded bytes with metadata removed. The selected Sharp adapter is bounded to 8 MiB input/output, ≤40MP, max dimension 4096, one frame, strict signature/decoded-format match, metadata stripping, bounded libvips cache/concurrency and a decode timeout. Storage stays private; direct anon/authenticated REST SELECT/INSERT/UPDATE/DELETE on profile/review/file metadata and direct Storage object API access are denied. Admin and owner reads use short-lived (≤5 minute) signed read URLs only where explicitly required.

### Admin identity-review routes

| Route | Request | Success result | Authorization and failure |
|---|---|---|---|
| `GET /api/admin/identity-reviews` | Bounded cursor and status filter. | `{ items: IdentityReviewQueueItem[], nextCursor }`; list rows omit DOB and image URLs. | Trusted admin only. Members, hosts, restaurants and anonymous callers are denied before privileged repository access. |
| `GET /api/admin/identity-reviews/:guestId` | Guest UUID. | Purpose-limited `IdentityReviewDetailDTO` with fields needed for manual review, current submitted revision, correction history/status, and temporary evidence read URLs. No storage keys or raw repository rows. Response has `Cache-Control: private, no-store` and `Referrer-Policy: no-referrer`. | Trusted admin only. Recheck the exact current submitted critical version and ready file IDs immediately before mint. Append an access audit event per target file (actor, guest/file IDs, version, request ID, timestamp; never URL/content/PII), then require commit success before signing any URL. If audit or signing fails, return no URLs. Only current submitted-version evidence is readable. |
| `POST /api/admin/identity-reviews/:guestId/decision` | `{ operationId, expectedProfileRevision, reviewId, decision: 'approved'|'resubmission_required', correctionReason? }`. | `{ guestId, profileRevision, criticalIdentityVersion, reviewedIdentityVersion, identityStatus, reviewedAt }`. | Trusted admin only. Decision derives reviewer from verified principal; `reviewId` must belong to this guest and current submitted profile/critical versions. Approve requires current ready evidence. Resubmission requires a 1–2000 character correction reason. Stale/duplicate decision is 409. |

Admin detail access never grants broad profile browsing. The safe review DTO contains only the current review inputs and evidence preview URLs needed for the manual decision. Host, restaurant and other-member workspaces cannot read any review or file bytes. Photo review is not government-ID or background verification.

### Storage, audit and retention invariants

The `identity-evidence` bucket is private, max 8 MiB per object and restricted to JPEG/PNG/WebP. Object keys are random and server-generated under a guest-owned prefix. The caller cannot choose a path or attach another guest’s file ID. Direct anon/authenticated REST SELECT/INSERT/UPDATE/DELETE on profile, review and file metadata, and direct Storage object API access are denied. Upload grants are opaque server-side hashes bound to owner/file/version, five-minute expiry and one atomic consumption; the browser uploads only to the app’s same-origin raw-body `PUT` endpoint, and the app server writes the body to Storage with server-only credentials. This avoids exposing Supabase Storage's longer-lived, non-revocable signed-upload bearer tokens. The consumed intent cannot be replayed; an upload failure requires a fresh intent. Original bytes are kept in private quarantine and are never visible in review. Only normalized output is signed; source deletion must finish before file state changes to ready. Failed source cleanup leaves the record quarantined, not ready. Audit-before-read is required on every admin evidence URL issuance. Redacted audit records identify the exact guest/file/version/request without object keys, URLs, image content, DOB, email or review prose. Owner/admin signed-read responses use private/no-store and no-referrer headers.

Profile save, upload intent/complete/delete, submit, decision and retention serialize on the guest row and compare profile, critical identity, submitted review and file versions within the transaction. Stale work conflicts; no old decision can approve a new version. W07 payment eligibility must require `identityStatus = approved` and `reviewedIdentityVersion = criticalIdentityVersion` server-side. Retention locks the guest/file, checks no current submitted review references the evidence and rechecks its version/state before deleting, so a concurrent replace or submit cannot purge evidence newly attached to active review. Engineering retention defaults from Architecture §7: superseded/unsubmitted evidence is eligible for deletion after 7 days; evidence for a final review is eligible 30 days after that review. Store `receivedAt`, `retentionDueAt`, and `deletedAt` markers on evidence and minimal received/deleted markers on the review/profile. Once an approved identity version has an approval record and evidence-received marker, deletion of its images does not revoke the unchanged approval; checkout at review+31 days remains eligible. A new critical identity version requires fresh photo/selfie evidence. Retention cleanup deletes storage objects and marks rows idempotently; it does not erase review decision/version evidence. Release owner confirmation of retention policy remains a production release dependency.

### Role matrix and W04 fixtures

| Actor | Own profile | Own upload/status | Identity queue/detail/decision | Other member evidence |
|---|---:|---:|---:|---:|
| Anonymous / unverified / unadmitted | No | No | No | No |
| Activated member | Read/write own only | Own only | No | No |
| Admin | Purpose-limited review DTO | No generic owner route | Yes; every evidence URL audited | Current review only |
| Host, assigned or unassigned | No profile API | No | No | No |
| Restaurant, assigned or unassigned | No profile API | No | No | No |
| Other activated member | Own only | Own only | No | No |

Use Sentry’s stable cases `W04-PROFILE-01`–`05`, `W04-UPLOAD-01`–`03`, `W04-REVIEW-01`–`02`, `W04-RETENTION-01`–`02`, and `W04-A11Y-01`. The fixtures include all seven preference subsets, exact age-21/under boundary, 21–120 preference limits, stale versions, admin reviewer, assigned/unassigned host and venue, other member and anonymous actor. These are acceptance targets, not evidence that the operations already work.

W03 is accepted for the local admission milestone, including the guarded browser journey and local intercepted email recorded in the acceptance ledger. This contract remains the source for its API semantics; W06 owns rendering and completing a shared-Table continuation. The isolated test stack has advanced beyond the original W03 migrations. W04 routes, profile/review services, storage adapter and migration are integrated and exercised locally; W04 remains `implementing` while its listed boundary, recovery and accessibility evidence is completed. Production provisioning and provider configuration remain release work.

## Intake boundary

Keep the marketing integration at `POST /api/waitlist` with the current JSON names:

`first_name`, `last_name`, `email`, `birthdate`, `identity`, `open_to`, `match_age_min`, `match_age_max`, `neighborhood`, `nights`, `looking_for`, `surprise_game`, `referral`, `source`, `submitted_at`, `_gotcha`.

The existing form sends `open_to` and `nights` as comma-separated strings. Parse complete labels only; trim delimiter whitespace and reject unknown labels. `open_to` must retain one or more distinct exact selections from `Women`, `Men`, and `Non-binary people`. All seven non-empty combinations pass the schema. Do not collapse combinations into a single `Everyone` preference. Map the three identity labels exactly as submitted. `nights` accepts the seven weekday labels; its “Not specified” form value becomes an empty set. Matching-age preferences are whole years from 21 through 120 inclusive, with maximum age at least the minimum. This bound applies only to match preferences: an applicant must be at least 21, with no maximum applicant age.

Normalize email with trim plus lowercase before lookup. Validate required strings, a real DOB that is 21 or older against the current date in `America/New_York`, and valid age bounds. The database independently rejects future/underage DOBs and invalid preference sets. Ignore `_gotcha` submissions with a neutral success response and no stored record. Ignore client `submitted_at` for ordering; `received_at` is set by the database. Do not upsert over an existing signup: a duplicate normalized email must not alter a member’s saved intake, admission or delivery state. A successful waitlist submission grants no app or Table access.

Every successful marketing submission outcome uses the same neutral response, `{ "received": true }`, and the same success copy. Do not claim the person joined, that an email was sent, or that a duplicate or honeypot submission created a record. Validation failures use safe non-2xx responses with field errors. The waitlist endpoint does not send a confirmation email. Supabase Auth invitations are sent separately after admin admission and intercepted by each local stack’s Mailpit.

## Database objects and states

| Object | Contract |
|---|---|
| `public.waitlist_signups` | Unique normalized email, current marketing intake, exact `open_to` labels, weekdays, `source = landing-page`, server `received_at`. |
| `public.app_user_roles` | Trusted assignments for `admin`, `host`, or `restaurant`, keyed by Auth user ID. Marketing intake and user metadata never grant a role. |
| `public.app_admissions` | One durable admission per signup and recipient email. `invited → activated`; `deleted` is terminal for the admission. `approved_by` and `approved_at` record the admin action. Auth linkage is nullable, unique and set only after verified recipient authentication. |
| `public.app_invitation_deliveries` | One idempotent send operation per unique `operation_id`. Tracks queue/lease/retry status and provider-accepted/delivery timestamps. Repeated sends are separate operations and do not create another admission. |
| `public.app_invitation_delivery_attempts` | Per-attempt number, distinct unique `operation_id`, trusted admin starter, and state (`sending`, `accepted`, `failed`, `unknown`), provider message reference, bounded error code and timestamps. Keep each attempt’s result; do not turn provider acceptance into inbox delivery. |
| `public.app_audit_events` | Append-only actor/action/subject record with request and operation IDs, database timestamp and allowlisted redacted metadata. No free-form values, PII or provider payloads. Server role can select/insert only; it cannot update/delete. |

Delivery operation states are `queued`, `sending`, `accepted`, `delivered`, `failed`, and `unknown`. `accepted` means the configured provider accepted a send. Set `delivered` only when an actual provider delivery event is available and verified. A timeout after dispatch is `unknown`; it remains blocked from another attempt until a separate reconciliation workflow resolves the uncertainty. It is never guessed success or automatically resent. Table invitations and payments are separate objects and are outside this foundation.

## Authorization and Auth

All six tables have RLS enabled. `anon` and `authenticated` have no table grants; the local schema check confirms direct Data API access is denied. The private preference and audit metadata validators are not executable by either public role. `service_role` is the only granted data path. Server handlers must still verify the caller’s session and trusted `app_user_roles` assignment before every admin operation; never accept a client-supplied role, email, admission, provider outcome or Stripe environment as authority. Do not send the service-role key to the browser.

Audit `action` and `subject_type` values are fixed slugs; actor kind is either an Auth user UUID or a known system worker. `metadata` is limited to `state`, `from_state`, `to_state`, `reason_code`, `attempt_number`, and `retryable`, with finite state/reason vocabularies and bounded counters. The database rejects unknown keys and values. `request_id` and `operation_id` are UUIDs; `subject_id` is a UUID and is not a foreign key, preserving audit history if a subject is later deleted. Audit reads still require server authorization before repository access.

The local Auth configuration disables new signup and email signup. Member admission begins with an admin-approved durable `app_admissions` row. Only the server may request a link for that approved email. The adapter validates Supabase’s generated `action_link` and `hashed_token`, but returns an app-origin callback URL with the one-time `token_hash` and exact `type`; it does not send the Supabase `/verify` action link. Loading `/auth/callback` must not redeem the token. After the member explicitly continues, the app POSTs the token hash to the server, which verifies the provider session, verified recipient identity, durable admission and safe internal return destination before creating a member session. Scrub token query values from browser history after capturing them in memory. Persist first activation once. Returning-link requests require an existing active admission, a generic response and rate limiting; they do not create admission. Staff identities are provisioned separately and need a trusted role; no staff role implies member admission.

Local `site_url` is `http://127.0.0.1:8085`; the exact callback allowlist contains only `http://127.0.0.1:8085/auth/callback`. Token expiry is configured to one hour. Recheck these values when the auth callback route is implemented. Local auth email is intercepted in Mailpit. No real email adapter or live provider credentials are configured by this foundation.

### Typed server authorization boundary

The server creates this context only after validating a provider session with Auth `/user` and reading trusted role/admission rows. It is not an accepted request DTO and must never be hydrated from cookies, `user_metadata`, route parameters or client claims. [`supabase.server.ts`](../../src/server/supabase.server.ts) verifies the bearer token with the publishable key, then reads `app_user_roles` and `app_admissions` through the server secret; role queries are filtered and checked against the verified Auth user ID. The helper in [`authorization.server.ts`](../../src/server/authorization.server.ts) requires an active admission linked by Auth user ID and normalized email for member actions, a trusted staff role for staff actions, and exact table/venue assignment for scoped staff actions.

The Supabase server client reads `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` (or legacy `SUPABASE_ANON_KEY`), and `SUPABASE_SECRET_KEY` (or legacy `SUPABASE_SERVICE_ROLE_KEY`) from server environment only. It rejects non-loopback HTTP and never exposes either key in its client object or error messages. There is no live provider configuration in this slice.

```ts
type StaffRole = "admin" | "host" | "restaurant";
type ServerVerifiedPrincipal = {
  userId: string;
  emailNormalized: string;
  emailVerified: boolean;
  staffRoles: ReadonlySet<StaffRole>;
  admission: {
    state: "invited" | "activated" | "deleted" | "none";
    authUserId: string | null;
    emailNormalized: string | null;
  };
  assignedTableIds: ReadonlySet<string>;
  assignedVenueIds: ReadonlySet<string>;
};

type AppPermission =
  | { action: "waitlist:read" | "admission:invite"; workspace: "admin" }
  | { action: "member:read-own" | "member:edit-own"; workspace: "member" }
  | { action: "table:operate"; workspace: "host"; tableId: string }
  | { action: "venue:read-service"; workspace: "restaurant"; venueId: string };

type AuthorizationFailure =
  | "unauthenticated"
  | "email-unverified"
  | "member-not-admitted"
  | "forbidden"
  | "resource-not-assigned";

type AuthorizationResult =
  | { allowed: true; principal: ServerVerifiedPrincipal; permission: AppPermission }
  | { allowed: false; reason: AuthorizationFailure };

async function authorize(
  principal: ServerVerifiedPrincipal | null,
  permission: AppPermission,
): AuthorizationResult;
```

`authorize` applies both the workspace role and, for host/restaurant actions, the exact resource assignment. Member access requires a verified identity linked by Auth user ID to an active admission; an admin role alone does not create a member profile. A member admission never creates a staff role. Return `forbidden` or a privacy-safe equivalent without disclosing another user’s admission state. Database repositories use privileged credentials only after the server obtains an allowed result.

## Server operation shapes (provisional DTOs)

These W03 routes and service boundaries are implemented and accepted for the local admission milestone. Their current evidence and remaining release limitations are recorded in the acceptance ledger and task ledger:

- `submitWaitlist(payload) → HTTP 2xx { received: true }`: validate and persist once. Valid, duplicate, and honeypot success paths share the same response and neutral copy; there is no waitlist confirmation email. Validation failures use safe non-2xx field errors. Duplicate signup must never overwrite saved intake or admission state. The server repository uses PostgREST `on_conflict=email_normalized` with `resolution=ignore-duplicates`; an empty insert representation triggers a server-only select of the existing row, never an update.
- `searchWaitlist(admin, filters, cursor) → { items, nextCursor }`: authorized paginated search. Return only fields needed for review and invitation status.
- `admitWaitlistMember(admin, signupId, operationId) → { admission, delivery }`: authorize admin, create/reuse the one admission and idempotently enqueue one app invitation operation in a transaction before dispatch.
- `retryInvitation(admin, deliveryId, operationId) → { delivery, attempt }`: authorize admin and atomically claim one attempt under a fresh operation UUID. Retries are explicit; `unknown` cannot be claimed or resent until reconciliation resolves it. Replaying the same attempt UUID returns its original attempt. The worker later records exactly one accepted/failed/unknown finish; stale workers cannot overwrite newer attempts.
- `requestMemberLink(email, safeReturnTo) → { accepted: true }`: always return the same public response; rate-limit, and request a link only for an admitted recipient. Never reveal whether a waitlist row, Auth account or admission exists.
- `completeMagicLink({ tokenHash, kind, safeReturnTo }) → { session, nextPath }`: only after explicit user confirmation, POST the token hash and supported kind to the server. Verify the provider session server-side, bind an unambiguous verified Auth user to the durable admission, activate once, then return a safe internal path.

## Isolated role fixtures

Use deterministic synthetic identities only: an anonymous caller without a session; an admitted member with no staff role; a verified but unadmitted identity; an admin role without member admission; a host role with one assigned Table and one unassigned Table; and a restaurant role with one assigned venue and one unassigned venue. Add negative variants for an unverified identity and deleted admission. Never place trusted roles in user-editable metadata. Use stable fixture IDs and reserved `example.test` addresses; keep fixtures exclusively in the test project.

For the current W02 principal assembly, Node tests inject Auth responses, trusted `app_user_roles`/`app_admissions` responses, and assignment-reader results. The fixture user is `946c81d0-f5c8-4c81-a7c0-a3e96b08df2e` with `fixture@example.test`; the synthetic assigned Table and venue IDs are fixed in the tests. This verifies trust-boundary composition without creating `auth.users`, inserting role rows, or resetting either database. The schema currently has no Table/venue assignment tables; `noResourceAssignments` therefore denies all host/restaurant resource actions by default. W08 owns the real assignment schema and subsequent isolated local DB fixtures. Existing RLS/grant checks remain read-only and both local audit tables remain empty.

Use the existing shared result/error envelope before shipping handlers. Admin UI must distinguish `waiting`, `sending`, provider `accepted`, `failed/unknown`, and `activated`; it must not claim delivery or activation from a send response. Retry and concurrent submission must preserve operation idempotency.

## Verification and evidence limits

W03 local acceptance covers marketing intake through admin admission, the actual intercepted Mailpit invitation link, member home, sign-out and returning-link sign-in. Its shared-Table destination is W06 work; production provider configuration and release readiness are not established by local acceptance. W04 implementation and current evidence are tracked in the task and acceptance ledgers and W04 slice report; this contract alone does not claim W04 completion.
