# Policy copy inventory (W11.5)

Prepared 2026-11-15 for staff and legal review. **Nothing here is approved text**; it lists where cancellation, refund and retention statements appear today, whether they agree with the product as built, and what needs a decision. Marketing pages are outside this rewrite's presentation scope, so any change to them is a separate, explicitly approved release change.

## What the product does (source of truth: PRD D04, R05)

- A guest asks to cancel a Seat; the Seat stays in force until an admin approves. The admin decides **full, partial or no refund** and records a guest-safe reason.
- If **Fifth Wheel cancels the Table**, every paid guest is refunded the full remaining balance.
- There are no automatic timed refund tiers.
- Refunds are issued to the original payment method; timing depends on the provider.

## Where the words live

| Surface | Current text (short) | Agrees? | Decision needed |
|---|---|---|---|
| Checkout acknowledgment `seat-checkout-v1` (app, **already approved by you**) | "…If I cancel, an admin decides whether the refund is full, partial, or none." | Yes | None |
| Seat cancellation screens (app) | Admin chooses full / partial / none and writes a reason the guest sees | Yes | None |
| Guest emails (app, drafted) | Table cancelled: "the full amount is being refunded…"; decision email states the amount or "No refund applies"; removal email states any refund | Yes | Staff to approve wording and tone |
| Terms §6 (marketing) | "These Terms do not set a cancellation window or a refund amount." | Consistent, but silent that an admin decides | Add one sentence that staff review each request? |
| Terms §7 (marketing) | If we cancel an evening "we will tell you"; no statement of refund | **Gap**: the app promises a full refund | Add "and refund what you paid for that evening"? |
| Terms (marketing) elsewhere | Removal for conduct is "without refund" | Consistent with admin discretion | Confirm |
| Privacy (marketing) | Payment and refund records retained; refund notices are service messages | Consistent | Retention periods (below) |
| Retention periods (app engineering defaults) | Ballots 30 days; vote results 90 days; ratings de-identified at 90 days, deleted at 12 months; conduct reports reviewed at 12 months; audit 90 days; evidence photos 7 / 30 days (storage job not built) | Not published anywhere | Release owner confirms or changes; Privacy must then state them |
| Support contact | `hello@fifthwheel.community` in emails, overview footer and conduct-report guidance | Yes | Confirm the mailbox is monitored, and who owns it |
| Emergency guidance (app) | "If you or someone else is in danger, call 911." and "we don't monitor evenings in real time" | Yes | Staff to approve |

## Open policy decisions (each blocks nothing in code, but each blocks a clean launch)

1. Refunds that Stripe confirms as **failed**: currently stay owed, are not retried automatically, and show in the admin queue.
2. T−48 reminder audience and channel: built as an email to unpaid invitation holders only.
3. Finance retention for payment, refund and deduplication records.
4. Whether Terms §6 and §7 are updated before launch (a marketing change).
5. Operational ownership: who watches `/admin`, the heartbeat alert and the support mailbox.
