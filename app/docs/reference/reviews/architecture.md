# Independent architecture review

Verdict: B01 local foundation/discovery can start. Correct the refund accounting contract before B04 and the webhook handover ordering before B07. The overall architecture is feasible; this is not a release-readiness approval.

Scope: fresh review of PRD.md, architecture.md, flow-ui-brief.md and tasks-checklist.md, plus local referenced package, Stripe, fulfillment, holds and webhook source. No live systems accessed, no packet/application edits, no tests claimed. All references below are under /Users/aaron/Sites/fifthwheel/.

## [P1] Include submitted refunds in reserved balance

File/heading: app/docs/refactor/architecture.md, §3 Core schema contract (line 65), §5 Transactional checkout and money contract, step 7 (line 104).

The schema defines refund states pending/submitted/succeeded/failed/unknown, but the financial invariant sums only succeeded + pending/unknown allocations. A first refund can move to submitted while settlement is outstanding; a concurrent cancellation/full-table refund then finds that reservation absent from the stated sum and reserves the same cents again. This defeats A14/A15 even though both operations lock the payment row. Stripe rejecting a later refund would still leave excess local obligations and incorrect remaining balances.

Minimal correction: define one explicit reserved-balance expression including every unsettled allocation (at least pending, submitted and unknown), plus succeeded amounts; define when a definitive failed operation releases or retains its reservation and how a retry reuses/reacquires it under the payment lock. Add a B04.4/B04.5 fixture: partial refund submitted but unsettled, followed by full-table cancellation, then delayed success of the first refund. Total settled plus reserved must never exceed paid balance.

## [P1] Move durable ingress and old-writer drain before the final migration delta

File/heading: app/docs/refactor/architecture.md, §9 Migration, cutover and rollback, steps 6–7 (lines 176–177); app/docs/refactor/tasks-checklist.md, B07.3.

Step 6 freezes old guest/staff mutations and exports the final delta, but durable old/new webhook ingress and the single fulfillment writer are introduced only in step 7. The existing webhook directly calls Airtable fulfillment and acknowledges it (app/src/routes/api/public/payments/webhook.ts, lines 47–59; booking.server.ts). A legacy payment settling between the final delta and writer switch can therefore write/ack a booking outside the imported watermark. Freezing browser payment creation does not prevent an existing session from settling. Inventorying still-pending sessions does not cover a session that settles immediately after that inventory, and an already acknowledged event need not redeliver into the new inbox.

Minimal correction: specify the handover sequence explicitly: install durable ingress before the final delta; stop/drain old fulfillment including in-flight webhook/return requests; queue arriving events without old writes; capture/import the final watermark; then enable only the new mapped processor and drain its inbox. Add a rehearsal event at each boundary and assert that each paid session appears in exactly one imported/new ledger path. Preserve queued events through pre-write rollback as well.

## [P2] Freeze ballots at vote-open, not scheduled Table start

File/heading: app/docs/refactor/architecture.md, §8 Scheduling, delivery and operational recovery (line 163), versus PRD R07 and tasks-checklist.md B06.1.

The scheduler paragraph says “At start, freeze eligibility” and materialize once; R07 and B06.1 require freezing at start+90 minutes. Taken literally, the worker snapshots at the scheduled Table start and excludes people checked in during the following 90 minutes, even though they satisfy the PRD. The predicate checked_in_at < vote_open_at does not solve this when the snapshot is materialized before those check-ins exist.

Minimal correction: say “At vote_open_at = scheduled_start + 90 minutes” and forbid materialization before that instant. Exercise a guest checking in at start+60 minutes with both on-time and delayed snapshot workers; the eligible set must agree.

## Areas checked without an additional finding

- Table-first transactional allocation and named invitation authority address the existing Airtable check-before-create race in principle; actual enforcement remains B01/B04 evidence debt.
- Approval captures accepted supply/profile versions, profile edits synchronously invalidate eligibility, stale approvals send nothing, and critical supply changes become conflicts. A shared Table link grants no payment authority.
- Late paid outcomes have a durable Seat-or-refund path, and return/webhook share one fulfillment service. Unknown provider operations retain stable operation keys; provider behavior itself was not verified against live accounts.
- Staged complete Airtable scans, UUID mappings, last-good snapshots and upstream_missing conflicts provide a workable supply boundary.
- Post-write rollback correctly avoids re-enabling the old Airtable financial writer. Import quarantine and future-paid linkage gates are explicit.
- Backlog foundation dependencies generally support incremental implementation; hosted schema/configuration, provider contract inventory, financial reconciliation and acceptance evidence remain explicit release gates, not claims of completed verification.
