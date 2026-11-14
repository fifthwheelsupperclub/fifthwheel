---
id: fifthwheel-w04-profile-identity-slice
type: slice-report
status: in-progress
date: 2026-11-12
owner: liza
related_objects: [object-guest, object-identity-review]
related_evidence: [../PRD.md, ../tasks-checklist.md, acceptance-ledger.md, quality-strategy.md, threat-model-w04.md, interface-direction.md]
related_decisions: [decision-separate-member-admission]
---

# W04 member profile and identity review — local slice report

## Outcome

The W04 core member-to-admin journey now works through the fresh app against the isolated `fifthwheel-rewrite-test` project:

1. An admitted member opens `/account/profile`; persisted marketing fields and the selected preference set are present.
2. The member saves a profile edit, refreshes, uploads a synthetic profile image and a separate synthetic selfie through the owner-scoped app upload routes, and submits the complete profile.
3. An admin opens `/admin/identity-review`, follows the current review, views the private evidence through audited short-lived links and approves that exact revision.
4. A new member session sees the approved status and the saved profile value.

This is a local functional milestone, not full W04 acceptance or production readiness. The remaining W04 quality matrix and A01–A03/A32–A35 evidence remain in the [acceptance ledger](acceptance-ledger.md).

## Routes and ownership

| Route | Behavior exercised |
|---|---|
| `/account/profile` | Read/save own profile, show exact preference selections and age bounds, upload normalized private photo/selfie, submit to review, persist review status |
| `/admin/identity-review` | List current submitted reviews |
| `/admin/identity-review/$guestId` | Read minimized current review data, fetch audited evidence links, approve the submitted revision |
| `/api/member/profile` | Cookie-authenticated no-store member read and optimistic-revision save |
| `/api/member/profile/files` and `/api/member/profile/files/$fileId/*` | Short-lived one-use upload grant, app-mediated upload, normalization/finalization, private read and removal |
| `/api/member/profile/submit` | Submit only the current complete profile revision |
| `/api/admin/identity-reviews/*` | Admin-only queue/detail/current-version decision with evidence-access audit |

The detail route exposed a parent-route outlet issue during end-to-end verification. The route now renders the queue at its index path and delegates parameterized detail paths to the child route.

## Persistence and security changes

- Added W04 profile, review and private-file schema/RPC foundation in `20261112171256_member_profile_identity_foundation.sql`.
- Added an additive profile preference validator in `20261112182657_profile_open_to_identity_values.sql`. Marketing intake retains its display-label contract; profile DTO/storage uses `woman`, `man`, and `non_binary`.
- Added an additive correction in `20261112182802_fix_profile_upload_consumption_size.sql` for the consumed-size RPC comparison.
- Added `20261112190334_allow_superseded_profile_evidence_retention.sql` after an end-to-end critical DOB edit exposed a table constraint that blocked retaining old evidence keys for scheduled cleanup. The change keeps ready files constrained to normalized objects while allowing superseded rows to retain cleanup pointers.
- All four W04 migrations applied to the named local test database without a reset. No production or hosted database was contacted.
- Profile/review/file metadata is RLS-enabled and denied to anon/authenticated Data API roles; service-role-only RPCs verify the JWT role. The evidence bucket is private, direct browser Storage writes are denied, and admin review DTOs omit member-only preferences and contact details.
- Upload/read bearer capabilities stay short-lived. Evidence read is audited before the server returns a link and the current file set is confirmed before signing.

## Verification evidence

- `pnpm typecheck` — passed.
- `pnpm test` — 139/139 passed after the W04 RPC conflict correction.
- `pnpm build` — passed.
- `git diff --check` and `node scripts/local-supabase.mjs self-check` — passed.
- `node scripts/test-profile-foundation.mjs` against isolated local test project — passed: role-denied direct Data API/storage access, exact multi-image version rebinding, post-submit revision, preference-only edit while review is open, stale-decision rejection after a critical edit, current-review resubmission/approval and version-safe evidence cleanup.
- `node scripts/run-w04-browser.mjs` against local test app `127.0.0.1:8086` and test Supabase `127.0.0.1:57421/57422` — passed 2/2: preference saves, private uploads, correction, attempt-2 resubmission, approval, the critical-edit stale-review UI conflict and anonymous denials. The runner removed its exact synthetic fixtures; PII-free audit events remain by design.
- Root cause and correction: the `decide_identity_review` RPC raised the expected stale-review conflict with SQLSTATE `40001`. The local PostgREST 14.12 request layer retried that application conflict instead of returning it. PostgreSQL logs showed repeated execution of the same conflict before the client timed out. Additive migration `20261112194713_replace_domain_conflict_sqlstate.sql` updates the 12 W04 domain-conflict RPCs to `P0001`, retaining their stable message strings so the repository returns a normal 409. The stale decision is now rejected promptly in both the DB and browser journeys.
- The same browser journey now exercises all seven non-empty open-to preference sets through the actual controls, save operation and reload, plus empty-set rejection and inverted `120/119` age-range validation. Returning the range to its already saved `21/120` state correctly disables Save because no persisted change is needed.

Screenshots captured from the integrated app:

- [Member profile, desktop](screenshots/w04-profile-desktop.png)
- [Member profile, 390px phone](screenshots/w04-profile-390px.png)
- [Member submitted state](screenshots/w04-profile-submitted-desktop.png)
- [Member correction request](screenshots/w04-profile-correction-requested-desktop.png)
- [Admin review queue](screenshots/w04-admin-identity-queue-desktop.png)
- [Admin review detail with private synthetic evidence](screenshots/w04-admin-review-detail-desktop.png)

## Known limits and next work

- The profile route now round-trips all seven non-empty combinations through save/reload and rejects an empty set in the UI. Matching behavior and combinations carried all the way through matching remain W06 evidence.
- The 21–120 preference controls work and display the selected maximum; run the complete UI/server DOB, leap-day and Atlanta-date boundary matrix.
- The DB/browser checks prove preference-only edits during a submitted review, correction-request/resubmission, approval, critical-edit invalidation and visible stale-admin conflict. Still exercise stale concurrent UI saves, cleanup worker lease recovery and the seven-/30-day boundaries.
- The browser proof uses synthetic abstract image fixtures, not member photos. The independent normalizer tests cover JPEG/PNG/WebP signature checks, EXIF removal, size and decode limits; all upload interruption, count, MIME mismatch and cross-owner role cases remain to be completed.
- Anonymous route denials, anon/member direct metadata denial, anon/member Storage denial and admin access were exercised. Assigned/unassigned host and restaurant direct evidence probes, cross-owner API attempts, keyboard-only operation, 320px width, 200% zoom, reduced motion and screen-reader review remain open.
- Public consent/retention policy, hosted Supabase settings, production sender configuration and deployment have not been verified or authorized.

## Next checkpoint

Continue W04 matrix coverage and visual/accessibility inspection, then hand off the accepted profile contract to W06. Do not mark W04 or A02/A03/A32 complete until the remaining acceptance cases are exercised in the integrated app.
