---
id: echo-finished-screens-copy
type: language-inventory
status: draft
date: 2026-11-13
owner: echo
related_objects: [guest, table, invitation, seat]
related_evidence: []
related_decisions: []
---

# Language inventory: finished screens

## Scope

Copy-only review of implemented sign-in and callback, waitlist admission, profile, identity review, roster curation, Airtable supply management and sync, weekly draft copy, Table invitation delivery, My Seats, and W07.4 cancellation screens. This inventory also includes proposed W07.5 refund-ledger copy; those admin/member refund screens are not implemented here. The goal is to make first-use instructions and recovery states easier to understand while preserving authorization, state, financial, email-delivery, and review meaning.

Audited without edits: `member-tables-workspace.tsx` navigation shell and member Table/request copy. Finn handed off the W07.3 My Seats screens for this copy-only pass. The approved checkout acknowledgment and version remain unchanged. No glossary terms were changed.

## Term inventory

| Concept | User concept | Canonical object | UI label | Code identifier | Avoid |
| --- | --- | --- | --- | --- | --- |
| App admission | Permission to sign in to Fifth Wheel | App access | App access | admission | Treating admission as a Table invitation or Seat |
| Table | A planned evening with a three-stop itinerary | Table | Table | table | Supply, candidate, source record in member-facing copy |
| Seat request | Asking the team to consider you for a Table | Seat request | Request a Seat | request | Suggesting a request reserves a place or charges money |
| Table offer | A named invitation to purchase one Seat | Table invitation | Table invitation | invitation | Implying it is app access or a paid Seat |
| Email state | What the email service knows about an invitation email | Delivery attempt | Email status / email attempt | deliveryState | Calling provider acceptance confirmed inbox delivery |
| Draft | Unpublished Table details staff can review | Supply draft | Draft | draft | Calling an unpublished draft a published Table |
| Review | Staff check of a submitted profile | Identity review | Profile review | identity review | Suggesting the review checks government ID or background |
| Copy result | Weekly operation that creates new drafts | Weekly clone operation | Draft copy / copy run | operation | Manifest, hash, marker, reconciliation in ordinary user-facing instructions |

## Before / after

