# UI mapping — fifth-wheel

**Date:** 2026-10-23  
**Status:** facilitator draft for the Table door illustration. Iris did not sign this file.  
**Selected concept:** recommendation only.

## Visual roles

| Object | Identity | Status | Primary data | Metadata (muted or behind disclosure) |
| --- | --- | --- | --- | --- |
| Table (guest) | “Your table” plus neighborhood | Invited unpaid, or seat confirmed | When, drinks / dinner / dessert, price before pay | Internal id, the word event |
| Table (staff) | Neighborhood and when | Draft, approved, paid count, valid or below minimum | People, age in years, invitation state | Birthday, match range, tenets |
| Invitation | The table it points at | Sent, converted, void | No deadline | Sent at |
| Seat | The guest | Confirmed only after payment | Price | Stripe ids |
| Vote | This table’s ballot | Closed, open, revealed | Eligible people, mutual pairs | One-sided choices |
| WaitlistSignup | First name | On the waitlist, not a seat | Neighborhood preference | Referral |

## Action map

Actions the wireframe may render. No others.

| Surface | Primary | Secondary | Tertiary | Quaternary |
| --- | --- | --- | --- | --- |
| Your table | Pay for this seat | — | Account | — |
| Take your seat | Pay | Back to your table | — | — |
| Table review | Approve table | — | — | — |
| Approve modal | Send invitations | Keep as draft | — | — |
| Staff table | — | Remove guest | Unanswered invitations | — |
| Replacement modal | Replace with [name] | Remove without a replacement | — | Dismiss is drawn and flagged `A-11` |
| Vote | Cast vote | — | — | — |
| Mutual reveal | — | Back to your table | — | — |
| Waitlist | Join the waitlist | — | — | — |

Staff table has no primary because the night’s next act depends on the row (remove versus read the T-2 list). Approve is primary only on the draft.

## Representation

| Collection | Dominant intent | Pattern |
| --- | --- | --- |
| People on one staff table | Compare composition | Table |
| Curated tables | Monitor status | Status list |
| Ballot | Choose several people | Checklist, not a catalog |
| Mutual pairs | Read a short result | List |
| Guest home | One instance | Single table page, not cards of many nights |
