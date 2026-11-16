# Fifthwheel MVP — Product Requirements

Version 3 · 2026-11-11 · Fresh-rewrite requirements baseline. This document records inherited policies and the explicit clarifications below; it does not claim a finished app, approved screen designs or release authorization.

## 0. Version 4 change (2026-11-16): no approval steps

Version 4 removes every staff approval before an invitation (`knowledge/decisions/staff-place-guests-directly.md`). Where this section conflicts with anything below, this section wins.

- **Waitlist → queue.** Joining the waitlist queues a confirmation email and adds the person to a staff placement queue. Test submissions and the legacy import send nothing.
- **No admission approval (replaces the admin-confirmed app invitation in R00, A27, A31, D14).** Access is created when an admin places the person at a Table. A placed guest signs in through the link in their Table invitation email. People on the waitlist who haven't been placed cannot sign in.
- **No photo, selfie or profile review (replaces D05, the photo/selfie and review parts of R01, A02, A33).** Profiles are form fields only, and edits take effect immediately.
- **No browsing or seat requests (replaces D02, D11, R02, A04, A05).** Guests are invite-only.
- **No roster proposal or approval (replaces R03, A06 and the host proposal role).** An admin adds one guest at a time; the invitation is queued in the same step. The hard blocks at placement are 21+ on the Table date and at most five active invitations. Mutual age ranges, the 12-year span and mutual openness are warnings the admin may override; this replaces D06's "staff cannot override". The three-guest minimum stays with the T−24 decision (D07).
- **Removal (R16).** Removal no longer suggests a replacement. Staff fill the seat from the placement queue.
- Payment, Seats, cancellations, refunds, the night of, voting and feedback are unchanged.

## 1. Purpose and authority

Deliver the complete product-app MVP: verified guest onboarding, staff-curated paid Tables, night-of attendance and private voting, post-night feedback, and staff/restaurant operations. Build a fresh app from these requirements. Preserve the previous app’s visual style; improve UI layouts, information architecture and navigation where that makes the experience more intuitive. The root Astro marketing presentation remains unchanged; its waitlist submission integration is explicitly in scope.

This packet supersedes the previous refactor instructions and the October draft for the new implementation. Historical documents remain unchanged under [reference](reference/README.md), and the previous app is preserved in the [local archive](../../archives/README.md). Prior review approval does not certify this revised packet. [Architecture](architecture.md), [Flow/UI](flow-ui-brief.md), [Backlog](tasks-checklist.md) and [Review](review-disposition.md) must agree with this PRD. The user has authorized implementing the coordinated rewrite plan; the first visual review and other release boundaries remain governed by the run packet.

Explicit current-chat decisions: app access is invited from the marketing waitlist; Table invitations are separate; admitted members may request future magic links; app preferences match the marketing form’s exact selections; account suspension is deferred; previous visual styling is preserved while UI, information architecture and navigation may improve. Other product policies below are carried forward from the prior documented MVP, not newly invented during the reset.

### Decision record

