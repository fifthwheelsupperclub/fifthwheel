---
id: object-table
type: object
name: Table
status: draft
date: 2026-10-23
owner: luke
source_project: fifthwheel
derived_from: null
evidence: [evidence-linear-pre-mvp-scope, evidence-product-app-code, evidence-marketing-site-code]
related_objects: [object-guest, object-invitation, object-seat, object-vote]
related_evidence: [evidence-linear-pre-mvp-scope, evidence-product-app-code]
related_decisions: [decision-staff-approve-before-invites, decision-seat-confirmed-at-payment, decision-table-cutoffs, decision-voting-window-mutual-only]
---

# Table

## Definition

One Fifth Wheel night for a small group in one Atlanta neighborhood: drinks, dinner, dessert, then a private vote. Guests call this a table. Code stores it as `event` (`src/lib/events.ts`).

Not a restaurant, not a waitlist row, not a single seat.

## Attributes

| Attribute | Meaning | Required | Sensitive | Source |
| --- | --- | --- | --- | --- |
| When | Event date and drinks time | Assumed for a published night | no | `event_date`, `drinks_time` in app |
| Neighborhood / itinerary | Walkable three-stop path | Assumed | no | itineraries in app; landing shows Virginia Highlands example |
| Capacity | Target five confirmed guests | yes | no | Linear: target 5; valid 3–4; min 3 with mutual-preference rules |
| Status | Staff/lifecycle | Assumed | no | App `status` includes published for browse |
| Seat price | Amount charged | Assumed for checkout | no | `seat_price_cents` |

Neighborhood and venues stay attributes of the itinerary, not separate objects in this pass.

## Relationships

| Related object | Relationship | Cardinality | Direction | Lifecycle consequence |
| --- | --- | --- | --- | --- |
| Seat | Has | 0..capacity | Table → Seat | Confirmed seats define viability |
| Invitation | Sends after approval | 0..n | Table → Guest | No expiry |
| Guest | Hosts | 3..5 confirmed for a viable night | Table ↔ Guest | Revalidate on add/remove/replace |
| Vote | Opens on a timer | 0..1 voting period | Table → Vote | 90 minutes after start, 30-minute window |

## Actions

| Action | Actor | Preconditions | State change | Failure behavior |
| --- | --- | --- | --- | --- |
| Publish | Staff | Valid accepted revision | Table can receive placements | Invalid/stale revisions cannot publish |
| Place a guest | Admin | Published future Table with fewer than five active invitations; guest 21+ on the Table date | One Table invitation queued; the roster gains a revision | Preference-rule warnings need confirmation; replay cannot queue duplicates |
| Remove a guest | Admin | Active invitation | Invitation revoked (and Seat cancelled, refund owed if paid) | Staff fill the seat from the placement queue |

## States and transitions

| State | Meaning | May enter from | May exit to | Visible to |
| --- | --- | --- | --- | --- |
| Published | Open for placements | — | Inviting | Staff |
| Inviting / filling | Invitations out; seats confirming | Published | Viable / below min | Staff; invited guests |
| Night of | Event started | Filling | Voting / complete | Guests, host |
| Complete | Night finished | Night of | — | Staff, guests (recap) |

Cutoff handling is **not decided** (`decision-table-cutoffs`). Do not add a “cancelled for low fill” state as required.

Guests cannot browse Tables or request Seats. An admin places each guest from the waitlist queue and the invitation sends on placement (`decision-staff-place-guests-directly`).

## Permissions and rules

- Target capacity five confirmed (paid) guests.
- Three- or four-person tables can be valid; minimum viability is three with mutual-preference requirements.
- No approval step: an admin's placement queues the invitation.
- Hard rules at placement: at most five active invitations; each guest 21 or older on the Table's Atlanta-local date.
- Warnings at placement (the admin may override): every pair inside each other's inclusive age range (whole years 21–120), an oldest-minus-youngest span of no more than 12 years, and each guest having at least one other guest with mutual openness (each identity in the other's exact non-empty open-to set). Preserve any of the seven non-empty subsets of woman, man, and non_binary; do not broaden or infer preferences.
- The placement queue is ordered by waitlist signup time, oldest first.

These rules follow `decision-staff-place-guests-directly` (2026-11-16), which replaced the roster-approval rules of PRD R02/R03.

## Mental-model notes

“Why five” is guest-facing. Staff may still think in events, venues, and itineraries. Do not show `event` in guest UI.

## Open questions

- Where does restaurant master data live (Linear lean list asked this; unanswered)?
- What clock starts the 90-minute voting window (scheduled drinks time vs check-in)?
