# Fifthwheel MVP — Product Requirements

Version 2 · 2026-11-11 · Product decisions approved in the hand-off planning conversation; implementation not started.

## 1. Purpose and authority

Deliver the complete product-app MVP: verified guest onboarding, staff-curated paid Tables, night-of attendance and private voting, post-night feedback, and staff/restaurant operations. Refactor the existing app while implementing the missing workflows. The root Astro marketing site is outside scope.

This packet is the current project-local specification for this implementation. The human approved the plan in this chat on 2026-11-11. It replaces the earlier structural-refactor-only drafts. It does not claim production readiness or deployment authorization. [Architecture](architecture.md) defines contracts; [Flow/UI](flow-ui-brief.md) defines experience; [Backlog](tasks-checklist.md) defines delivery and verification; [Review](review-disposition.md) records independent findings and evidence debt.

### Decision record

| ID | Current decision | Earlier material affected |
| --- | --- | --- |
| D01 | Complete the MVP, including persisted night-of workflows. | Earlier refactor-only non-goals. |
| D02 | Guests browse published Tables and request a Seat; staff approve composition before invitations enable payment. | Clarifies `knowledge/decisions/staff-approve-before-invites.md`; replaces open browse/pay ambiguity. |
| D03 | Invitations stay open until revoked or the Table closes. Only checkout holds expire. T−2-day unpaid reminder. | Preserves `invitations-do-not-expire.md`; replaces current two-hour invite reservation. |
| D04 | Guests request cancellation. Staff confirm removal and decide full/partial/no refund; Table cancellation refunds all remaining paid amounts. | Resolves proposed `refunds.md`; replaces current automatic timed tiers. |
| D05 | Staff review identity photos/selfie before payment. | Resolves verification-gate uncertainty. |
| D06 | 21+, age from DOB on Table date; mutual age ranges for every pair; span ≤12 years; 3–5 guests; each guest has at least one mutually open connection. Staff cannot override hard rules. | Replaces prototype ten-year scoring constraint; preserves accepted age rules. |
| D07 | T−24-hour staff alert and mandatory staff cancellation below three paid guests; 3–5 may proceed if valid. | Resolves proposed `table-cutoffs.md`. |
| D08 | Checked-in paid guests choose one eligible attendee or nobody, during [start+90m, start+120m); reveal only own mutual result after close. | Resolves eligibility, ballot and reveal questions in `voting-window-mutual-only.md`. |
| D09 | Ratings and private conduct reports; no chat or contact exchange. | Replaces prototype chat/outcome controls. |
| D10 | Supabase owns core guest/transaction/night-of records; Airtable owns Table and venue supply. | Replaces earlier Airtable-primary architectural assumption. |
| D11 | Friend shares a Table URL; friend applies through normal review. No reserved Seat. | Replaces guest-created Table hold/invite send. |
| D12 | $25 USD checkout, email notifications, America/New_York time, no rescheduling. | Explicit hand-off defaults from approved plan. |
| D13 | Keep one own identity (Woman / Man / Non-binary) and the existing Women / Men / Everyone preference menu. No arbitrary multi-select preferences in MVP. | Human resolved the fresh-review product question on 2026-11-11; preserve existing preferences during migration. |

These decisions apply within this packet. Shared historical knowledge files remain unchanged and retain their history; they must not be used to reinstate superseded behavior in this implementation.

## 2. Problem, users and outcomes

The app currently mixes real integrations and demonstration interactions behind one screen selector. A guest cannot rely on a single persisted journey from application to paid Seat to attendance and voting. Staff need a consistent record of who is approved, invited, paid, cancelled, checked in, and eligible.

Users are guests (including applicants), admins, hosts assigned to Tables, and restaurant users assigned to venues. Visitors may view the app entry and join its waitlist; the booking journey begins with verified email. Guests have no staff permissions. A restaurant user has no identity-review, matching, billing, ballot, or report access.

