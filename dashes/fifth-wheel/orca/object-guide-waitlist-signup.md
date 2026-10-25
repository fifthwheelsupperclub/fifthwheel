# Object guide: Waitlist signup

A waitlist signup is one person’s intake row for Atlanta tables. It is the pool a replacement can come from.

It is not a guest account and not a seat. Visitors think they joined the Atlanta waitlist. They did not get a table.

## Attributes on the form

| Attribute | Required | Sensitive |
| --- | --- | --- |
| First name | Yes | Yes |
| Email | Yes | Yes |
| Date of birth | Yes | Yes |
| Identity | Yes | Yes. Woman, Man, or Non-binary. |
| Seat you with | On the form | Yes |
| Youngest and oldest they will meet | Yes | Yes. Both at least 21. Oldest at least youngest. |
| Looking for | Yes | Yes. Casual, Open, or Relationship. |
| Surprise game | On the form | No |
| Neighborhood | Yes | No. Inman Park, Chamblee, or Virginia Highlands. A preference, not an assignment. |
| Nights | On the form | No |
| Referral | On the form | No |

The form sends `birthdate`, `match_age_min`, and `match_age_max`. The current waitlist API does not persist those keys. This object is not done until they are stored, or until a different store is named.

Age on the form is checked against today, because there is no table date. Do not derive a birthday from an integer age or from an old age band.

## States

| State | Meaning |
| --- | --- |
| Submitted | On a waitlist store. |
| Used as a replacement | Staff said Yes, and an invitation was sent. |

No expiry is specified for these rows.

## Calls to action

| Action | Who | Priority |
| --- | --- | --- |
| Join the waitlist | Visitor | Primary. Success copy: on the waitlist. Not “you have a table.” Field errors do not claim a seat. |
| Suggest as replacement | App | Primary, after a removal, and only if the person keeps the table valid. |
| Replace with [name] | Staff | Primary. Yes sends one invitation. No sends none. |

## Rules

- The signup is not nested on the table.
- A suggestion must pass mutual age fit and the 12-year span.
- One named person, not a list.
- If nobody qualifies, removal still proceeds.
- Marketing waitlist and app waitlist may be two stores. Do not assume an email match is the same person.

## Card

Staff, on the replacement prompt: the person’s name, and enough to see they keep the table valid. Not a ranked queue.

The public form is the visitor’s only view of this object.

## Open, so do not invent

One system of record. Whether someone can be suggested before they have an app account and verification. Whether neighborhood limits which table they can join.
