---

> **Superseded 2026-11-16.** This flow was removed; staff place guests directly from the waitlist queue (`place_guest_at_table`). See [PRD §0](../PRD.md#0-version-4-change-2026-11-16-no-approval-steps). Kept as history.
id: fifthwheel-w06-browse-requests-contract
type: integration-contract
status: implemented-and-verified-locally
date: 2026-11-13
owner: liza
related_evidence: [../PRD.md, ../tasks-checklist.md, ../../../knowledge/objects/table.md, ../../../knowledge/objects/guest.md]
---

# W06.1–W06.2 published Tables and Seat requests

## Product boundary

Supabase's published Table read model is authoritative for the member app. Airtable is only an upstream supply source. A Seat request is an application for staff consideration; it is not an app admission, roster approval, Table invitation, checkout hold, payment or Seat. There is no Pay action in this slice. Members may request a Seat on a full Table without a capacity promise.

The PRD resolves the older Table object question: verified members with approved profiles may browse all published future Tables and request consideration. This is not invite-only browsing. Access to make a request remains separately gated by current profile approval.

## Read contract

- `GET /api/tables?dateFrom=&dateTo=&neighborhood=&cursor=&limit=`: cookie-authenticated, email-verified, admitted member with an approved profile; bounded filters/page. Returns `{"ok":true,"data":{"items":[...],"nextCursor":null}}` in stable Atlanta-local date/time/Table-ID order. Each summary includes server-owned `seatPriceCents:2500` and the member's latest request state, if any.
- `GET /api/tables/:tableId`: the same member receives the full guest-safe published detail. Anonymous or otherwise unadmitted callers may receive only a minimal shared-link preview (`tableId`, title, Atlanta-local date and neighborhood). A signed-in member with incomplete/unapproved profile gets a safe profile-gate result, not the full itinerary.
- Only future published revisions are readable. “Future” compares the Table's Atlanta-local date and start time to the current Atlanta-local time. Unknown, draft, unpublished, missing and past records never expose a full detail DTO. Do not substitute sample content when supply read fails.
- Member DTOs contain Table ID, title, local date/time, neighborhood, ordered public stop role/name/address/time offset/public notes, a server-owned price of 2500 cents with `currency:"USD"`, and own request state if one exists. Omit provider source IDs, host notes, drafts, roster/applicant data, private notes and internal service errors. No remaining-seat count is invented.
- Error responses use the shared `{ok:false,error:{code,safeMessage}}` form. Expected codes include `unauthenticated`, `profile_incomplete`, `not_found`, `not_future`, `invalid_input`, and `temporarily_unavailable`.

## Request contract

- `POST /api/tables/:tableId/requests` with `{operationId}` creates one `pending` request. The server derives the actor from the verified cookie principal and rechecks admission, email verification, approved profile and currently published/future Table in the transaction.
- `GET /api/me/requests` returns only the actor's own pending, withdrawn and declined requests with a safe decline explanation, sorted newest first and bounded/paginated. It requires verified app admission but not a currently approved profile, so a member can still review their history if profile review changes.
- `POST /api/me/requests/:requestId/withdraw` with `{operationId}` withdraws only that actor's pending request. It requires verified app admission but not a currently approved profile, so profile review changes do not prevent leaving a pending request. A withdrawn/declined request remains as history; reapplication creates a new request.
- Request history captures the public Table title, local date/time and neighborhood when the application is made. If the Table is later unpublished, the history still renders that snapshot with `table.isCurrentlyPublished:false` and no active Table action.
- A partial unique constraint allows one active pending request per member/Table. Concurrent or repeated requests converge on one pending record. Same operation ID plus same actor/input replays the saved result; reuse with different input is `operation_conflict`.
- Wrong-owner reads/withdrawals do not disclose the other member's row. Invalid transitions have no side effects. A request never changes a Table's lifecycle or supply pointers and never creates a roster, invitation, hold, Seat or financial record.

## Link and screen behavior

- Direct Table URLs survive refresh/back and preserve the internal destination through sign-in/profile completion. Clamp continuation to a same-app relative URL; re-read and re-authorize after sign-in.
- The shared-link preview may show only the minimal DTO. The full member detail includes the itinerary and $25 price. The primary action is `Request a Seat` for an approved member, with copy stating this is not an invitation or guaranteed Seat. Pending requests show `Request received — awaiting review` and no Pay control. Withdrawn/declined status remains in Requests.
- Requests and Tables use the existing member shell and brand treatment. My Seats remains a separate W07 destination.

## Persistence and verification

Use a private, RLS-enabled `app_table_requests` relation and service-only transaction RPCs. Do not grant anon/authenticated direct table or RPC access. Tests must exercise the actual cookie-authenticated browser request through the real local Supabase stack and intercepted data, plus rollback-only DB constraints. Include unauthorized roles, full vs minimal DTO fields, published/draft/past/unknown data, filters/cursors, shared-link continuation, duplicate/concurrent/replayed requests, withdraw/reapply, wrong-owner denial, stale state, and unchanged supply/runtime pointers. Never use hosted Supabase, live Airtable, real email or payments for these checks.

## Local implementation evidence (2026-11-13)

- Migration `20261113043146_w06_published_tables_and_requests.sql` is applied only to `fifthwheel-rewrite-test`. `node scripts/test-table-requests-db.mjs` passes rollback-only checks for service-only grants, published/future filters and cursor order, minimal preview/member DTO privacy, admission/profile gates, replay/duplicate behavior, owner-scoped withdrawal, reapply/history, unpublish snapshots, audit counts and unchanged supply pointers.
- `node scripts/run-w06-browser.mjs` passes 1/1 on the isolated app/Supabase/Mailpit stack. It exercises list filters including empty/reset, detail/itinerary, Seat request and refresh, withdrawal/reapply, own history, wrong-owner denial, anonymous/unadmitted/profile gates, and an intercepted local magic link that returns to the exact Table detail. Run-scoped synthetic Auth, admission, profile and supply records are removed; append-only PII-free audit rows remain.
- `pnpm test` passes 187/187; `pnpm typecheck`, `pnpm build`, and `git diff --check` pass.
- Responsive captures: [Tables 390px](screenshots/w06-tables-390px.png), [detail 390px](screenshots/w06-table-detail-390px.png), [shared preview 390px](screenshots/w06-table-shared-preview-390px.png), [Requests 390px](screenshots/w06-requests-390px.png), plus desktop captures of each screen.
- Evidence scope is W06.1 and Seat-request behavior in W06.2. Table invitations/offer history, roster curation/recommendations, and W05.4 activity-latch wiring remain future work in W06.3–W06.5/W07.

## W05.4 handoff

W06 creates the actual Table Invitation and W07 creates paid Seats. Those services must atomically set `app_supply_table_heads.protected_by_activity` when activity is first created. Until those relations exist and tests prove the link, W05.4 remains open; a direct latch toggle is only partial evidence.
