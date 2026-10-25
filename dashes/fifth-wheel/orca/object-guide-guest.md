# Object guide: Guest

A guest is a person Fifth Wheel may invite, seat, or show on a ballot.

A guest is not Staff, and not a waitlist signup. A signup is a form row that may or may not be this person yet. The guest interface says “you,” not Customer or User.

## Attributes

| Attribute | Required | Sensitive | Who can see it |
| --- | --- | --- | --- |
| Name | For an invitation or a seat | Yes | Staff. Other guests only where the ballot or the table already shows a name. |
| Email | For an invitation | Yes | Staff. Not other guests. |
| Date of birth | For age rules | Yes | Staff may open it. Other guests never see it. |
| Age in years | Derived | Yes | Staff. Not other guests. Calculated on the table date, or on today when there is no table. |
| Youngest and oldest they will meet | Yes on the form | Yes | Staff. Not other guests. Both at least 21. Oldest at least youngest. |
| Identity | On the waitlist form | Yes | Woman, Man, or Non-binary. Staff. |
| Open to | On the waitlist form | Yes | Who they want to be seated with. Matching uses `interestedIn`. |
| Identity verification | In pre-MVP scope | Yes | When it blocks an invitation, a payment, or the night is open. Do not invent that gate. |

## States

| State | Meaning |
| --- | --- |
| Known | A person we can invite. May have come from a signup. Not seated. |
| Invited | Has an open invitation. |
| Seated | Has a paid seat. |
| Attended | The night happened. Assumed label. Exact code states are not copied here. |

Waitlisted is a signup state, not proof this guest record exists.

## Calls to action

| Action | Who | Priority |
| --- | --- | --- |
| Register / sign in | Guest | Primary. Separate from joining the waitlist. |
| Pay for this seat | Guest | Primary. See Seat. |
| Cast vote | Guest | Primary, with a confirmed seat, inside the window. |
| Remove guest | Staff | Primary. Opens the one replacement prompt. |
| Verify identity | Guest | Secondary. Timing is open. |

## Rules

- Two people fit only when each one’s age falls inside the other’s range.
- Past tables can feed matching. Guests do not see other people’s birthdays or match ranges.
- An invited unpaid guest cannot vote.

## Card

Staff card: name, age in years, invitation or seat status for this table. Birthday is one step deeper, not on the card.

Guest-facing card for someone else: the name the ballot needs. No age, no match range, no email.

## Open, so do not invent

Whether the waitlist email and the app account are the same record. Which profile fields beyond the form a valid table requires. Whether verification is before the invitation, the payment, or the night.