| ID | Current decision | Earlier material affected |
| --- | --- | --- |
| D01 | Complete the MVP, including persisted night-of workflows. | Earlier refactor-only non-goals. |
| D02 | *Superseded by §0 (v4):* staff place guests from the waitlist queue; the invitation enables payment. ~~Guests browse published Tables and request a Seat; staff approve composition before invitations enable payment.~~ | Clarifies `knowledge/decisions/staff-approve-before-invites.md`; replaces open browse/pay ambiguity. |
| D03 | Table invitations stay open until revoked or the Table closes. Checkout holds and authentication links have independent expiry rules. T−2-day unpaid reminder. | Preserves `invitations-do-not-expire.md`; replaces current two-hour invite reservation. |
| D04 | Guests request cancellation. Staff confirm removal and decide full/partial/no refund; Table cancellation refunds all remaining paid amounts. | Resolves proposed `refunds.md`; replaces current automatic timed tiers. |
| D05 | *Superseded by §0 (v4):* no photo/selfie review. ~~Staff review identity photos/selfie before payment.~~ | Resolves verification-gate uncertainty. |
| D06 | 21+, age from DOB on Table date; mutual age ranges for every pair; span ≤12 years; 3–5 guests; each guest has at least one mutually open connection. Staff cannot override hard rules. | Replaces prototype ten-year scoring constraint; preserves accepted age rules. |
| D07 | T−24-hour staff alert and mandatory staff cancellation below three paid guests; 3–5 may proceed if valid. | Resolves proposed `table-cutoffs.md`. |
| D08 | Checked-in paid guests choose one eligible attendee or nobody, during [start+90m, start+120m); reveal only own mutual result after close. | Resolves eligibility, ballot and reveal questions in `voting-window-mutual-only.md`. |
| D09 | Ratings and private conduct reports; no chat or contact exchange. | Replaces prototype chat/outcome controls. |
| D10 | Supabase owns core guest/transaction/night-of records; Airtable owns Table and venue supply. | Replaces earlier Airtable-primary architectural assumption. |
| D11 | Friend shares a Table URL; friend applies through normal review. No reserved Seat. | Replaces guest-created Table hold/invite send. |
| D12 | $25 USD checkout, email notifications, America/New_York time, no rescheduling. | Explicit hand-off defaults from approved plan. |
| D13 | Historical single-choice preference decision is superseded by D16. Own identity remains one Woman / Man / Non-binary choice. | Retained as history; do not implement the old Women / Men / Everyone restriction. |
| D14 | Admin invites a marketing waitlist member into the app first; a separate later Table invitation enables that Table’s checkout. | Explicit human clarification in this chat. |
| D15 | Admitted members may request new magic links for later sign-ins without another admin invitation. | Explicit human clarification in this chat. |
| D16 | App preferences use any non-empty combination of Women, Men and Non-binary people, matching marketing. Preserve exact selections. | Explicit human decision; supersedes D13’s preference menu and migration restrictions. |
| D17 | Member access continues once admitted; account suspension controls are deferred. | Explicit human decision. Authentication links still expire; Table closure/revocation does not revoke membership. |
| D18 | Match the previous app’s visual style. UI layouts, information architecture and navigation may be refactored for intuition and usability. | Explicit human instructions. Visual reference is the archived app, not generic component-library defaults. |
| D19 | Matching-age preferences are whole years from 21 through 120, with the selected maximum at least the selected minimum. Apply the bound in the marketing form, member profile, server validation and database. | Explicit human decision in this chat. |
| D20 | Use one truthful, neutral success state for marketing waitlist 2xx responses. Duplicate and honeypot outcomes must not claim someone joined or that an email was sent. | Explicit human decision in this chat. |

These decisions apply within this packet. Shared historical knowledge files remain unchanged and retain their history; they must not be used to reinstate superseded behavior in this implementation.

## 2. Problem, users and outcomes

The archived app mixed real integrations and demonstration interactions behind one screen selector. A guest cannot rely on a single persisted journey from application to paid Seat to attendance and voting. Staff need a consistent record of who is approved, invited, paid, cancelled, checked in, and eligible.

Users are guests (including applicants), admins, hosts assigned to Tables, and restaurant users assigned to venues. Visitors join the existing marketing waitlist. Admin admission plus verified email is required to enter the member app; verified email alone does not admit someone. A shared Table link never bypasses admission. Guests have no staff permissions. A restaurant user has no identity-review, matching, billing, ballot, or report access.

Outcomes: a guest understands their next step and payment state; staff can curate and operate valid Tables; concurrent actions cannot oversell Seats; private ballots disclose only mutual results to the people involved; provider failures are recoverable without duplicate charges or promises of completed refunds.

### Functionality by role

