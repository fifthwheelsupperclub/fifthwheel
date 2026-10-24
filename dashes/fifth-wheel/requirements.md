# Requirements — fifth-wheel

**Date:** 2026-10-23  
**Status:** draft. Aaron has not accepted these as a backlog.  
**Stories use Who / What / Why / When.** Failure paths are in the When clause.  
**Glossary:** `knowledge/glossary/terms.md` already defines Guest, Table, Seat, Invitation, Waitlist, Curation, Vote, Staff, Itinerary. CTA labels used below are Approve table, Pay for this seat, Remove guest, Replace with [name], and Vote. Do not use Match, Reservation, or event in guest UI.

Relationship detail with all five MCSFD lenses is in `domain-summary.md`. Attribute types below are the ones the object files actually name. Where a type is not in the file, it stays unknown.

## In scope

1. Composition check before a table can be approved: mutual age inclusion, span at most 12 years, target 5 confirmed seats, valid at 3 or 4, minimum 3 with mutual-preference rules.
2. Staff approval gate, then automatic invitations.
3. Guest payment that confirms the seat.
4. T-2 staff notice for invitations with no confirmed seat. No expiry.
5. One replacement prompt.
6. Vote window and mutual-only reveal.
7. Copy alignment note for the landing curation sentence and November line. The sentence change itself needs Aaron (`A-1`, `A-2`).

## Out of scope

Refund policy, reschedule flow, cutoff or cancel-for-low-fill, launch date, numeric targets, new objects for venue or neighborhood, a greenfield app, Meta pixel work, a surveyed Kano study (debt only).

## Attributes used by these stories

| Object | Attribute | Type in the files | Unique? |
| --- | --- | --- | --- |
| Guest | Email | string, sensitive | Assumed unique per account. Not proven across waitlist and app. |
| Guest | Date of birth | date, sensitive | No. Age in years is derived. |
| Guest | Match age min / max | whole years, ≥ 21, max ≥ min | No |
| Table | When | date and drinks time | No |
| Table | Capacity | target 5 confirmed | No |
| Table | Seat price | `seat_price_cents` (integer cents) | No. Amount not restated here. |
| Invitation | Sent at | datetime, assumed | No |
| Seat | Confirmed | after payment | One confirmed seat per guest per table is the rule to enforce. Not yet a cited unique constraint in code. |
| Vote | Window | opens +90 minutes, lasts 30 | One period per table |
| WaitlistSignup | Email, birthdate, identity, open_to, looking_for | as on the form | Email uniqueness across two stores is unknown |

Instance scale is not recorded in the object files. Do not infer a waitlist size from the lean list.

## Stories

### S1. Approve a table

- **Who:** Staff
- **What:** Approve one curated table so invitations send
- **Why:** Invitations are not a self-serve booking path before approval (`decision-staff-approve-before-invites`)
- **When:** The table is a draft, composition validates, and staff confirm Approve. If composition is invalid, Approve is unavailable and no invitation row or send occurs. If staff dismiss the confirmation, the table stays draft and nothing sends. If a send fails, the table stays approved, that invitation stays unsent, and staff can retry. Guests cannot open this screen.

### S2. Pay for a seat

- **Who:** Guest
- **What:** Pay the stated seat price for the invited table
- **Why:** The seat counts only after payment (`decision-seat-confirmed-at-payment`)
- **When:** The invitation is sent and not void, the guest is signed in, and the price is shown before checkout. Payment failure leaves the seat unconfirmed and the invitation open. A processing webhook shows “Payment processing,” not “Confirmed.” A checkout URL with no invitation for that table is permission-denied and creates no seat. A void invitation shows Invitation closed and hides Pay.

### S3. Follow up without expiring

- **Who:** Staff
- **What:** See invitations that still have no confirmed seat, two days before the table
- **Why:** Invitations do not expire; people follow up by hand (`decision-invitations-do-not-expire`)
- **When:** The table has a date and the notice instant is two days before that date. The notice does not change invitation state. If “unanswered” is later defined as something other than “no confirmed seat,” this story’s list changes (`A-8`). A missing `sent at` is shown as unknown, not as expired.

### S4. Replace from the waitlist

- **Who:** Staff
- **What:** Remove a guest and answer “Replace with [name] from the waitlist?”
- **Why:** The table stays valid without an automatic invite (`decision-waitlist-replacement-prompt`)
- **When:** Staff choose Remove on someone who is on that table. Yes sends one new invitation only if that person keeps the composition valid, and the new seat is unconfirmed until they pay. No removes the guest and sends nobody. If nobody is eligible, Yes is unavailable and No still removes. If the suggestion would break mutual age fit or the 12-year span, the invitation does not send. Dismiss-without-removal is not decided (`A-11`). Refund of a paid seat is not part of this story (`decision-refunds`).

### S5. Vote and reveal

- **Who:** Guest with a confirmed seat
- **What:** Cast a private ballot and see only mutual interest
- **Why:** The night’s vote is timed and mutual (`decision-voting-window-mutual-only`)
- **When:** The window is open (90 minutes after the recorded start, for 30 minutes) and the guest is eligible. Before and after, the vote control is absent and the page says the window is closed. A late submit is rejected and stores nothing. Reveal lists an unordered pair only when both expressed interest. One-sided interest is omitted in the empty state as well as the loaded state. An invited unpaid guest cannot open Tonight or Vote. The start clock and the word “eligible” stay on `A-9` until Aaron records them. This story’s illustration uses scheduled start and confirmed seat.

### S6. Join the waitlist

- **Who:** Visitor
- **What:** Submit the Atlanta waitlist form
- **Why:** The replacement pool and later invites need an intake row (`object-waitlist-signup`)
- **When:** Required fields validate, age on the birthdate is at least 21 as of today, and match ages are at least 21 with oldest at least youngest. Failure shows the field error and does not claim a seat. Success says they are on the waitlist, not that they have a table. The current endpoint does not persist birthdate or match-range keys. This story is not done until those keys are stored (`A-4`) or Aaron names a different store.

## Edge states

Every primary page in the wireframe covers empty, loading, error, permission-denied, and at-scale. The matrix is `edge-state-matrix.md`.

## Handoff check

| Check | Result |
| --- | --- |
| Who / What / Why / When and a failure path | Met for S1–S6 |
| MCSFD on the relationships these stories use | Met in `domain-summary.md`. Sorts are explicitly assumed |
| Attribute types and unique keys | Partial. Email and one-seat-per-guest are not proven unique. Scale is unknown |
| Edge matrix | Met for the pages in the wireframe, not for every existing app route |
| Representative copy | Met in the wireframe. `{TBD}` is used only for the dollar amount, the start clock, and eligible-attendee wording |
| Open questions map to assumptions | Met via A-1 through A-18 |
| Glossary for objects and CTA labels | Met by `knowledge/glossary/terms.md` plus the CTA list above |

Three or more failed rows would block pitch assembly. Two rows are partial (types/uniqueness, and edge coverage beyond the illustrated pages). The pitch is assembled and says the plan is not release-ready. Ethics and privacy gates are blocked for other reasons.

## Engineering note (not a Finn sign-off)

`evidence-product-app-code` lists the routes to extend: `book/[id]`, `tables/[id]/vote`, `reveal`, `admin` match, Stripe webhook, cancel migration, `matching.ts`. Approval before send is not proven by the match screen’s existence. Host the app as already decided: Render free, GitHub Actions drain, Stripe retries (`decision-app-host-render-free`). This dash does not change hosting.
