---
id: integration-fifthwheel-w06-table-invitation-delivery
type: integration-contract
status: proposed
date: 2026-11-13
owner: relay
related_objects: [object-guest, object-table]
related_evidence: [../PRD.md, ../tasks-checklist.md, w06-roster-contract.md]
related_decisions: []
---

# W06.5 Table invitation history and delivery recovery

## Boundary

App admission, Seat requests, Table Invitations, delivery attempts, checkout holds and paid Seats are distinct objects. Roster approval creates an active, non-expiring Table Invitation and one invitation email outbox message. The source Seat request remains `pending`; member history overlays the separate offer and never changes request state to imply an offer or payment. Withdrawing a request never revokes or closes its invitation. The member UI hides/clarifies request withdrawal while an active offer is shown. Only separately authorized invitation revocation/Table close may end an offer.

`app_invitation_deliveries` remains exclusively for waitlist-to-app admission. Table invitations and attempts use their own private relations, RPCs, API contracts and audit subjects.

## State and recovery rules

- Invitation state is `active | revoked | closed`. Active invitations do not expire and survive a failed, unknown or delivered email state.
- Delivery state is `queued | sending | accepted | delivered | failed | unknown`; delivery state never changes invitation state. `accepted` is provider acceptance, not inbox delivery. `delivered` is shown only when a provider event/reconciliation proves it.
- Each logical message has its own outbox row and durable attempt history. Initial offer message kind is `invitation`; T−48 `reminder_t48` messages are a separate kind and never rewrite an offer.
- Beginning an attempt claims the outbox under a row lock, increments attempt number once, records an immutable attempt ID, and leases it for five minutes. Same operation ID/outbox replay returns the existing attempt; binding that key to another action/outbox is an operation conflict. A still-live lease is busy. Expired `sending` is converted to `unknown`, never silently retried.
- Worker results are `accepted`, `delivered`, `failed`, or `unknown`. Provider timeout/outcome ambiguity becomes `unknown`; it remains blocked from resend until a worker/provider reconciliation confirms accepted/delivered/failed. Provider IDs, email addresses, message bodies, magic links and raw provider errors never enter browser DTOs or audit.
- A later provider delivery receipt may move the latest `accepted` attempt/outbox to `delivered` only when its provider message ID matches (or fills an absent accepted ID); repeated same-ID receipt is idempotent. The database adapter for this transition is service-role-only. Provider webhook signature verification and route wiring remain an integration prerequisite; callers must not invoke it with unverified events.
- Automatic retries are available only for a known `failed` attempt, use the same logical outbox/invitation and a new attempt ID, with backoff 1/5/15/60 minutes (60 minutes for attempts 4–8) and at most eight automatic attempts. Admin retry is operation-idempotent, checks expected attempt count and only requeues `failed`; it cannot resolve `unknown` or resend accepted/delivered mail. Requeue does not send email inline.
- No W06.5 service changes `app_table_invitations.state` as a side effect of queueing, sending, failing, reconciling or retrying email.

## Member history and access

`GET /api/me/requests?cursor&limit` keeps the W06.2 cursor and request history. Each item adds `tableInvitation: null | {invitationId,state,deliveryState,createdAt}`, populated by the latest Table Invitation sourced from that request. Requests with an active offer display the separate offer state and suppress the normal Withdraw CTA. Historical revoked/closed offers remain visible as history. The outbox delivery summary is safe state only; no recipient/contact/provider details are returned.

`GET /api/me/table-invitations/:invitationId` returns `MemberTableInvitationDetailDTO` with invitation ID/state/created time, safe delivery state/attempt count/last attempt time and a guest-safe Table summary plus public itinerary stops. It derives the actor from the cookie session and matches invitation `auth_user_id` and `guest_id` to the member's verified admitted profile and source request. UUID knowledge alone never grants access. This read does not require a currently approved profile, does not expose owner email/DOB/preferences/private notes, and does not grant a checkout hold. If current published supply is unavailable, it uses the request's stored title/date/time/neighborhood and returns `itineraryAvailable:false` with no invented stops.

## Admin operations

