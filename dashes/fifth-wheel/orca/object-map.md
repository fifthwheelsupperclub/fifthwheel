# Object map

Status: current working model. Definitions and accepted rules come from `knowledge/objects/` and `knowledge/decisions/`. Fields marked open are not requirements.

Fifth Wheel is a night for a small group in one Atlanta neighborhood: drinks, dinner, dessert, then a private vote. Guests call that night a table. The product is made of six objects.

## Objects

| Object | Definition | Hub or leaf |
| --- | --- | --- |
| Table | One Fifth Wheel night: a small group, one neighborhood, drinks then dinner then dessert, then a private vote. | Hub |
| Guest | A person we may invite, seat, or put on a ballot. | Crosses nights |
| Invitation | The staff-approved ask for one guest to take a seat at one table. It is not a seat and it does not expire. | On a table |
| Seat | A guest’s paid place at a table. Capacity counts these, not invitations. | On a table |
| Vote | One guest’s private ballot about other eligible guests at the same table. Interest is shown only when mutual. | On a table |
| Waitlist signup | An intake row from the Atlanta waitlist. It is a pool for replacements. It is not an account and not a seat. | Outside the table |

Table is the hub. A guest exists across nights. A waitlist signup joins a table only when staff accept it as a replacement and an invitation is sent.

## What is not an object

| Thing people say | Treat it as |
| --- | --- |
| Event | The code name for Table. Do not show “event” to guests. |
| Reservation | Do not use. The objects are Invitation and Seat. |
| Venue, neighborhood, itinerary | Notes on the table: a walkable three-stop path. Not their own objects in this pass. |
| Hold | A checkout implementation (`seat_holds`). Not a required domain state. A seat counts when payment succeeds. |
| Host | The night-of console. Not the person who approves the table. Approval is Staff. |
| Recap, rating | After the night. Not the Vote. |
| Match | The app’s curation step. Guests do not see “match.” Staff see Approve table. |

## Roles

| Role | Acts on |
| --- | --- |
| Visitor | Waitlist signup only. |
| Guest | Their invitation, their seat, their ballot. Guest interface says “you.” |
| Staff | Approve a table, see unanswered invitations, answer one replacement prompt. Staff see age in years and may open the birthday. |
| App | Proposes a valid table, sends invitations after approval, confirms a seat on payment, opens and closes the vote, reveals only mutual interest. |
| Host | Night-of console. Not the approval surface. |

## How a night is assembled

1. The app proposes a table whose composition is valid.
2. Staff approve it. Invitations do not send before that.
3. Each invitation stays open. There is no Expired state.
4. A seat exists when that guest pays. Invited is not seated.
5. Removing someone asks once: replace with one named person from the waitlist, or remove with no replacement. The new person is invited, not seated, until they pay.
6. The vote opens 90 minutes after the recorded start, stays open 30 minutes, and shows only mutual interest.

A viable night has three to five confirmed seats. The target is five. Three or four can be valid. Minimum three still has to satisfy mutual age fit. Do not add a “cancelled for low fill” state.

## Composition rules that define a valid table

- Age comes from date of birth. Years are calculated on the date the rule runs. On the waitlist form, with no table date, the 21+ check uses today. On a table, it uses the table date. The 21st birthday itself passes.
- Match preference is two whole-year fields, youngest and oldest, both at least 21, oldest at least youngest. A person’s own age does not have to sit inside their own range.
- Two people fit only when each one’s age falls inside the other’s range.
- Ages at one table span at most 12 years. That cap is a table rule, not a form field.
- Guests do not see another person’s birthday or match range.

## Guest-facing words

| Say | Do not say |
| --- | --- |
| Table | Event, reservation |
| Seat | Ticket, reservation |
| Invitation | Match |
| Vote | Poll, like |
| Atlanta waitlist | Account, seat |
