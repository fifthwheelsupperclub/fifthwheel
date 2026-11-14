# Independent architecture recheck

Verdict: all three original architecture findings are resolved in the current specification. B01 local foundation/discovery remains ready; the previously identified specification defects no longer block B04/B06/B07 planning. This is a document recheck, not implementation, provider, migration or release validation.

Reviewed current app/docs/refactor/{PRD.md,architecture.md,flow-ui-brief.md,tasks-checklist.md}; did not edit the packet or access live systems.

## Original P1 — Submitted refund reservation: resolved

Architecture §5 step 7 now explicitly reserves succeeded, pending, submitted, unknown and failed-but-still-owed allocations. Definitive failure retains the obligation unless explicitly corrected/cancelled under the payment lock with audit, retries retain the operation/allocation, and full Table cancellation reuses reservations plus only the uncovered remainder. B04.4 adds the submitted partial refund → full cancellation → delayed settlement fixture with the aggregate paid-balance assertion. This closes the omitted-state race and matches PRD A14/A15 and the UI's separate refund settlement state.

## Original P1 — Webhook cutover gap: resolved

Architecture §9 step 6 now installs durable signed-event ingress before the final delta, disables browser/staff/payment plus webhook/return fulfillment writers, waits for in-flight old calls, records a writer-stop watermark and then imports the final delta while new events queue. Step 7 enables one mapped processor and dedupes queued events against imported mappings. Step 8 retains inbox events through pre-write rollback and prevents unpersisted acknowledgements. B07.3 now injects paid events before ingress, during drain, after delta and after switch and requires exactly one imported/new ledger path; queued rollback survival is explicit. The old source handler's direct-write behavior is now explicitly something to disable/drain rather than an unaddressed transition window.

## Original P2 — Early ballot freeze: resolved

Architecture §8 now states vote_open_at = scheduled_start + 90 minutes, forbids earlier materialization, uses database-generated non-backdated attendance and Table-lock serialization, and requires on-time/late worker agreement for +45m/+60m attendance. B06.1 adds those attendance and no-early-materialization fixtures. PRD R07/D08 and Flow/UI voting behavior agree with this boundary.

## Regressions and remaining evidence debt

No new concrete regression found from these corrections across the four files. The additional active_paid predicate and durable mutual-results finalization do not contradict these corrections. Actual refund/provider transitions, concurrent database behavior, durable ingress/drain implementation, rollback and delayed-worker behavior remain acceptance evidence owed by the implementation tasks. No tests or live-state checks were run for this document-only review.
