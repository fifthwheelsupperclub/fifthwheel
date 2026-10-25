# CTA matrix

Status: current working model. A CTA is a verb on an object. Priority is for the first working night.

| Priority | Meaning |
| --- | --- |
| Primary | Required for the first working night. Put it on the object. |
| Secondary | Required support. Not the main control. |
| Deferred | Do not design or build until the named decision is made. |

CRUD is included only where a role actually does it. “The app calculates” is a rule, not a button, except where staff or guests trigger it.

## Table

| CTA | Actor | Priority | Available when | Result |
| --- | --- | --- | --- | --- |
| Propose composition | App | Primary | Candidates exist and rules can run | A draft table, or no table if the group is invalid |
| Approve table | Staff | Primary | Draft, and composition is valid | Table becomes approved. Invitations may send. Invalid composition: Approve is unavailable and nothing sends. |
| Revalidate | App | Primary | A seat is added, removed, or replaced | Table stays valid or becomes invalid. An invalid replacement must not send. |
| Publish for browse | Staff | Deferred | — | Open question: can a guest pay with no invitation after approval? Do not build a browse-and-pay path as a requirement. |

Staff do not hand-assemble the group. The app proposes. Staff approve.

## Invitation

| CTA | Actor | Priority | Available when | Result |
| --- | --- | --- | --- | --- |
| Send invitation | App | Primary | Table is approved | Invitation is sent to one guest. Must not send before approval. A failed send leaves the table approved and that invitation unsent so staff can retry. |
| Follow up unanswered | Staff | Secondary | Two days before the table, and there is still no confirmed seat | No state change. No expiry. Staff follow up by hand. |
| Void | Staff, via Remove | Primary | Guest is removed and the answer is No, or the guest is replaced | Invitation is no longer an open ask. There is no Expired state. |

There is no “invitation expires” CTA.

## Seat

| CTA | Actor | Priority | Available when | Result |
| --- | --- | --- | --- | --- |
| Pay for this seat | Guest | Primary | Invitation is sent and not void, guest is signed in, price is shown | Seat becomes confirmed. Payment failure leaves the seat unconfirmed and the invitation open. A processing payment says so. It does not say confirmed. |
| Cancel seat | Guest or staff | Deferred | — | Refunds are not decided. Do not specify who may cancel or what money does. |
| Reschedule | Guest | Deferred | — | Do not build a move-to-another-table flow. |

A replacement guest’s seat is confirmed only when that guest pays. Yes on the replacement prompt sends an invitation. It does not create a confirmed seat.

## Guest

| CTA | Actor | Priority | Available when | Result |
| --- | --- | --- | --- | --- |
| Remove guest | Staff | Primary | The person is on that table | Asks once: “Replace with [name] from the waitlist?” |
| Register / sign in | Guest | Primary | They have an email | An account exists. The waitlist form does not do this. |
| Verify identity | Guest | Secondary | Signed in | Verification is in the pre-MVP scope. When it is required (before invite, before pay, or before the night) is open. Do not invent that gate. |

## Vote

| CTA | Actor | Priority | Available when | Result |
| --- | --- | --- | --- | --- |
| Open voting | App | Primary | 90 minutes after the recorded start | Guests can cast. Voting is closed at check-in. |
| Cast vote | Guest | Primary | Window is open and the guest has a confirmed seat | Ballot stored. A late submit stores nothing. |
| Close voting | App | Primary | 30 minutes after open | No new votes. |
| Reveal mutual interest | App | Primary | After close | Show an unordered pair only when both expressed interest. Never show one-sided interest. |

Which clock is “the start,” and which confirmed guests are “eligible,” are still open. Until that is decided, implement the rule as written: recorded start, confirmed seat, eligible attendees only. Do not widen the ballot to invited-but-unpaid guests.

## Waitlist signup

| CTA | Actor | Priority | Available when | Result |
| --- | --- | --- | --- | --- |
| Join the waitlist | Visitor | Primary | Required fields valid, age from birthdate at least 21 as of today, match ages at least 21, oldest at least youngest | A signup is stored. Copy says they are on the waitlist, not that they have a table. |
| Suggest as replacement | App | Primary | A guest was removed and at least one person keeps the composition valid | Staff see one named person, not a ranked list. |
| Replace with [name] | Staff | Primary | The prompt is showing and the suggestion is still valid | Yes sends one invitation. No removes without an invitation. If nobody is eligible, Yes is unavailable and No still removes. |

The current marketing endpoint does not persist birthdate or match-range keys. Joining the waitlist is not done until those keys are stored.

## Broken-object check

Every object has at least one primary CTA. Waitlist signup is acted on by visitors and, later, by staff through the replacement prompt. It is not a dead record.
