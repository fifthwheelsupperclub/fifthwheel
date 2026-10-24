# Domain summary — fifth-wheel

**Date:** 2026-10-23  
**Steward:** Luke. Liza checked the relationship claims against `knowledge/objects/` and `knowledge/decisions/`.  
**Object files were not edited.** Guides stay at `knowledge/objects/`. This dash cites them.

## Hub

**Table** is the hub. One night carries capacity, staff approval, invitations, confirmed seats, and one voting period (`object-table`). Guests meet a table of five, not an `event` record (`object-guest`, `glossary-fifthwheel`).

**Guest** is the person across nights (0..n tables). **WaitlistSignup** sits outside the table and joins it only through a replacement invitation. Neighborhood and venues stay notes on the table. Hold, Venue, and Neighborhood are not new objects in this pass.

## Rules that bind the plan

| Rule | Status | Id |
| --- | --- | --- |
| Invitations do not expire. No Expired state. Staff chase unanswered invites at T-2. | accepted | decision-invitations-do-not-expire |
| Seat confirmed after checkout/payment. Capacity counts paid seats. | accepted | decision-seat-confirmed-at-payment |
| App proposes and validates. Staff approve before automatic invites. | accepted | decision-staff-approve-before-invites |
| Vote opens 90 minutes after start, closes 30 minutes later. Eligible attendees only. Mutual disclosure only. Closed at check-in. | accepted | decision-voting-window-mutual-only |
| Age from date of birth. Match range is youngest and oldest, both ≥ 21. Mutual inclusion. Table span ≤ 12 years, and that cap is a table rule, not a form field. Staff see age in years and may open the birthday. Other guests see neither. | accepted | decision-age-from-birthdate |
| One replacement prompt. Yes sends the new invitation if composition stays valid. No removes without a replacement. Revalidate on add, remove, replace. | accepted | decision-waitlist-replacement-prompt |
| Refunds, rescheduling, cutoffs, launch timing and success | not decided | decision-refunds, decision-rescheduling, decision-table-cutoffs, decision-launch-timing-and-success |
| Lean-list dates and landing November copy | not targets | decision-historical-dates-not-targets |

Target five confirmed guests. Three or four can be valid. Minimum three with mutual-preference rules. Do not add a “cancelled for low fill” state.

## MCSFD

Sort is not in the object files. Those cells are assumed (`A-14`). Filter and dependency cells marked assumed go beyond the files.

### Table → Seat

| Lens | Specification |
| --- | --- |
| Mechanics | Automatic once payment confirms. A hold in code is not this link. |
| Cardinality | Table has 0..capacity seats. Target 5. Each seat belongs to 1 table. |
| Sorts | Assumed: no order recorded. Plan default: seat confirmation time. |
| Filters | Confirmed (paid) versus not. Holds are excluded from the confirmed count. |
| Dependency | A seat requires a table. A draft table may have zero seats. Viability depends on the confirmed count (minimum 3). Revalidate on add, remove, replace. Cancelling a seat releases it. Refund is a separate undecided decision. |

### Table → Invitation

| Lens | Specification |
| --- | --- |
| Mechanics | Automatic after staff approve. Must not send before approval. |
| Cardinality | Table has 0..n invitations. Each invitation belongs to 1 table. |
| Sorts | Assumed. T-2 is a staff notice, not a sort. Plan default: sent time. |
| Filters | Unanswered, defined in this plan as no confirmed seat until Aaron says otherwise (`A-8`). |
| Dependency | Send depends on approval. An invitation requires a table. A table does not require invitations. There is no cascade into an Expired state. |

### Table → Guest

| Lens | Specification |
| --- | --- |
| Mechanics | A guest is on a table through an invitation and, once paid, a seat. Past tables feed `metBefore` in code. |
| Cardinality | A viable night has 3..5 confirmed guests. A guest attends 0..n tables over time. A draft table may sit below 3. |
| Sorts | Assumed. `metBefore` is a matching input, not a display sort. |
| Filters | Confirmed guests count toward viability. |
| Dependency | A viable night depends on the confirmed count and revalidation. A guest may exist with zero tables. |

### Invitation → Seat

| Lens | Specification |
| --- | --- |
| Mechanics | The seat appears when that guest pays. |
| Cardinality | 0..1 either way. |
| Sorts | Not applicable at this cardinality. |
| Filters | None stated. |
| Dependency | Payment creates the seat. The invitation does not require a seat. Whether a seat can exist with no invitation is open (`A-10`). |

### Guest → Vote

| Lens | Specification |
| --- | --- |
| Mechanics | Automatic window on the table. The guest casts manually inside it. |
| Cardinality | One voting period per table. One ballot per guest per table. A ballot involves 2..n guests as voter and subjects. |
| Sorts | Assumed: no ballot order in the files. |
| Filters | Eligible attendees only. Non-attendees are excluded. Disclosure is mutual pairs only. Who “eligible” means is open (`A-9`). |
| Dependency | The period belongs to one table. It opens 90 minutes after start and lasts 30 minutes. It is closed at check-in. Reveal timing (at close, or when both have voted) is open. One-sided interest is never shown. |

### WaitlistSignup → Guest

| Lens | Specification |
| --- | --- |
| Mechanics | Not automatic. A signup may become a guest. |
| Cardinality | 0..1 either way. |
| Sorts | Not applicable. |
| Filters | None stated. |
| Dependency | Optional both ways. A signup is not a seated guest. The same store is not proven. |

### WaitlistSignup → Invitation

| Lens | Specification |
| --- | --- |
| Mechanics | Staff Yes on one composition-safe suggestion. The app proposes the person. |
| Cardinality | A signup may source 0..n invitations. An invitation has 0..1 signup. |
| Sorts | The decision is one named suggestion, not a ranked list the staff pick from. |
| Filters | The suggestion must keep a valid composition, including mutual age fit and the 12-year span. |
| Dependency | The replacement invitation depends on Yes. An invitation can exist with no signup. No eligible person means Yes is unavailable and removal can still proceed with no invite. |

## Gaps to keep visible

- Two waitlist code paths. Birthdate and match-range keys are not persisted by the current marketing endpoint.
- An invitation may be notifications and holds rather than a first-class row (`object-invitation`).
- `seat_holds` and `hold_expiry_sweep` exist in app evidence. Hold is not a required domain state (`object-seat`).
- Published/browse versus invite-only is open (`object-table`).

## Open questions already on the objects

Copied, not expanded: waitlist email versus app account; which profile fields a valid table needs; when identity verification is required; browse-and-pay after approval; where restaurant data lives; which clock starts the 90 minutes; what “unanswered” means; whether the invitation is a row; email versus SMS; hold versus seat; who may cancel; eligible attendees; when mutual reveal happens; what else is on the ballot; which waitlist store replacements read; whether neighborhood constrains replacement; do not derive a birthday from an integer age.