Outcomes: a guest understands their next step and payment state; staff can curate and operate valid Tables; concurrent actions cannot oversell Seats; private ballots disclose only mutual results to the people involved; provider failures are recoverable without duplicate charges or promises of completed refunds.

### Evidence baseline

Observed local source: `app/package.json`, `src/routes/index.tsx`, `src/routes/staff.tsx`, `src/prototype/FifthWheelPrototype.tsx` (~7,900 lines), `src/prototype/useLiveTables.ts`, `src/lib/airtable.server.ts`, `src/lib/booking.server.ts`, `src/lib/seat-holds.server.ts`, `src/lib/guest.functions.ts`, `src/lib/require-role.ts`, `src/routes/api/public/payments/webhook.ts`, and `supabase/migrations/`.

The local app uses TanStack Start/React/TypeScript/Vite, Airtable records, Supabase Auth/roles/storage/preferences/audit, Stripe, and notification adapters. Sample Tables, matching inputs, identity queue, attendance, vote, reveal, and chat include local/demo state. A check-before-create Airtable fulfillment sequence is not proof of concurrency-safe idempotency. These are source observations, not a verified deployed schema or production walkthrough. Earlier `knowledge/evidence/product-app-code.md` refers to a different Next.js implementation and is historical for this packet.

## 3. Requirements and acceptance

Each R ID is normative. A ID labels an acceptance scenario. Actors and technical boundaries are specified in Architecture §§3–8.

### R01 — Identity, profile and access

Require verified email and a complete profile: name, DOB, identity, open-to identities, youngest/oldest matching ages, at least one profile photo, and a separate selfie. Identity is exactly one of `woman`, `man`, `non_binary` (display Woman, Man, Non-binary). Open-to preference is exactly one of `women`, `men`, `everyone` (display Women, Men, Everyone): women permits woman, men permits man, everyone permits all three identities. Both fields are required; no empty/unknown or inferred values. Mutual openness means each guest's identity belongs to the other's permitted set; Non-binary-specific or arbitrary combination selection is outside this MVP per D13. Matching ages are whole years ≥21 with max≥min. Reject under-21 onboarding using today's Atlanta date; recheck age on the Table date. Never infer DOB from historical age. Phone, one-liner and personality/lifestyle preferences are optional; no phone-verification or automated income/lifestyle exclusion in this MVP.

Persist staff review as pending, approved, or resubmission required. Admin reviews identity; assigned hosts see only operational guest context. A change to DOB/identity/photo/selfie requires renewed review; changing matching preferences triggers revalidation of future offers. Photo review is a manual check, not a claim of government-ID or background verification.

- **A01:** unverified email cannot submit a Seat request, access another guest's records, or pay; expired sign-in links offer a new link and safe continuation.
- **A02:** missing/invalid DOB, invalid age range, missing photos/selfie or unapproved identity blocks payment with an actionable explanation. Review persists across devices. Historical age without DOB requests completion. Required photos/selfie are checked on submission; an approved unchanged version remains complete after scheduled evidence deletion, including checkout at review+31 days. A new critical edit requires new review evidence.
- **A03:** owner can access private uploads; another guest, host, restaurant user and anonymous caller cannot. Admin review access is logged without image URLs/content in audit.

### R02 — Published Tables and Seat requests

Verified guests with approved profiles browse published future Tables using date/neighborhood filters, view itinerary and $25 price, and request a Seat. A shared Table link preserves destination through onboarding. A request is neither an invitation nor a confirmed Seat; allow one active request per guest per Table. Guests can withdraw an unpaid request; staff may decline it with a safe explanation. A full Table can collect requests for staff replacement consideration but cannot promise availability.

- **A04:** direct URL, refresh/back and sign-in return preserve the selected Table. Failed sync/query shows cached published supply or service error, never purchasable sample data.
- **A05:** repeated request creates one active application; pending request says “Request received — awaiting review,” with no Pay control.

### R03 — Composition approval and invitations

