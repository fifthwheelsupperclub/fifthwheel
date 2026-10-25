# Object guide: Vote

A vote is a private ballot one guest casts about other eligible guests at the same table.

Interest is disclosed only when it is mutual. A vote is not a rating and not the recap after the night.

## Attributes

| Attribute | Required | Notes |
| --- | --- | --- |
| Voter | Yes | One guest. |
| Table | Yes | One night. One voting period on that table. |
| Window | Yes | Opens 90 minutes after the recorded start. Closes 30 minutes later. |
| Choices | Yes | Eligible attendees only. |
| Mutual reveal | Yes | A pair is shown only when both expressed interest. |

What else is on the ballot, beyond interest in eligible attendees, is not specified. Do not add dessert-partner versus general-interest as a requirement.

## States

| State | Meaning |
| --- | --- |
| Closed, before | Nobody can vote. This includes check-in. |
| Open | The 30-minute window. |
| Closed, after | No new votes. A late submit stores nothing. |
| Revealed | Mutual pairs only. |

Reveal may be at close or when both have voted. That timing is open. One-sided interest stays hidden in both cases, including the empty state.

## Calls to action

| Action | Who | Priority |
| --- | --- | --- |
| Open voting | App | Primary. Not available at check-in. |
| Cast vote | Guest | Primary, while open, with a confirmed seat. |
| Close voting | App | Primary. |
| Reveal mutual interest | App | Primary. Unordered pairs. Never a one-sided list. |

An invited guest who has not paid cannot open the vote.

## Rules

- One ballot per guest per table.
- Non-attendees are not on the ballot.
- Guests do not see who picked them unless it is mutual.

## Card

Do not show a vote count. Do not show “people interested in you.” After reveal, show the mutual pairs or say there are none. Both are complete states.

## Open, so do not invent

The exact meaning of eligible (checked in, paid, or still present). The start clock, if it is not the recorded start. Reveal timing. Extra ballot questions.