| Role | Required functionality |
| --- | --- |
| Visitor / waitlist member | Submit the existing marketing form; receive honest waitlist confirmation; open admin-issued app invitation; recover an expired link without receiving unapproved admission. Minimal public shared-Table preview is permitted. |
| Admitted member / Guest | Magic-link sign-in/sign-out; own next-step home; complete/edit profile and private review evidence; track review status; browse/filter Tables; request/withdraw Seat requests; track Table invitations; pay; view own Seats, itinerary/calendar and payment/refund status; request cancellation; see night-of status; privately vote/reveal; rate the night and submit private reports. |
| Admin | Waitlist search/filter/details; select an individual recipient, preview/confirm app invitation, inspect delivery/activation and resend/retry; review identity; manage supply/publication; review applications and curate/approve valid rosters; manage Table invitations/replacements; review cancellation/refund/proceed decisions; assign staff/venues; check attendance; resolve delivery/sync/payment exceptions; review redacted audit and private reports. No access to individual ballots. |
| Assigned host | Assigned Table operational view, permitted draft/proposal work and authoritative paid-guest check-in; no app admission, identity approval, roster approval/send, refunds or ballot access. |
| Assigned restaurant user | Assigned venue service times, counts, host business contact and operational notes only. No guest identities, identity photos, payments, ballots or reports. |

### Evidence baseline (historical app only)


Observed local source: `app/package.json`, `src/routes/index.tsx`, `src/routes/staff.tsx`, `src/prototype/FifthWheelPrototype.tsx` (~7,900 lines), `src/prototype/useLiveTables.ts`, `src/lib/airtable.server.ts`, `src/lib/booking.server.ts`, `src/lib/seat-holds.server.ts`, `src/lib/guest.functions.ts`, `src/lib/require-role.ts`, `src/routes/api/public/payments/webhook.ts`, and `supabase/migrations/`.

The archived app uses TanStack Start/React/TypeScript/Vite, Airtable records, Supabase Auth/roles/storage/preferences/audit, Stripe, and notification adapters. Sample Tables, matching inputs, identity queue, attendance, vote, reveal, and chat include local/demo state. A check-before-create Airtable fulfillment sequence is not proof of concurrency-safe idempotency. These are source observations, not a verified deployed schema or production walkthrough. Earlier `knowledge/evidence/product-app-code.md` refers to a different Next.js implementation and is historical for this packet.

## 3. Requirements and acceptance

Each R ID is normative. A ID labels an acceptance scenario. Actors and technical boundaries are specified in Architecture §§3–8.

### R00 — Marketing waitlist, app admission and sign-in

The marketing form is the waitlist entry point. The fresh app must serve its existing `POST /api/waitlist` integration. Store the existing payload’s first/last name, normalized email, DOB, identity, exact open-to selections, matching ages, neighborhood, nights, looking-for, surprise-game preference, referral and source, with server receipt time. Validate required fields, a real DOB/21+ on today’s Atlanta date and matching ages as whole years from 21 through 120 with maximum ≥ minimum. Ignore client submission time for authorization/ordering. Keep personal data private. A honeypot submission creates no signup and returns a neutral response. Duplicate normalized email reuses one signup; an unauthenticated repeat must not overwrite an admitted member’s profile, preferences, admission or delivery state. Every successful response uses truthful neutral copy and does not reveal duplicate/honeypot status. New signup confirms waitlist interest only; it creates no app admission, approved profile, Table offer or Seat. Do not create a competing app-only email waitlist.

Admin can search/filter the same persisted intake, inspect necessary signup fields and app-access status, select one waitlist recipient, preview the invitation and confirm Send app invitation. Individual sending is required; bulk sending is not assumed. Record the approving admin and time, recipient, admission, email attempt and outcome durably. Distinguish waiting/not invited, sending, provider-accepted, failed/unknown and activated. Provider acceptance is not proof of inbox delivery or activation. Where delivery events are unavailable, show that limit rather than inventing a delivered/opened state. Retrying delivery must not create duplicate admission or perform any Table/payment action.