| Operation | Contract | Authorization |
|---|---|---|
| `GET /api/admin/table-invitations?cursor&limit` | Paged delivery/recovery list; each item contains invitation ID/state/time, Table ID/title/date/time/neighborhood, guest ID/display name, delivery state/count/queued/next-attempt/last-attempt/safe error code, and bounded attempt summaries. No email, provider message ID, signed link or raw error. | Verified admin only |
| `POST /api/admin/table-invitations/:invitationId/retry` | `{operationId,expectedAttemptCount}` → `{invitationId,deliveryState:'queued',attemptCount,queuedAt,nextAttemptAt}`. Exact replay returns saved result. | Verified admin only; known `failed` state only |
| `POST /api/admin/table-invitations/:invitationId/reconcile` | `{expectedAttemptCount}` → `{invitationId,deliveryState:'accepted'|'unknown',attemptCount}`. Reads Mailpit by exact attempt Message-ID plus the recipient loaded from trusted DB state. It never resends and cannot mark inbox delivery. | Verified admin only; current `unknown` attempt only |

Admin read/retry does not approve another roster, create a second invitation, change the source request, send an email, or alter Seat/payment state. Worker begin/finish/reconcile RPCs are service-role-only. The worker receives recipient identity only from the named invitation's trusted admission/profile relation, never a browser field.

## Delivery worker boundary

`begin_next_table_invitation_delivery_attempt` atomically claims the oldest due active invitation outbox item with `SKIP LOCKED`, enforces backoff/automatic-attempt bounds, and binds the attempt operation ID. The private delivery-context RPC returns only the recipient email linked through the invitation, member profile, activated admission and verified Auth identity, plus the captured Table summary. The worker uses this database context; browser-supplied email or Table copy is ignored.

Local acceptance uses a separate Table-specific Mailpit adapter that only accepts HTTP loopback provider and app origins. The one-shot local worker also rejects any non-loopback/non-HTTP `SUPABASE_URL` before it constructs a repository, so it cannot claim or update hosted outbox rows. It sends the durable outbox recipient a Table-offer link to `/sign-in?returnTo=/invitations/:id`; it does not create an Auth magic link or alter admission. Run one queued local item with `node --experimental-strip-types scripts/run-table-invitation-worker.mjs` after setting loopback `SUPABASE_URL`, `MAILPIT_URL`, `APP_ORIGIN` and a local-only `SUPABASE_SECRET_KEY`. Mailpit acceptance is reported as `accepted`, never `delivered`. A timed-out send remains `unknown`; reconciliation searches the exact attempt RFC `Message-ID` and verifies the exact trusted recipient. No match/provider outage remains durably `unknown`, visibly owned by an operator with an action to inspect provider logs or escalate through provider support. Never force `failed` or resend without authoritative provider evidence. A later provider receipt may mark an accepted attempt delivered as described above. Production email configuration and authenticated provider webhook wiring remain unverified.

## T−48 job contract and dependency

The PRD requires a T−48 reminder identifying active invitations with no confirmed Seat, without changing invitation state. Architecture requires dedupe by Table UUID, captured supply revision UUID and kind, database-clock due time, leases/`SKIP LOCKED`, idempotent per-invitation reminder outbox, late-run backfill and a persistent staff warning if a due notice was missed.

W06.5 freezes that contract but **does not enqueue or label a reminder “unpaid” yet**: no authoritative Seat/payment relation exists in the current schema. W07 must provide a typed, transactionally current `SeatStatusReader` for a named invitation, then implement the due-job query and filter out confirmed Seats. Unknown Seat state is not unpaid. Until that dependency lands, A07 remains pending and no reminder send/queue is claimed.

## Errors and recovery

Safe codes include `unauthenticated`, `forbidden`, `not_found`, `invalid_input`, `operation_conflict`, `attempt_not_retryable`, `attempt_reconciliation_required`, `attempt_busy`, and `temporarily_unavailable`. Owners receive `not_found` for another member's invitation. A transient resolver/database failure is retryable unavailable, not unauthenticated. Same operation ID/same actor/action/body is replay-safe; changed actor/body conflicts. No errors include SQL/provider text.

## Verification boundary

Required before W06.5 acceptance: member sees offer + pending request separately, active offer has no Withdraw action, own-only detail direct-ID checks, revoked/closed history, no cross-member disclosure, host/member/anonymous/admin API gates, invitation/outbox state separation, worker attempt lease/finish/unknown reconciliation, unknown resend denial, failed retry replay and changed-body conflict, safe redaction, and migration rollback. A07 acceptance remains blocked until W07's authoritative Seat-status reader and the scheduled job's late-run/dedupe evidence pass. Production sender, scheduler, provider configuration and external email remain unverified; this slice sends no email.
