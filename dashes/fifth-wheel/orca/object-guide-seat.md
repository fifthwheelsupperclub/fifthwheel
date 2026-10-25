# Object guide: Seat

A seat is a guest’s paid place at a table.

It is not an invitation and not the capacity number. Guests buy a seat at a table. Do not call it a reservation or a ticket.

## Attributes

| Attribute | Required | Notes |
| --- | --- | --- |
| Guest | Yes, once confirmed | Who paid. |
| Table | Yes | Which night. |
| Price | For checkout | `seat_price_cents`. |
| Confirmed | Yes | True only after checkout payment succeeds. |

## States

| State | Meaning |
| --- | --- |
| Confirmed | Paid. Counts toward capacity and toward the minimum of three. |
| Released | The person is no longer in that place. Refund is a separate, undecided decision. Do not imply money moved. |

A hold is not a state of this object. Code has `seat_holds` and a hold-expiry sweep. Those are checkout mechanics. They do not count as confirmed seats.

## Calls to action

| Action | Who | Priority |
| --- | --- | --- |
| Pay for this seat | Guest | Primary. Price is shown before checkout. Failure leaves no confirmed seat and leaves the invitation open. “Payment processing” is not “Confirmed.” |
| Cancel | — | Deferred. Who may cancel, and any refund, are not decided. |
| Reschedule | — | Deferred. |

## Rules

- One confirmed seat per guest per table is the rule to enforce. A unique constraint in code is not yet cited.
- Removing a seated guest revalidates the table. The replacement, if any, is an invitation until that person pays.
- Yes on the replacement prompt does not create this object.

## Card

Staff: guest name and confirmed. The confirmed count on the table is the number of these.

Guest: “Your seat” at this table, after payment. Before payment, they have an invitation, not a seat.

## Open, so do not invent

A seat with no invitation. Who may cancel. What a refund does to this object.
