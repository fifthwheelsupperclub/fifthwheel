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
| Propose roster | Assigned host or admin | Individually eligible applicants and current Table revision | Versioned proposed roster | Invalid proposals remain reviewable with reasons but cannot be approved |
| Approve roster | Admin | Current proposal passes all composition rules against current profile versions | Approved roster; one Table invitation is queued per selected guest | Invalid/stale approval commits no invitations; replay cannot queue duplicates |
| Revalidate composition | App | Profile or roster revision changes, or a guest is added/removed/replaced | Proposal becomes current-valid or invalid/stale | Approval fails until refreshed and revalidated |
| Publish | Staff | Valid accepted revision | Table becomes visible to eligible guests in the published-future browse list | Invalid/stale revisions cannot publish |
| Browse / request a Seat | Verified Guest with approved profile | Published future Table | Creates one active Seat request, not an Invitation or Seat | Repeated request remains one active request; full Table does not promise availability |

## States and transitions

| State | Meaning | May enter from | May exit to | Visible to |
| --- | --- | --- | --- | --- |
| Draft / curated | App proposed, not approved | — | Approved | Staff |
| Approved | Staff accepted composition | Draft | Inviting | Staff |
| Inviting / filling | Invitations out; seats confirming | Approved | Viable / below min | Staff; invited guests |
| Night of | Event started | Filling | Voting / complete | Guests, host |
| Complete | Night finished | Night of | — | Staff, guests (recap) |

Cutoff handling is **not decided** (`decision-table-cutoffs`). Do not add a “cancelled for low fill” state as required.

The current MVP browse/request contract is defined by [app/docs/PRD.md](../../app/docs/PRD.md), R02/A04/A05: verified guests with approved profiles can browse published future Tables and request a Seat. A request is not an Invitation or confirmed Seat. Staff-approved roster selection and a separate Table Invitation gate payment under R03/R04.

## Permissions and rules

- Target capacity five confirmed (paid) guests.
- Three- or four-person tables can be valid; minimum viability is three with mutual-preference requirements.
- Staff approval is required before automatic invitations.
- Revalidate composition on seat change.
- A roster contains 3–5 selected applicants. Individual eligibility requires an admitted member with verified email, a current complete approved profile, an active Seat request, and age 21 or older on the Table's Atlanta-local date; it does not establish compatibility with the other selected guests.
- Calculate each age on the Table date. Each Guest's matching-age bounds are whole years from 21 through 120 inclusive with maximum ≥ minimum. Every selected pair must fall inside each other's inclusive range, and the group's oldest-minus-youngest age must be no more than 12 years.
- Each selected guest must have at least one other selected guest with mutual openness: each guest's identity is included in the other's exact non-empty open-to set. Do not require mutual openness for every pair. Preserve any of the seven non-empty subsets of woman, man, and non_binary; do not broaden or infer preferences.
- Recommendations order individually eligible applicants by active request time, then guest UUID. This is a deterministic queue order, not a compatibility score; compatibility is evaluated relative to the proposed roster.
- Approval checks the proposal revision, Table revision, and each selected profile version atomically. Current profile approval is required; a change to DOB, identity, photo, or selfie requires renewed review, and a preference change revalidates future offers.
- A Seat request is not an approved roster, Table invitation, payment authority, or Seat. App admission is separate from all of these states.

These composition and approval rules follow [app/docs/PRD.md](../../app/docs/PRD.md), R01/R02/R03 and A06/A32. The run packet may specify implementation contracts for version tokens, idempotency keys, and validation reason codes, but must preserve these product rules.

## Mental-model notes

“Why five” is guest-facing. Staff may still think in events, venues, and itineraries. Do not show `event` in guest UI.

## Open questions

- Where does restaurant master data live (Linear lean list asked this; unanswered)?
- What clock starts the 90-minute voting window (scheduled drinks time vs check-in)?
