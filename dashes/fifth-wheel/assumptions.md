# Assumptions — fifth-wheel

**Date:** 2026-10-23  
**Owner of every open row:** unassigned — needs Aaron  
**Due-by:** unassigned — set when an owner is named

Observed claims cite a file. Assumed claims do not override an accepted decision.

| id | statement | type | confidence | validation method | owner | status | linked decision |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A-1 | Staff can approve every curated table before invites, and the public “a real person curates every table” line can stay or must change. | assumed | low | Aaron chooses the public sentence. Then a file-level check that invite send is blocked until an approval record exists in the app repo. | unassigned — needs Aaron | open | decision-staff-approve-before-invites |
| A-2 | “November” on the landing page and FAQ is historical color. There is still no first-table window or success measure. | assumed | low | Aaron accepts a launch decision that names a window, a measure, and an owner, or records that the copy must drop the month. | unassigned — needs Aaron | open | decision-historical-dates-not-targets, decision-launch-timing-and-success |
| A-3 | Invitations stay open, and a manual follow-up two days before the event is enough to hold at least three paid seats. | assumed | low | Read the app invitation model for an expiry job. Run a staff dry-run of the T-2 notice. | unassigned — needs Aaron | open | decision-invitations-do-not-expire |
| A-4 | One waitlist is the system of record, and it can store `birthdate`, `match_age_min`, and `match_age_max`. | assumed | low | Read the live `www.5thwheel.app` waitlist handler and the app route. Aaron names the system of record. | unassigned — needs Aaron | open | decision-waitlist-replacement-prompt, decision-age-from-birthdate |
| A-5 | The product app still admits guests on an integer age of 18, while the rule is 21 derived from date of birth. | assumed | low | Cite the onboarding age check in `fifthwheelsupperclub/app` with path and constant. This marketing tree already uses `MINIMUM_AGE = 21` in `src/scripts/waitlist.ts`. | unassigned — needs Aaron | open | decision-age-from-birthdate |
| A-6 | A paid checkout is what confirms a seat in the running app. | assumed | low for production | One non-production checkout from Stripe webhook to seat status. | unassigned — needs Aaron | open | decision-seat-confirmed-at-payment |
| A-7 | Vote and reveal routes match the 90/30 window, eligible ballots, and mutual-only disclosure. | assumed | low | Code read of those routes, then one timed fixture. | unassigned — needs Aaron | open | decision-voting-window-mutual-only |
| A-8 | “Unanswered” means no confirmed seat. Click and account-creation readings are not accepted. | assumed | low | Aaron records the definition. Until then, reports use payment state only. | unassigned — needs Aaron | open | decision-invitations-do-not-expire |
| A-9 | The 90-minute clock uses the table’s scheduled start. “Eligible” means a confirmed seat on that table. | assumed | low | Aaron records the clock and the eligible-attendee rule. | unassigned — needs Aaron | open | decision-voting-window-mutual-only |
| A-10 | After approval, a guest cannot pay without an invitation (Table door). Browse-and-pay stays open in the object files. | assumed | low | Aaron selects a concept. Selection Gate is not cleared. | unassigned — needs Aaron | open | object-table open question |
| A-11 | Dismissing the replacement prompt aborts the removal. The decision defines Yes and No only. | assumed | low | Aaron confirms the third action, or the wireframe drops Dismiss. | unassigned — needs Aaron | open | decision-waitlist-replacement-prompt |
| A-12 | Identity verification is not on the happy path until Aaron says whether it is required before invite, payment, or the night. | assumed | low | Aaron records the gate. | unassigned — needs Aaron | open | object-guest |
| A-13 | Kano classes in `prioritization-report.md` are a two-rater heuristic. They are not customer evidence. | assumed | low | Field the paired survey before treating the classes as validated. No channel exists in this repo. | unassigned — needs Aaron | open | P2.13 |
| A-14 | Sort order of seats, invites, and ballots is unspecified in the object files. | assumed | low | Luke records a sort when a screen needs one. Default in this plan: chronological, staff can change it. | unassigned — needs Aaron | open | MCSFD |
| A-15 | Applicable privacy law is unconfirmed. GDPR is a working baseline only. The privacy page says United States law and lists access, correction, deletion, and portability without naming GDPR or CCPA. | assumed | low | Aaron or counsel names the regulation and signs `privacy-review.md`. | unassigned — needs Aaron | open | Privacy gate |
| A-16 | Refunds, rescheduling, and table cutoffs stay unimplemented. | assumed | n/a — explicitly undecided | Aaron records a decision before any of those flows is built. | unassigned — needs Aaron | open | decision-refunds, decision-rescheduling, decision-table-cutoffs |
| A-17 | `knowledge/evidence/marketing-site-code.md` says `waitlist.ts` must stay Airtable-compatible. The current script comment does not mention Airtable. It says the endpoint still lives on the existing Vercel app. | assumed | low | Re-read the live handler before naming Airtable as a processor. | unassigned — needs Aaron | open | evidence-marketing-site-code |
| A-18 | Learning-loop owner and deadline are unset. High-stakes would want a test plan, a named owner, and a date (method: P8 date + 30 business days). | assumed | n/a | Aaron names the owner. The date is set then, not now. | unassigned — needs Aaron | open | Learning gate |

Express did not apply, so these rows are gate debt, not an Express deferral log. The solo High-stakes halt is in `dash-config.yaml`.
