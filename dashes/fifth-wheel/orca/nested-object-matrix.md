# Nested-object matrix

Status: current working model. A mark means the column object appears on that row’s detail view. The matrix is not symmetrical. Read a row as “when I am looking at this, I also see…”

Guest-facing views hide attributes even when the object is nested. Other guests never see a birthday or a match range. Staff can.

## Matrix

Rows are the page you are on. Columns are what is nested there.

| Looking at | Table | Guest | Invitation | Seat | Vote | Waitlist signup |
| --- | --- | --- | --- | --- | --- | --- |
| Table | — | Yes, the people on it | Yes, invitations sent | Yes, confirmed seats | Yes, the one voting period | No |
| Guest | Yes, their tables | — | Yes, invitations addressed to them | Yes, seats they have paid for | Yes, ballots they cast | Only if a signup is linked, and only for staff |
| Invitation | Yes, that night | Yes, the invited person | — | Only after payment | No | Staff only, when this invite was a replacement |
| Seat | Yes, that night | Yes, who paid | Yes, if this seat came from an invitation | — | No | No |
| Vote | Yes, that night | Yes, eligible attendees on the ballot | No | No | — | No |
| Waitlist signup | No assignment | Only if the same person has a guest record | Yes, replacement invitations sourced from it | No | No | — |

## What each nesting is for

**Table.** The staff table page is the hub: composition, invitations still without a seat, confirmed seats, and whether the vote is closed, open, or revealed. The guest’s table page shows the night they were invited to or paid for, the other people only as the product already allows, and their own seat and ballot. It does not show the waitlist.

**Guest.** Staff see this person’s tables, invitations, and seats across nights. Past tables feed matching (`metBefore` in code). The guest does not get a directory of other people’s records.

**Invitation.** One invitation is one ask: one guest, one table. The seat appears on it only after payment. A replacement invitation can point back to the waitlist signup it came from. That link is a staff fact.

**Seat.** One confirmed seat belongs to one table and one guest. It may point back to the invitation that led there. A seat without an invitation is not a requirement. Browse-and-pay is open and is not represented as a nesting.

**Vote.** One voting period belongs to one table. The ballot nests the eligible guests at that table, not the waitlist and not people who were only invited.

**Waitlist signup.** It is not nested on the table. The table does not contain the waitlist. A signup can source an invitation later. Neighborhood on the signup is a preference, not a table assignment.

## Isolated-object check

Every object appears in at least one direction.

- Waitlist signup does not appear on the table page. It connects through Invitation. That is intentional.
- Vote does not appear on the waitlist. That is intentional.

## Do not add these nestings yet

- Venue or neighborhood as objects inside the table. They stay attributes of the itinerary.
- A hold inside the seat. Payment confirmation is the seat.
- Other guests’ match ranges inside the guest card.
- A cancelled-for-low-fill table state with its own nested “reason” object.