| Context | Before | After | Rationale |
| --- | --- | --- | --- |
| Sign-in and callback | Technical sign-out language about a Supabase session, cookies, or revocation | Plain explanation that the saved sign-in was cleared or is still active, with a next step | Describes what the member can observe and do without exposing implementation terms. |
| Waitlist | “Admission,” “marketing signups,” “reconcile delivery,” and “operation key” in staff guidance | “App access,” “signups from the website,” “check email status,” and retry guidance tied to the same request | Keeps app access distinct from the later Table invitation and makes recovery actionable. |
| Profile and identity review | “Private review evidence,” “remove image metadata,” and terse stale-version conflicts | “Photos for review,” “remove hidden image details,” and a clear explanation that the member changed the submission | Replaces internal vocabulary while retaining privacy and review boundaries. |
| Roster review | “Selected applicants,” age-span errors, and technical stale/operation errors | “People who asked to join,” “oldest and youngest are more than 12 years apart,” and reload/refresh instructions | Names the people and explains roster validation in direct language. |
| Airtable supply | “Provider mapping,” “staged candidates,” “supply revision,” and lifecycle wording | “Airtable is connected,” “Tables ready for review,” “draft,” and “Table status” | Makes the upstream service and the draft-to-publication sequence clearer. |
| Weekly copy | “Clone,” “manifest revision,” “provider marker,” “reconcile,” and “outcome needs reconciliation” | “Copy drafts,” “saved plan version,” “check this run,” and “result needs a check” | Preserves safe retry and recovery behavior while avoiding infrastructure terminology. |
| Table invitation delivery | “Provider accepted,” “reconcile before retry,” and “delivery recovery” | “Email service accepted,” “check the existing email attempt,” and “email status” | Clarifies that provider acceptance does not confirm inbox delivery and that the status check does not resend email. |
| Member Table/request copy — audit only | “Email provider accepted”; “delivery provider reports”; “Email outcome unknown”; “Waitlist signup does not grant access to the full Table” | Recommend “The email service accepted the message, but delivery to your inbox isn’t confirmed”; “The email service reports delivery”; “The team is checking the email status”; “Waitlist signup alone doesn’t give you app access. Sign in with the account that was approved.” | These phrases appear in `member-tables-workspace.tsx`, which Finn owns. Do not edit in this pass. |
| My Seats | “No refund record”; “Refund status will appear here if a refund is owed for this payment”; “Checkout amount”; generated labels such as “CHECKOUT OPEN”; “A refund obligation is open.” | “No refund is due for this Seat”; “If that changes, the refund status will appear here”; “Amount due”; the eyebrow is now “PAYMENT STATUS,” with plain status headings such as “Payment received; refund pending.”; “Contact the team if you need help with your refund. You don’t need to pay again.” | Replaces database-sounding copy and machine-generated labels with direct language. The missing refund object means no refund obligation is currently open. The refund-pending heading keeps the approved A11 text exactly and that state still has no retry action. |
| W07.4 member cancellation | A universal note said the Seat stays active and check-in/voting rights remain while a request is reviewed; the post-submit message also claimed the Seat remains active. | Show the note only for a pending request. For `confirmed` / `cancellation_requested`: “Your Seat stays active while your request is reviewed.” / “You remain eligible for check-in and voting until the team approves its removal.” For `completed`: “The Table is complete.” / “Your cancellation request remains under review.” For `cancelled`: “The Table and your Seat have been cancelled.” / “Your cancellation request remains under review.” The post-submit message is “Your request was saved.” | Uses the server-reported Seat state so completed/cancelled Tables do not imply current attendance or voting rights. The generic submit confirmation avoids claiming an active state if the Table closes during submission. |
| W07.4 admin denial | Denial wording universally said the Seat stays active, including check-in and voting; saved headings always said “Seat remains active.” | Pending guidance and confirmation say “Denying leaves the Seat active,” “Denying leaves the Seat marked as completed,” or “Denying leaves the Seat marked as cancelled,” based on the current Seat state. The denial button and saved heading likewise name active/completed/cancelled state. | Makes the outcome clear when denial preserves a completed or cancelled Seat after the Table closes. It avoids promising active attendance or voting in terminal states. |
| W07.4 admin queue status | Every cancellation queue card said “Seat active,” including rows for completed or cancelled Tables. | `confirmed`: “Seat active”; `cancellation_requested`: “Cancellation requested”; `completed`: “Table completed”; `cancelled`: “Table cancelled.” | Uses the server-projected Seat/Table state so admins can tell what remains active after a Table closes. |
| W07.4 refund decision | “Refund obligation,” “settlement,” and “already committed” described a saved decision, which could sound like money had been returned. | “The amount is recorded for processing. This screen does not send money”; confirmation says the refund is recorded for processing and does not send money; the saved result says it does not confirm that money reached the member. Member history says a refund is recorded “to be sent” and directs the member to My Seats for status. | Distinguishes recording what is owed from sending/returning money. Zero-refund copy says the team decided not to issue a refund; it does not add an irrelevant returned-money disclaimer. |

## W07.5 refund copy proposal — pending UI/API behavior

These are proposed labels and help text based on the W07.5 contract. They are not live UI copy and make no claim that a worker, provider call, reconciliation, or retry is already available.

### Member My Seats

| Obligation state | Proposed label | Proposed detail | Meaning preserved |
| --- | --- | --- | --- |
| `open` | Refund owed | A refund is owed. It has not been queued for processing yet. | The amount is due, but no work has been queued. |
| `pending` | Refund queued | Your refund is queued for processing. The payment provider has not confirmed it yet. | A durable job exists; this is not proof of submission or payment. |
| `submitted` | Refund processing | The payment provider accepted the refund request. We’re waiting for confirmation that it has been processed. | Provider acceptance is distinct from a succeeded refund. Does not claim money reached the bank account. |
| `unknown` | Refund status unclear | We can’t confirm whether the refund was processed yet. The amount remains owed until the provider confirms the result. | Uncertainty is not success or failure; the obligation remains reserved. |
| `failed` | Refund not completed | The refund attempt failed. The amount is still owed. | Definitive provider failure does not waive or release the amount. |
| `succeeded` | Refund complete | The payment provider confirmed the full refund. | Obligation is complete only when the full owed amount is provider-confirmed; does not promise bank posting time. |

