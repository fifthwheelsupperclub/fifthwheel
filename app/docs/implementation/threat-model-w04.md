---
id: fifthwheel-w04-profile-identity-threat-model
type: threat-model
status: active-design
date: 2026-11-12
owner: liza
related_objects: [object-guest, object-identity-review, object-guest-file]
related_evidence: [../PRD.md, ../architecture.md, ../tasks-checklist.md, acceptance-ledger.md, integration-contract.md]
related_decisions: []
---

# W04 profile and identity evidence threat model

## Scope

This threat model was drafted before W04 implementation. The control table below records design-time expectations, not current completion status. Use the current [W04 slice report](w04-slice-report.md), [task ledger](task-ledger.md), and [acceptance ledger](acceptance-ledger.md) for implementation evidence and remaining gaps.

This model covers the local and intended hosted profile-editing, photo/selfie upload, submission, admin identity-review and retention flows in W04. It includes the member browser, TanStack server routes/services, Supabase Auth, private Supabase Storage, Postgres/RPCs, admin review UI, audit records and scheduled evidence deletion. Local development uses synthetic `.test` identities; browser tests must use the isolated `fifthwheel-rewrite-test` project and Mailpit.

Actors are a member viewing their own account, a different admitted member, an anonymous or uninvited Auth user, an admin reviewing a profile, an assigned host, a restaurant operator, and a compromised browser holding a short-lived upload/download grant. Hosts and restaurant operators have no identity-evidence access. An admin needs a specific review purpose. A successful photo review means only manual identity review; it does not establish government ID or background-check verification.

## Assets and data inventory

| Asset or data | Classification | Store / flow | Retention |
| --- | --- | --- | --- |
| Name, date of birth, own identity, open-to set, matching-age range | Sensitive personal data | Member form → authorized server → private Postgres; limited review/curation use | Profile lifecycle; financial/audit obligations follow approved release policy |
| Phone, one-liner and optional profile preferences | Personal data; potentially sensitive free text | Member form → profile service → private Postgres | Profile lifecycle; minimize and allow edits |
| Profile photos and separate selfie | Highly sensitive visual evidence | Browser → owner-scoped upload grant → private quarantine/normalization → private Storage; admin opens a short-lived read grant | Engineering proposal: unsubmitted/superseded 7 days; submitted evidence 30 days after final review |
| Review version, outcome, reviewer, correction reason, evidence received/deleted markers | Restricted identity-review record | Private Postgres transaction and append-only audit | Review decision retained without image bytes; exact policy needs release-owner confirmation |
| Signed upload/read URLs | Bearer capability | Returned only to the owning member or authorized reviewer after audit | Maximum 5 minutes; never persist in audit, email, logs, shared DTO, cache or analytics |
| Profile/review revisions and pending future-offer revalidation | Authorization/eligibility state | Transactional profile service and later roster operations | Persist until superseded/obligations resolved |

## Trust boundaries

1. **Browser to app server:** all profile fields, expected versions, media metadata and object IDs are caller-controlled. The server derives member identity from a verified Auth session. It never accepts a caller-supplied owner ID, role, approval state, evidence path or review actor as authority.
2. **App server to Postgres:** privileged service operations are constrained by explicit server authorization and transactional RPCs. RLS/grants deny anonymous and ordinary authenticated direct writes to profile review state and evidence metadata. Service-role keys remain server-only.
3. **Browser to Storage:** upload permission is a narrow, short-lived, create-only grant for one random path under the authenticated owner and one upload intent. Bucket/object access through direct anon/authenticated Storage APIs stays denied. Completion rechecks ownership, one-time intent state, size, detected format, image signature, decode/normalization outcome and expected profile/identity versions. A completed object cannot be overwritten or replayed into a second file.
4. **Review UI to private evidence:** authorization is admin-only and purpose-limited; the evidence-open audit is persisted before a ≤5-minute URL is returned. Immediately before signing, the server rechecks the exact file IDs and current submitted identity version. Responses are `private, no-store`, set `Referrer-Policy: no-referrer`, and never embed URLs in page preload or shared DTOs. A host, restaurant, member, waitlist-only identity or guessed UUID cannot use this path.
5. **Worker to retained evidence:** deletion is idempotent and checks review/version state. Purging bytes records a durable deletion marker; it does not silently invalidate an unchanged approved profile. A critical profile edit requires new evidence and review.

## Abuse paths

| Attacker goal | Path | Impact | Likelihood | Uncertainty |
| --- | --- | --- | --- | --- |
| Read another member’s private images or profile | Change profile/file UUID, call direct Storage/Data API, reuse another owner’s path, or call review endpoint as a non-admin | Exposure of DOB, identity and intimate photos/selfie; loss of trust and potential safety harm | Medium without strict owner checks at every layer | Private bucket, policies, upload-intent binding and route checks are not yet verified |
| Upload malicious or misleading evidence | Spoof MIME/extension, oversized/decompression-bomb image, malformed image, HEIC, EXIF GPS/device data, replay or overwrite a signed upload grant, or complete another user’s upload intent | Resource exhaustion, harmful content, location/device disclosure, false review state | Medium | Decoder CPU/memory/pixel bounds, create-only storage behavior and original cleanup require implementation evidence |
| Approve stale or altered profile | Submit an old review revision after critical fields/evidence change; replay an old decision; race edit against approval or payment eligibility | Wrong person or stale evidence receives approval and may become eligible for offers/payment | Medium | Requires shared transaction/CAS across edit, submit and decision plus a W07 server check that approvedIdentityVersion=current identityVersion |
| Leak a bearer URL | Put signed URL in SSR data, logs, audit, browser history, email, cache, analytics or copied error output | Anyone holding URL can view private evidence until expiry | Medium | Short expiry limits duration but does not undo disclosure; every URL sink must be inspected |
| Bypass review while retaining an approved badge | Directly patch `approved`, change DOB/identity/evidence without version invalidation, or manipulate client cache | Ineligible or unreviewed member proceeds as approved | Medium | Payment and later eligibility gates are not yet implemented; server remains the authority |
| Retain evidence longer than intended or delete it too early | Worker fails silently, deletes without audit/marker, retries against wrong owner, or purges before current review | Excess privacy exposure, or loss of necessary evidence / incorrect profile re-review | Medium | Retention is an engineering default, not human/legal approval; worker and monitoring are pending |

