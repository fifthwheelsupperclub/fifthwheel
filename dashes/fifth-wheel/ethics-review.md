# Ethics review — fifth-wheel

**Date:** 2026-10-23  
**Reviewer:** Allie, independent. Liza did not edit flags to clear the gate.  
**Artifact:** `wireframe.html`, `requirements.md`, knowledge decisions, live waitlist and FAQ copy.  
**Tier:** High-stakes  
**Gate result:** **blocked.** Section C is flagged and there is no privacy or legal sign-off. This file is not that sign-off.

Primary audience: adults at a paid, romance-adjacent group dinner. The age rule says 21+. The product-app age check at 18 is an assertion in `decision-age-from-birthdate`, not a line Liza re-opened in the app repo.

## A — Dark patterns

| # | Design decision cited | Result | Notes |
| --- | --- | --- | --- |
| A1 | `decision-historical-dates-not-targets`; live `Waitlist.astro` November sentence | Flag | The public page states a month the project refused to lock. The wireframe does not repeat it. The live page still does. |
| A2 | No decline label specified | N/A | |
| A3 | `decision-seat-confirmed-at-payment` | Flag | Payment default is “not confirmed until paid.” Defaults for `looking_for` and sharing are not recorded. |
| A4 | No shaming “no” on the ballot | N/A | |
| A5 | `decision-refunds`; landing curation sentence | Flag | Price is assumed. Refunds are not decided. Landing copy sells human curation the decision does not describe. |
| A6 | `decision-refunds`; waitlist has no deletion state | Flag | Easy to join. Exit, refund, and deletion are undesigned. No guest countdown, which avoids a fake deadline. |
| A7 | No ad object | N/A | The false curation line is A5, not an unlabeled ad. |

## B — Vulnerable users

| # | Design decision cited | Result | Notes |
| --- | --- | --- | --- |
| B1 | `decision-voting-window-mutual-only` | Flag | A 30-minute in-room window to declare interest. No skip is specified. |
| B2 | Launch success undecided | N/A | No time-in-product badge. |
| B3 | T-2 notice goes to staff | Pass | Not a guest re-engagement loop. |
| B4 | No badge system | N/A | |
| B5 | Seat confirmed at payment; refund, cutoff, and reschedule undecided | Flag | Money can be taken before the cost of leaving is knowable. |
| B6 | `decision-age-from-birthdate` | Flag | Rule is 21+ and the 21st birthday passes. Marketing script enforces 21. The decision says the app still checks an integer at 18, and the waitlist API does not persist birthdate. |

## C — Data privacy

Any flag blocks the gate until a real review. A page named privacy is not a pass. Detail is in `privacy-review.md`.

| # | Result | Why |
| --- | --- | --- |
| C1 Minimization | Flag | Birthdate is justified. Identity, open_to, and looking_for are collected without a decision that each is the minimum. |
| C2 Law identified | Flag | Atlanta is the market. No knowledge file names GDPR, CCPA, or a Georgia rule. GDPR in the scope file is a baseline, not a finding. |
| C3 Consent | Flag | The form posts to `https://www.5thwheel.app/api/waitlist`. No opt-in text is in the knowledge files. |
| C4 User rights | Flag | Object states have no access, correction, deletion, or export action. The privacy page lists rights. Implementation is not in the knowledge files. |
| C5 Retention | Flag | Object files set no waitlist retention. The privacy page states periods. Those periods are not shown as built. |
| C6 Role access | Flag | Guests do not see birthdays, match ranges, or one-sided interest. That rule is real. `looking_for` has no staff-visibility limit, and two waitlist stores have no access decision. |
| C7 Third parties | Flag | Stripe, Supabase, Render, and the waitlist endpoint are in the files. No DPA is recorded. |

## D — Language

| # | Result | Notes |
| --- | --- | --- |
| D1 | Flag | Labels are English. No translation decision. |
| D2 | Flag | Glossary prefers Table and “you.” Live landing sentence is still the false curation line. |
| D3 | Flag | No reading-level check. Not awarded. |
| D4 | N/A | No low-bandwidth requirement claimed. Render cold start is an ops fact, not a designed degrade. |
| D5 | N/A | Declared population is an English-language Atlanta waitlist. |

## E — Equity

| # | Result | Notes |
| --- | --- | --- |
| E1 | Flag | Stated context is 21+. Enforcement across marketing and app is not shown as one gate. |
| E2 | Flag | Mutual age fit, a 12-year span, identity, and open_to shrink the pool for people at the edges. Not measured. |
| E3 | Flag | Thirty minutes, in the room, on a phone. No alternate way to cast or decline. |
| E4 | Pass | One-sided interest stays hidden from guests. |
| E5 | Flag | Who may lose: older guests pushed by the span cap, non-binary guests, uncommon openness, anyone who cannot absorb an undecided refund. Untested. |

## F — Algorithm

`matching.ts` scores age spread, mutual openness, and tenets (`evidence-product-app-code`). Staff approval is a send gate, not a fairness evaluation.

| # | Result | Notes |
| --- | --- | --- |
| F1 | Flag | Public copy says a person curates every table. The decision is automated proposal plus staff approve. Limits are not disclosed. |
| F2 | Flag | No guest-facing reason for being seated, skipped, or replaced. |
| F3 | Flag | No bias evaluation in the knowledge files. Tenets are unnamed. |
| F4 | Flag | Staff can refuse a table. A guest who was never proposed has no appeal. |
| F5 | N/A | Described as a score, not a trained model. |
| F6 | Flag | Algorithmic output can be mistaken for wholly human curation while the landing sentence stands. |

## Summary

| Section | Flags | Real sign-off? |
| --- | --- | --- |
| A | A1, A3, A5, A6 | No |
| B | B1, B5, B6 | No |
| C | C1–C7 | Required. Absent. |
| D | D1–D3 | No |
| E | E1, E2, E3, E5 | No |
| F | F1–F4, F6 | No |

## Independent challenge

Allie does not approve the direction. Proceeding does not turn these flags into decisions.

Do not pretend these are decided: refunds, cutoffs, launch success, legal sign-off, or that the landing curation sentence is true. Also easy to launder: reschedule, the 18-versus-21 gap, birthdate not stored by the waitlist API, and two waitlist stores.

**Preserve if work continues:** mutual-only disclosure; staff approve before invites; date of birth as the age fact; the 12-year span as a table rule; a seat counts only after payment; invitations do not expire; historical dates stay historical.

**Strongest case against committing:** people pay to be scored on age, identity, and romantic intent, then sit through a timed mutual vote, while the public story says a person hand-built the table and the exit is undesigned.

Open items: unassigned — needs Aaron.
