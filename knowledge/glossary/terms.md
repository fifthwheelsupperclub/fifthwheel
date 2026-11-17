---
id: glossary-fifthwheel
type: glossary
status: draft
date: 2026-11-14
owner: echo
related_objects: [object-guest, object-table, object-invitation, object-seat, object-waitlist-signup, object-vote]
related_evidence: [evidence-linear-pre-mvp-scope, evidence-marketing-site-code, evidence-product-app-code]
related_decisions: [decision-staff-place-guests-directly, decision-seat-confirmed-at-payment, decision-waitlist-replacement-prompt]
---

# Fifth Wheel glossary

UI labels follow the language refactor decisions settled on 2026-11-14 (D-1, D-2, D-5, D-6, D-7, D-10, D-21 in `app/docs/implementation/language-refactor-plan.md` §F2). The full dictionary, including state labels, lives in that plan's §C. This table holds the canonical terms.

| Concept | Canonical domain term | UI label | Code identifier | Avoid | Notes |
| --- | --- | --- | --- | --- | --- |
| The product / the night for five | Fifth Wheel | Fifth Wheel | — | “the fifth wheel” as a person; “Fifthwheel” in prose | D-7. The lowercase “fifth wheel.” logo is visual only. The repo name stays as is. |
| Person who may be waitlisted, given access, or seated | Guest | you (guest UI); guest (staff UI) | profile / user | member, applicant, admitted account, user, customer | D-1. “Member” is not a UI label. |
| Permission to sign in to the app | Access | access | admission | invitation, app invitation, admission, membership | D-2. Never called an invitation. Created when staff place a guest at a table; there is no separate approval. |
| One five-person night | Table | table (lowercase in prose) | `event` | Reservation, event | D-6. Capitalize only at the start of a sentence or in a title-case heading. |
| Paid place at a table | Seat | seat (lowercase in prose) | booking / seat | Reservation, booking | D-6. Confirmed only after payment. |
| Staff add a waitlisted guest to a table | Placement | add to table (staff) | placement (`place_guest_at_table`) | approval, seat request, match | Queues the invitation in the same step. Guests can't request seats. |
| Staff offer to buy one seat at one table | Invitation | invitation | table invitation | offer, match, reservation | The only thing called an invitation (D-2). Does not expire for now. |
| Website signup without app access yet | Waitlist signup | waitlist (“join the waitlist”); waitlist signup (staff) | waitlist signup | lead, applicant | D-21. “Waitlist” means only this. Unplaced signups form the staff placement queue. |
| Money owed back to a guest | Refund | Refund pending / Refund on its way / Refund delayed / Refunded | refund obligation + operations | obligation, operation, dispatch, settled | D-10. Guests see 4 states. Staff see all 6. “Refunded” only after Stripe confirms. |
| Automated email to a guest | Guest email | (guests don't see delivery status) / guest email (staff) | notice | notice, communication | D-5. Guests see the invitation, seat or refund, not whether the email arrived. |
| Staff choose who sits together | Curation | (staff) Add to table | placement | matching, approve table | Staff place guests one at a time; preference rules are warnings, not approvals. |
| Private interest ballot | Vote | vote | vote | Poll, like | Disclose only when mutual. |
| People who work the product | Staff | staff | admin | Host (host console is a separate night-of tool) | |
| Three-stop neighborhood path | Itinerary | Drinks / dinner / dessert | itinerary | Tour | Neighborhood and venues are notes on Table, not objects yet. |

## Evidence debt

- **Replacement pool (resolved 2026-11-16).** Replacements now come from the waitlist placement queue, matching `objects/waitlist-signup.md` and `objects/invitation.md` (`decision-staff-place-guests-directly`).
