# Object guide: Table

A table is one Fifth Wheel night for a small group in one Atlanta neighborhood: drinks, dinner, and dessert, then a private vote.

It is not a restaurant, not a waitlist row, and not a single seat. Guests say table. Code stores `event`. Do not show “event” in the guest interface.

## Who it is for

Staff approve it and watch confirmed seats. Guests attend it. The app proposes it and revalidates it. The host console runs the night. It is not where the table is approved.

## Attributes

| Attribute | Required | Who can see it | Notes |
| --- | --- | --- | --- |
| When | For a night that will happen | Guest and staff | Date and drinks time. Which clock starts the 90-minute vote is open. Use the recorded start until that is decided. |
| Itinerary | Assumed for a published night | Guest and staff | Neighborhood and three stops. Not separate objects. |
| Capacity | Yes | Staff | Target 5 confirmed guests. |
| Seat price | For checkout | Guest, before pay | Stored as `seat_price_cents`. |
| Status | Yes | Staff | Draft, approved, filling, night of, complete. See states. |

## States

| State | Meaning | Next |
| --- | --- | --- |
| Draft | App proposed it. Staff have not approved it. | Approved, or it stays draft. |
| Approved | Staff accepted the composition. | Invitations can send. |
| Filling | Invitations are out. Seats confirm as people pay. | Night of, while the confirmed count is watched. |
| Night of | The event has started. | Vote, then complete. |
| Complete | The night is over. | Recap is a neighboring flow, not a new state to invent here. |

There is no “cancelled for low fill” state. Cutoffs are not decided.

A viable night has 3 to 5 confirmed seats. Target is 5. Three or four can be valid. Below 3 is not viable. Drafts may sit below 3 before anyone has paid.

## Calls to action

| Action | Who | Priority |
| --- | --- | --- |
| Propose composition | App | Primary |
| Approve table | Staff | Primary. Unavailable when composition is invalid. Dismissing the confirm leaves it draft and sends nothing. |
| Revalidate | App | Primary, on every add, remove, or replace. |
| Publish for browse | — | Deferred. Not a requirement. |

## What appears on the table

Confirmed guests, invitations, confirmed seats, and the one voting period. Not the waitlist. Not venues as their own objects. See the nested-object matrix.

## Rules

- The app validates composition. Staff approve before any invitation sends.
- Count paid seats, not invitations.
- Mutual age fit, and a span of at most 12 years.
- Revalidate when a seat is added, removed, or replaced. An invalid replacement does not send.
- Voting on this table opens 90 minutes after the recorded start and lasts 30 minutes.

## Card

In a staff list: neighborhood, when, confirmed count against capacity, and status. Age details belong on the guest, not as the table’s title.

In a guest list: the night, the neighborhood, and whether they are invited or seated. Not “event.”

## Not this object

Refunds, rescheduling, cutoffs, and a launch date.