The invitation email contains a magic link that signs the verified recipient into their own admitted account and continues to onboarding/member home. Admission and authentication are separate server-enforced gates: neither a client flag, forwarded link used with another account, known email, existing Auth account nor shared Table URL grants another person’s membership. A previously existing verified account for the same email is reused only when linkage is unambiguous. Authentication tokens are expiring, single-use credentials; the configured lifetime is documented/tested during implementation and is separate from lasting app admission and non-expiring Table offers. On first successful recipient authentication, persist activation once. Do not claim first-login completion until the session and admission are verified.

Admitted members can request a fresh magic link on the sign-in page and sign out. Waiting/uninvited people receive a neutral check-email/help response without admission or a usable member session. Rate-limit link requests/sends and prevent account enumeration. Used, expired, malformed and failed links show a recoverable sign-in state; resend does not require another admission approval. Preserve only validated internal destinations through sign-in/onboarding, including a shared Table destination. Member home shows the actual next action and honest empty states. Admission continues without scheduled expiry; no member-suspension feature in this MVP. Account deletion through the existing privacy/support procedure ends that account’s access and is distinct from administrative suspension. Admin role provisioning is a trusted operator step documented and tested separately; admission never grants staff permissions.

- **A26:** a valid existing marketing payload persists once and appears in the admin waitlist; invalid/underage input stores nothing; duplicate/honeypot submissions grant no access, do not overwrite member data, and get the same neutral success state without claiming list admission or email delivery. Matching ages outside 21–120 or with max<min are rejected.
- **A27:** only an authorized admin can confirm an app invitation to a persisted waitlist recipient. Repeated/concurrent submit with the same operation creates one admission/logical send. A normal member, host, partner or anonymous caller cannot invite through UI or direct API.
- **A28:** the invitation’s magic link activates and signs in the named recipient, persists across refresh, and lands on onboarding/home without a Table request, profile approval, charge or Seat. Activation replay creates no duplicate member.
- **A29:** an admitted member can sign out and request a fresh link; an uninvited verified Auth account, altered recipient ID or wrong signed-in account cannot access member data. Public response does not reveal membership.
- **A30:** expired/used/malformed links, link opened on another device, sign-in failure and a safe shared-Table continuation have explicit recovery; external/protocol-relative redirect attempts are rejected.
- **A31:** failed/unknown delivery is visible to admins; safe resend/reconciliation preserves admission and prior attempt history. Queued/provider-accepted/delivered-if-known/activated remain distinct, with no false success.
- **A32:** each non-empty subset of the three marketing preferences survives intake → profile → edit → matching unchanged. Empty/unknown identities are rejected; no unsupported value is broadened by inference. Mutual openness uses set membership in both directions.
- **A33:** home/onboarding shows the correct state for newly admitted, incomplete, submitted, resubmission-required, approved/no Tables, pending request, invited/unpaid, paid, pending cancellation and post-night guests; links lead to functioning authorized routes.

### R01 — Identity, profile and access

Require verified email and a complete profile: name, DOB, identity, open-to identities, youngest/oldest matching ages, at least one profile photo, and a separate selfie. Identity is exactly one of `woman`, `man`, `non_binary` (display Woman, Man, Non-binary). Open-to preference is a non-empty set drawn from `woman`, `man`, `non_binary`, displayed as the three independent choices Women, Men and Non-binary people. Every one of the seven non-empty combinations is supported, matching the marketing form. Own identity remains exactly one value. Mutual openness means each guest’s identity belongs to the other’s selected set; do not require equal preference sets or every pair to share attraction preferences. Never replace Women+Men with all three choices. Matching ages are whole years from 21 through 120 inclusive with max≥min. Reject under-21 onboarding using today's Atlanta date; recheck age on the Table date. Never infer DOB from historical age. Phone, one-liner and personality/lifestyle preferences are optional; no phone-verification or automated income/lifestyle exclusion in this MVP.

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