Staff select 3–5 eligible applicants for one versioned roster. Calculate age on the Table date, enforce mutual age inclusion for every pair, age span ≤12 and at least one mutually open connection for each guest. Do not require every pair to share attraction preferences. Recommendations only rank already eligible candidates; the MVP uses deterministic queue order (request time then UUID) as its baseline recommendation, not synthetic temperament scores.

Admin approves the full roster; assigned host can propose and review but cannot approve/send. Approval records actor, revision and validation result and enqueues one invitation per selected guest. Invalid or stale revisions send none. Invitations do not expire; they can be revoked, converted by payment, or closed with the Table. They grant payment access only to the named signed-in guest. No more than five active roster members (invited/paid) at once. Roster membership is a curation constraint, distinct from a temporary checkout hold.

- **A06:** invalid composition or concurrent profile/roster change rejects approval atomically; no invitation/send is committed. Retrying approval produces no duplicate invitations.
- **A07:** T−48-hour reminder identifies active invitations with no confirmed Seat; it changes no invitation state. A guest who opens a link after a checkout hold expired still has the invitation and can retry if eligible.
- **A08:** guest sharing sends only a normal Table URL through native share/copy, not an app-generated invitation or hold. Recipient follows the same application gates.

### R04 — Checkout, capacity and payment

Named invited guest pays $25 USD using Stripe card checkout after identity and roster checks. Server owns price, currency, environment, return URL and recipient identity. Checkout holds last 30 minutes; starting/retrying does not indefinitely extend a live hold. Paid Seats plus active checkout holds never exceed five. Seat confirmation requires verified Stripe paid state and successful durable Seat allocation.

- **A09:** two simultaneous checkout attempts for the final available slot allocate at most one active hold. Repeated checkout and webhook/return requests create at most one paid Seat per guest/Table and one fulfillment per Stripe payment.
- **A10:** processing/failed/abandoned checkout cannot show a confirmed Seat; the guest has a retry/My Seats/support path. A failed checkout releases its hold without revoking the invitation.
- **A11:** payment arriving after hold expiry, invitation revocation or Table cancellation either safely fulfills an eligible available Seat under the same lock or records payment and a full-refund obligation. It never oversells or silently drops a charge. UI says “Payment received; refund pending” when fulfillment is impossible.
- **A12:** payment succeeds but email fails: Seat remains confirmed, delivery is retried and visible to staff. No extra charge or Seat on retry.

### R05 — My Seats, cancellation and refunds

My Seats shows pending payments, confirmed Seats, cancellation requests, cancelled Seats, and refund status separately. One active cancellation request per Seat. Requesting does not release capacity or change voting eligibility by itself. Admin reviews, records a reason and full/partial/no refund decision; an assigned host can flag the request but cannot move money. On admin-confirmed removal the Seat is released even if the refund provider is unavailable; money owed remains a durable obligation. A denied cancellation leaves the Seat confirmed and notifies the guest. “Active paid” includes confirmed, cancellation_requested and completed Seats with verified payment that have not been removed/cancelled; pending review preserves paid count, occupied capacity, check-in, voting and historical feedback rights. Table lifecycle/time gates still apply.

- **A13:** cancellation request retains Seat until admin approves removal; repeated review is idempotent. Guest sees request and final decision. A refusal includes safe rationale. A checked-in guest with a pending request at vote opening remains eligible; denying the request afterward does not alter that snapshot.
- **A14:** admin refund is integer USD cents from zero through unrefunded paid balance; full means that balance. Concurrent refunds cannot exceed it. Retry after timeout uses the same operation key. Pending/failed refund stays visible for reconciliation; no “Refunded” label until Stripe confirms success.
- **A15:** Table cancellation closes applications/offers, blocks new checkout, releases holds and Seats, and records full remaining refund obligations for all charges, including delayed payment events. Retrying cannot issue excess refunds.

### R06 — Table operations, minimum and replacements

