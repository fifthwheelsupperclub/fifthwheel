# Object guide: Invitation

An invitation is the staff-approved ask for one guest to take a seat at one table.

It is not a waitlist signup and not a seat. Accepting it does not confirm the seat. It does not expire.

## Attributes

| Attribute | Required | Notes |
| --- | --- | --- |
| Guest | Yes | Who was invited. |
| Table | Yes | Which night. |
| Sent at | For the two-day notice | If it is missing, show unknown. Do not show expired. |
| Answered | Derived | In this model, unanswered means there is still no confirmed seat. |

No expiry timestamp.

## States

| State | Meaning | Visible to |
| --- | --- | --- |
| Sent | Out, and no confirmed seat yet | Guest and staff |
| Converted | The guest paid | Guest and staff |
| Void | The guest was removed, with or without a replacement | Staff |

There is no Expired state.

## Calls to action

| Action | Who | Priority |
| --- | --- | --- |
| Send invitation | App | Primary, only after the table is approved. A failed send stays unsent and can be retried. The table stays approved. |
| Follow up | Staff | Secondary. Two days before the table, for invitations with no confirmed seat. Does not change state. |
| Pay for this seat | Guest | Primary on the guest’s invitation. Lives on Seat. Hidden when the invitation is void. |
| Void | Staff, by removing the guest | Primary. |

## What the guest sees

“You’re invited to this table.” The night, the neighborhood, the seat price, and Pay. No countdown. No “reservation expires.”

A checkout URL with no invitation for that table does not create a seat. Browse-and-pay is not a requirement.

## Rules

- Do not send before staff approve the table.
- A replacement sends a new invitation. It does not confirm a seat.
- An invitation can exist with no waitlist signup. A first-round invite is not a replacement.

## Open, so do not invent

Whether “unanswered” later means something other than “no confirmed seat.” Whether the invitation is already a row, or still only notifications and holds. Whether the guest receives email, SMS, or both. The domain object stands either way.