## Privacy risks

- **Collection:** DOB and identity are required for eligibility/review; phone, one-liner and lifestyle preferences are optional. Collect no government ID, background-check claim or unnecessary image metadata. Reject unsupported HEIC rather than retaining an unnormalized original.
- **Inference and use:** identity, open-to preferences and matching ages support eligibility and mutual matching only. Do not widen preference sets or infer a person’s identity/attraction from choices. A review decision is not a dating-quality assessment.
- **Sharing:** other members receive only authorized public/profile presentation after approval; hosts get only first name and attendance-relevant context for assigned Tables; restaurants get counts/authorized service context. Neither partner role receives DOB, preferences, selfie or review notes. Admin access is purpose-limited and audited.
- **Retention and deletion:** evidence images are temporary. Approval must keep minimal evidence-received/deleted markers and reviewer/version/outcome so an unchanged approved profile remains complete after scheduled purge, including review+31-day checkout. The precise retention/default copy must be confirmed by the release owner before public launch.
- **Access and consent:** clearly state which images are private, what admin review does, why identity/preferences are requested, who can review, and when evidence is deleted. Avoid implying image publication to other members or government/background verification.

## Controls

| Control | Verified / assumed / recommended | Boundary |
| --- | --- | --- |
| Verified session and admission gates; separate server-authorized staff roles | Verified for W03 local flows | Browser → app server |
| Private profile/review schema, owner checks, admin-only review checks and versioned decision transactions | Recommended; W04 implementation pending | Server → Postgres |
| Anon/authenticated PostgREST SELECT/INSERT/UPDATE/DELETE denied for private profile, review and file metadata; direct Storage object reads/writes denied | Recommended; W04 implementation pending | Data API and Storage policies |
| Private bucket, random owner-scoped object paths and create-only, single-use upload intents; successful completion consumes intent, and replay/overwrite is rejected | Recommended; W04 implementation pending | Server ↔ Storage |
| JPEG/PNG/WebP allowlist, byte/signature/decode checks, ≤8 MiB each, six profile photos maximum plus one separate selfie; bounded dimensions/pixels/CPU/memory, quarantine original, normalized-only reviewer objects, scoped original cleanup and EXIF stripping | Requirements are specified; implementation pending | Browser/Storage → normalization service |
| ≤5-minute signed reads returned only after immutable review-access audit and immediate current-version/file-state recheck; private/no-store and no-referrer response | Architecture requirement; implementation pending | Admin review → Storage/browser |
| No signed URL or raw media path in audit, email, logs, analytics, SSR/preload or shared DTOs | Recommended and test-required; implementation pending | All server/browser outputs |
| Expected profile/review version on save, submit and decision; critical edits invalidate review; preference-only change revalidates future offers | Requirements specified; transaction proof pending | Profile/review → eligibility |
| Save, submit, decision and payment eligibility serialize/CAS on profile, identity and review versions; W07 checks approvedIdentityVersion=current identityVersion server-side | Recommended; implementation spans W04/W07 | Profile/review → checkout |
| Evidence deletion writes durable marker using version-safe, idempotent cleanup; unchanged approved profile remains complete; critical edit requires fresh evidence | Requirements specified; worker/purge tests pending | Retention worker → profile state |
| Direct anon/member/host/restaurant API and Storage access denied, including guessed UUID paths | Required; W04 independent security tests pending | Data API and Storage policies |

## Prioritized mitigations

1. **Before member upload is enabled:** implement database-bound owner and upload-intent checks plus private bucket policies; verify a second member, anon, host and restaurant cannot read/write another owner’s objects through both app routes and direct Storage API.
2. **Before review is enabled:** ensure current submitted version and review decision update serialize with critical profile edits. Reject stale submissions and approvals; audit reviewer access before minting a short-lived read URL.
3. **Before image reaches review:** decode and re-encode JPEG/PNG/WebP with bounded dimensions/resource use, strip EXIF, reject unsupported/corrupt/oversize uploads, and delete abandoned originals through a scoped idempotent job.
4. **Before profile is used for booking:** server-check current approved version and evidence markers; critical change blocks payment until new evidence/review, while preference-only change revalidates future offers without falsely requiring identity re-review.
5. **Before public release:** confirm retention period and consent language with the accountable owner, run delete/retry/recovery and backup-expiry rehearsal, monitor purge failures independently, and verify no private evidence or signed URL appears in client bundles, SSR payloads, logs or audit rows.

## Assumptions

- Synthetic local Auth users and Mailpit are the only identities/email used during development; no live profile or image data is accessed.
- Supabase Storage is the documented object store; image normalization may require a separately verified local-capable library or server service.
- Retention intervals in the architecture are proposed engineering defaults and remain subject to human policy review.
- This model identifies implementation controls to verify; it is not evidence that W04 has already implemented or passed them.

## Open questions

- Which image decoder/normalizer can run within local and hosted resource limits, and is any malware scanning available/required before reviewers open files?
- Who approves public consent and retention wording, and how will deletion failures be surfaced to an independent operator?
- Does the hosted project permit the needed private bucket, signed upload policies and short-lived read URLs without exposing service credentials to the browser?