Staff manage supply through Airtable-backed app tools: create/edit draft Table, link three itinerary stops, publish, preview/clone/undo a week of drafts. Approval uses a stable supply revision. No in-place rescheduling of Tables with invitations/paid Seats; use cancellation and a new Table. At T−24h an alert requires admin review. Fewer than three paid guests must be cancelled by staff; 3–5 may proceed if the paid roster passes matching rules. Without a valid proceed decision at/after T−24h, payment stays paused and the UI says staff review pending. A loss of validity after proceed suspends it and alerts admin; guest activity is blocked until resolved. No automatic Table cancellation.

On confirmed removal, show “Replace with [name] from the waitlist?” using one eligible existing guest/application; Yes revalidates under lock and sends one invitation; No removes without sending. An email-only signup is not eligible until verified, profiled and identity-approved. Never guess missing age/preferences. No safe suggestion means no replacement action; removal still succeeds. A roster below three can retain drafts but cannot send a new invitation until an approvable 3–5 composition exists.

- **A16:** T−24h warning is durable and persists until admin cancels or records valid proceed. After the checkpoint, no checkout while decision is pending. Under-three cannot be marked proceed.
- **A17:** simultaneous removal/replacement or stale suggested guest revalidates; an invalid replacement sends nothing. Original guest's offer/hold cannot be used after removal; money handling follows R05.
- **A18:** restaurant user sees only assigned venue's upcoming Table service times, count, host contact and operational notes; no DOB, photos, matching, ballots, payments or reports. Host can check in only paid guests on assigned Tables.

### R07 — Attendance, vote and reveal

Use scheduled start in America/New_York, stored as a UTC instant. Staff/assigned host marks attendance. At start+90 minutes freeze the ballot eligibility set to checked-in guests with confirmed paid Seats on a valid proceeding Table. Self-check-in may request help but is not authoritative attendance. Late arrivals after freeze cannot vote/appear in that ballot. Removing/cancelling an eligible Seat invalidates its ballot participation and any mutual pair involving it; do not add new candidates after freeze.

Ballot choices are one other eligible guest or explicit Nobody. One immutable submitted ballot per guest/Table. Draft selection is local; submission persists. Voting accepts requests at open instant and rejects at or after close instant using database time. Reveal is after start+120m, independent of all guests submitting. Each guest sees only their own mutual pair or “No mutual connection this time”; no tallies, one-sided interest, selected outcome controls or other guests' results. Finalize durable own-only mutual results after close before the 30-day ballot purge; reveal remains available until start+90 days, then explicitly unavailable. Removal/account deletion invalidates both sides of an affected result.

- **A19:** uninvited, unpaid, unchecked-in, late-check-in, removed guest or another Table's guest cannot submit/read ballots. At 89:59 reject; 90:00 accept; 119:59 accept; 120:00 reject. Same submitted choice can replay; a different second submission conflicts.
- **A20:** no reveal before close. At close, A→B and B→A reveals B to A and A to B only. Nobody, non-submission or one-way choices yield the same private empty result. Staff and restaurant UI/API cannot list ballot selections.

### R08 — Feedback and conduct

After vote close, paid attendees can submit one editable rating record per Table: required overall score 1–5, optional scores 1–5 for each itinerary venue and optional note up to 2,000 characters. Conduct reports are separate, private, up to 4,000 characters, with optional subject chosen from actual attendees. Receipt is not a promise of immediate response; show support contact and emergency guidance without claiming real-time monitoring. Admin can triage report status; hosts/restaurants cannot read reports. No in-app chat or contact exchange.

- **A21:** rating persists/reloads without duplicate rows. Report receipt persists; report text and reporter are absent from guest/venue lists and standard audit payloads.

### R09 — Staff tools, notifications and delivery

Explicit staff tools cover supply, requests/matching, identity review, waitlist, assigned host operations, cancellations/refunds, email delivery/retry, and admin audit/report triage. Publish/approve/cancel/refund/send use confirmation and durable audit outcomes. Email is the MVP channel; no dependency on live SMS. Table assignment permissions are UUID-based, not the current free-text venue string.

