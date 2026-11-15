---
id: glossary-fifthwheel
type: glossary
status: draft
date: 2026-11-14
owner: echo
related_objects: [object-guest, object-table, object-invitation, object-seat, object-waitlist-signup, object-vote]
related_evidence: [evidence-linear-pre-mvp-scope, evidence-marketing-site-code, evidence-product-app-code]
related_decisions: [decision-staff-approve-before-invites, decision-seat-confirmed-at-payment, decision-waitlist-replacement-prompt]
---

# Fifth Wheel glossary

UI labels follow the language refactor decisions settled on 2026-11-14 (D-1, D-2, D-5, D-6, D-7, D-10, D-21 in `app/docs/implementation/language-refactor-plan.md` §F2). The full dictionary, including state labels, lives in that plan's §C. This table holds the canonical terms.

| Concept | Canonical domain term | UI label | Code identifier | Avoid | Notes |
| --- | --- | --- | --- | --- | --- |
| The product / the night for five | Fifth Wheel | Fifth Wheel | — | “the fifth wheel” as a person; “Fifthwheel” in prose | D-7. The lowercase “fifth wheel.” logo is visual only. The repo name stays as is. |
| Person who may be waitlisted, given access, or seated | Guest | you (guest UI); guest (staff UI) | profile / user | member, applicant, admitted account, user, customer | D-1. “Member” is not a UI label. |
| Permission to sign in to the app | Access | access · “You're in” (guest); “Let in” / “Approve” (staff) | admission | invitation, app invitation, admission, membership | D-2. Never called an invitation. |
| One five-person night | Table | table (lowercase in prose) | `event` | Reservation, event | D-6. Capitalize only at the start of a sentence or in a title-case heading. |
| Paid place at a table | Seat | seat (lowercase in prose) | booking / seat | Reservation, booking | D-6. Confirmed only after payment. |
| Guest asks to be considered for a table | Seat request | request (guest); seat request (staff) | seat request | application, applicant | Not an invitation, roster place, or payment right. |
| Staff offer to buy one seat at one table | Invitation | invitation | table invitation | offer, match, reservation | The only thing called an invitation (D-2). Does not expire for now. |
| Website signup without app access yet | Waitlist signup | waitlist (“join the waitlist”); waitlist signup (staff) | waitlist signup | lead, applicant | D-21. “Waitlist” means only this. |
| People who can replace a removed guest | Replacement candidates | people who requested this table | `replacement_candidates` | waitlist | D-21. In code these are pending seat requests for the table. See the evidence debt below. |
| Staff check that photos match the profile | Profile review | profile review | identity review | identity review, verification | “Identity” is the gender field (“How do you identify?”). |
| Money owed back to a guest | Refund | Refund pending / Refund on its way / Refund delayed / Refunded | refund obligation + operations | obligation, operation, dispatch, settled | D-10. Guests see 4 states. Staff see all 6. “Refunded” only after Stripe confirms. |
| Automated email to a guest | Guest email | (guests don't see delivery status) / guest email (staff) | notice | notice, communication | D-5. Guests see the invitation, seat or refund, not whether the email arrived. |
| App proposes a valid group; staff approve | Curation | (staff) Approve table | matching | “A real person curates every table” as the whole story | Landing copy is out of date. |
| Private interest ballot | Vote | vote | vote | Poll, like | Disclose only when mutual. |
| People who work the product | Staff | staff | admin | Host (host console is a separate night-of tool) | |
| Three-stop neighborhood path | Itinerary | Drinks / dinner / dessert | itinerary | Tour | Neighborhood and venues are notes on Table, not objects yet. |

## Evidence debt

- **Replacement pool definition (D-21).** `objects/waitlist-signup.md` and `objects/invitation.md` describe replacements as coming from waitlist signups. The shipped code (`supabase/migrations/20261114180000_w08_removal_replacement.sql:62–75`, `replacement_candidates`) draws them from pending seat requests for that table. D-21 fixes the word. Luke still needs to reconcile which pool the model means.