Use task URLs and role shells with deep links, refresh, back/forward and interruption recovery. Match the previous app’s visual style, using the archived `src/prototype/FifthWheelPrototype.tsx` design tokens and component recipes as the visual reference. Preserve deep brown surfaces, ivory text, gold accents, wine/sage states, Fraunces display type, Inter body type, border treatment, corner shapes, spacing rhythm, icons and control styling. The generic light/slate defaults in the archived global CSS are not the intended brand reference. New flows use this same styling. UI layouts, information architecture, grouping and navigation may change to improve usability; do not carry over prototype screen selectors, decorative preview frames, fake outcomes or old policy copy to reproduce appearance. Narrow contrast/touch-size/focus/reflow corrections are permitted and documented. Any broader visual restyling requires a separate human decision. Target WCAG 2.2 AA: semantic labels, focus, keyboard dialogs, error announcements, 4.5:1 normal text contrast, 3:1 large text/UI boundary contrast, 44px primary touch controls, reduced motion, reflow at 320 CSS px and 200% text zoom. Render loading/empty/error/permission/pending states on every data-dependent route.

- **A25:** keyboard-only happy path, focus return, screen-reader form/errors, mobile/desktop reflow and long text pass feature acceptance; no screen index, preview frame or demo navigation in production.

- **A34:** representative member and admin screens are compared side-by-side with the archived visual reference on phone and desktop. Typography, palette, surfaces, component treatment and spacing remain recognizably consistent; permitted usability/IA/navigation changes and accessibility corrections are recorded. Matching colors alone is insufficient.
- **A35:** end-to-end guest and admin journeys are reachable through understandable persistent navigation and direct URLs. Unauthenticated, uninvited, member and staff gates show the appropriate next step. No visible active control is a placeholder, no route depends on a screen index, and no production page substitutes sample data when a service fails.

## 4. Scope limits and delivery measures

No member suspension, bulk app admission, visual rebrand, chat, contact sharing, rescheduling, Stripe Identity, phone OTP, public self-serve payment, automatic timed cancellation tiers, arbitrary guest-created seat holds, synthetic matching scores, new hosting platform, marketing presentation edits, numeric business targets or launch-date commitment. Optional profile fields do not become eligibility filters.

Success for this hand-off is traceable R00–R11 coverage, acceptance A01–A35 mapped to tasks, independent review dispositions and explicit evidence debt. Success for MVP delivery is all release-gating scenarios passing against the implemented system and a reconciled migration. Admin owns operational unresolved queues; development owns contract/recovery checks; human release owner authorizes cutover.

## 5. Implementation defaults and evidence debt

This baseline supplies the documented product direction, subject to the current requirements-only hold. Engineering defaults below make the implementation bounded; they are not claims of user research: 30-minute card checkout holds; admin-only identity/roster approval/refunds; host-assigned attendance; no late ballot entry; draft-only safe clone undo; no schedule edits after first invitation; email retries and scheduler tolerances in Architecture. Freeze eligibility on the server at opening, using attendance timestamps if the scheduler is late.

Deployment/provider configuration, actual Airtable schema/content quality, existing Stripe modes/payment history, existing Supabase RLS/storage settings, and the hosting scheduler remain unverified external facts. They block production cutover, not local development. [Review disposition](review-disposition.md) owns the current readiness decision.

## 6. Readiness and remaining evidence

The known functional gaps from the reset review are addressed by D14–D18, R00 and A26–A35. A complete requirement/task mapping is necessary for the rewrite; passing documentation checks is not evidence that application behavior works.

External evidence remains: actual waitlist store/import inventory, email sender/redirect/delivery configuration, trusted admin setup, Airtable dictionary/sync, Supabase permissions/backups, Stripe modes/history, scheduler/hosting and production data reconciliation. Those tasks have explicit discovery and release gates in the backlog. They must not be guessed. Final legal/cancellation/retention copy and the release operator remain launch dependencies, not a claim that functional product choices are still open. No deployment, live email or charge is authorized by this packet.