- **A22:** notification and due-job replays do not create duplicate logical actions; provider uncertainty is visible. Admin retries failed delivery without repeating approval/payment/refund. Unauthorized RPCs fail even when UI is bypassed.

### R10 — Architecture, migration and release

Supabase owns identities, applications, rosters, invitations, holds, Seats, payments/refunds, attendance/votes/feedback and audit. Airtable owns supply title/date/time/venue/itinerary/draft publication intent; synchronized Supabase supply is the app read model. Financial/operational lifecycle cannot be overwritten by Airtable. No public-demo data in production.

- **A23:** interrupted/partial sync cannot delete published supply or overwrite runtime lifecycle. Duplicate imports preserve UUID mappings. Missing upstream row becomes a conflict for review, not automatic cancellation/deletion.
- **A24:** migrate with count, linkage, payment/refund balance and unresolved-identity reconciliation; rehearse cutover and rollback. Unmatched identity/DOB/payment rows are quarantined with named remediation, never silently merged or converted.

### R11 — Usability and accessibility

Use task URLs and role shells with deep links, refresh, back/forward and interruption recovery. Preserve warm dark/brown/ivory/gold visual direction. Target WCAG 2.2 AA: semantic labels, focus, keyboard dialogs, error announcements, 4.5:1 normal text contrast, 3:1 large text/UI boundary contrast, 44px primary touch controls, reduced motion, reflow at 320 CSS px and 200% text zoom. Render loading/empty/error/permission/pending states on every data-dependent route.

- **A25:** keyboard-only happy path, focus return, screen-reader form/errors, mobile/desktop reflow and long text pass feature acceptance; no screen index, preview frame or demo navigation in production.

## 4. Scope limits and delivery measures

No chat, contact sharing, rescheduling, Stripe Identity, phone OTP, public self-serve payment, automatic timed cancellation tiers, arbitrary guest-created seat holds, synthetic matching scores, new hosting platform, marketing edits, numeric business targets or launch-date commitment. Optional profile fields do not become eligibility filters.

Success for this hand-off is traceable R01–R11 coverage, acceptance A01–A25 mapped to tasks, independent review dispositions and explicit evidence debt. Success for MVP delivery is all release-gating scenarios passing against the implemented system and a reconciled migration. Admin owns operational unresolved queues; development owns contract/recovery checks; human release owner authorizes cutover.

## 5. Implementation defaults and evidence debt

The approved plan supplies product direction. Engineering defaults below make the implementation bounded; they are not claims of user research: 30-minute card checkout holds; admin-only identity/roster approval/refunds; host-assigned attendance; no late ballot entry; draft-only safe clone undo; no schedule edits after first invitation; email retries and scheduler tolerances in Architecture. Freeze eligibility on the server at opening, using attendance timestamps if the scheduler is late.

Deployment/provider configuration, actual Airtable schema/content quality, existing Stripe modes/payment history, existing Supabase RLS/storage settings, and the hosting scheduler remain unverified external facts. They block production cutover, not local development. [Review disposition](review-disposition.md) owns the current readiness decision.

## 6. Method and alternatives

Applied [Elephant Goldfish model](https://github.com/google/elephant-goldfish-model): context-led authoring, then reviewers with fresh contexts and only this packet/referenced evidence. This is a documented adaptation for four linked artifacts, not a claim to have installed or executed the full plugin workflow.

Alternatives considered with the human: structural-only refactor (insufficient for chosen MVP), current automatic refunds (replaced by staff review), invitation-only catalog (browse/request selected), fully moving supply to Supabase (Airtable ops retained), prototype voting/chat (persist voting; defer chat). The hybrid introduces synchronization complexity; the owner selected it to retain the staff supply workflow. These choices must remain visible in implementation reviews.