For a late charge, retain the approved A11 heading exactly: **“Payment received; refund pending.”** The lower refund status should distinguish the current obligation state using the labels above. The existing no-retry behavior and “You don’t need to pay again” support note remain. Do not display “Refunded” before the obligation is `succeeded`.

### Admin Refunds workspace

| Obligation / operation state | Proposed label | Proposed detail or action | Contract boundary |
| --- | --- | --- | --- |
| `open` | Refund owed | “This amount is owed and has not been queued yet.” Action: “Queue refund for processing” only when `canDispatch` is true. | Dispatch creates a durable operation and queued work; it does not prove Stripe was called or money returned. |
| `pending` | Refund queued | “The refund is in the processing queue. The payment provider has not confirmed it yet.” | Pending means durable allocation/work is queued, not settled. |
| `submitted` | Refund processing | “The payment provider accepted the refund request but has not confirmed it as processed.” | Avoid “complete” or “returned” until confirmed success. |
| `unknown` | Refund status unclear | “We can’t confirm whether this refund was processed. The amount remains owed. Check its status before trying again.” Action: “Check refund status” only when `canReconcile`; this is read-only and does not resend. | Unknown must not be presented as failed or successful. Reconciliation checks the same provider refund. |
| `failed` | Refund attempt failed | “The refund is still owed. You can try the same refund again.” Action: “Try refund again” only when `canRetry`; it reuses the existing operation and amount. | Do not create a fresh operation or release the reserved balance on failure. |
| obligation `succeeded` | Refund complete | “The payment provider confirmed the full refund.” | The full obligation amount is confirmed. Avoid guaranteeing when it appears on a bank statement. |
| operation `succeeded` | Refund processed | “The payment provider confirmed this refund amount.” | An operation may be partial; do not call the full obligation complete unless obligation state is also `succeeded`. |

### Behavior and wording dependencies

- Admin action buttons must follow `canDispatch`, `canRetry`, and `canReconcile`; copy alone must not infer eligibility from amounts or state.
- For `unknown`, lead with reconciliation. Never imply a check sends another refund. A retry, if permitted, must reuse the same operation UUID, amount, and Stripe idempotency key.
- Member DTOs expose obligation state/amount, but no operation IDs or action flags. Member copy should not promise self-serve retry or status reconciliation.
- The contract maps Stripe `requires_action` to operation `submitted`, but the proposed member DTO does not expose whether member action is required. Do not say “no action needed.” If member action is required, add an explicit safe next-step contract before writing that UI copy.
- W07.5 is in progress; its migration is draft and unapplied, and the admin/member W07.5 UI is not yet implemented. These phrases await the final browser behavior and DTO wiring.

## Open glossary updates

None. Existing terms “Table,” “Seat,” “Table invitation,” and “app access” remain consistent with the glossary. Keep email service acceptance distinct from inbox delivery in all surfaces.

## Remaining flags

- The copy audit is based on first-use reading of the current component text, not a moderated usability study or screenshots in the browser.
- `member-tables-workspace.tsx` remains audit-only because its navigation shell belongs to Finn. The listed member-facing email and admission wording should be coordinated with Finn before any edit.
- The exact checkout acknowledgment and `seat-checkout-v1` were not changed.
- Some technical identifiers remain in code and internal state values, but were not changed because they are not visible copy.

## Files changed

- `app/src/routes/sign-in.tsx`
- `app/src/routes/auth/callback.tsx`
- `app/src/routes/admin/waitlist.tsx`
- `app/src/components/profile-workspace.tsx`
- `app/src/components/identity-review-workspace.tsx`
- `app/src/components/roster-curation-workspace.tsx`
- `app/src/components/admin-supply-sync-workspace.tsx`
- `app/src/components/admin-supply-management-workspace.tsx`
- `app/src/components/admin-supply-weekly-clone.tsx`
- `app/src/components/table-invitation-workspaces.tsx`
- `app/src/components/member-seats-workspace.tsx`
- `app/src/components/seat-cancellation-workspaces.tsx`
- `app/docs/implementation/language-inventory-finished-screens.md`

No My Seats or W07.5 UI/runtime file was changed for the W07.5 copy proposal. No request behavior, services, schemas, styles, glossary entries, or Finn-owned W07.3 files were changed by the language pass. The cancellation component validates and preserves the server-reported Seat state so the pending-request copy can reflect it; no domain or authorization rule was added.
