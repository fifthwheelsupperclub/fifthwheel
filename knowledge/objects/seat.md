---
id: object-seat
type: object
name: Seat
status: draft
date: 2026-10-23
owner: luke
source_project: fifthwheel
derived_from: null
evidence: [evidence-linear-pre-mvp-scope, evidence-product-app-code]
related_objects: [object-guest, object-table, object-invitation]
related_evidence: [evidence-linear-pre-mvp-scope, evidence-product-app-code]
related_decisions: [decision-seat-confirmed-at-payment, decision-refunds, decision-rescheduling]
---

# Seat

## Definition

A Guest's paid place at a Table. Distinguished from Invitation (not yet confirmed) and from capacity as a number.

## Attributes

| Attribute | Meaning | Required | Sensitive | Source |
| --- | --- | --- | --- | --- |
| Guest | Who occupies it | yes once confirmed | yes | Checkout |
| Table | Which night | yes | no | `book/[id]` |
| Price | Amount paid | Assumed | yes | `seat_price_cents`, Stripe |
| Confirmed | After checkout/payment | yes | no | Linear rule |

App also has seat holds and hold expiry (`seat_holds`, `hold_expiry_sweep` migrations). Hold-versus-confirmed-seat is an implementation detail; confirmed Seat is the domain object.

## Relationships

| Related object | Relationship | Cardinality | Direction | Lifecycle consequence |
| --- | --- | --- | --- | --- |
| Table | Belongs to | 1 | Seat → Table | Counts toward 5 / min 3 |
| Guest | Occupied by | 1 | Seat → Guest | Removal may trigger replacement |
| Invitation | Often follows | 0..1 | Invitation → Seat | Not required if browse-and-pay exists (open) |

## Actions

| Action | Actor | Preconditions | State change | Failure behavior |
| --- | --- | --- | --- | --- |
| Pay | Guest | Table available / invited (open) | Seat confirmed | Payment failure; hold may expire (code, not a domain rule here) |
| Cancel | Guest or staff | Confirmed seat | Seat released; composition revalidated | Refund **not decided** |
| Replace occupant | Staff | Removal prompt Yes | New guest invited; seat not confirmed until they pay | Suggestion must keep valid composition |

## States and transitions

| State | Meaning | May enter from | May exit to | Visible to |
| --- | --- | --- | --- | --- |
| Confirmed | Paid | — | Cancelled / replaced occupant | Guest, staff |
| Cancelled | Released | Confirmed | — | Guest, staff |

Hold/pending-payment is observed in code, not elevated to a required domain state until verified.

## Permissions and rules

A seat is confirmed after checkout/payment. Revalidate the table when a seat is added, removed, or replaced. Refunds and reschedules are open decisions.

## Mental-model notes

Guests buy a seat at a table, not a generic ticket. “Reservation” is avoided in the glossary.

## Open questions

- Is a hold a Seat in a pending state or a different object?
- After replacement Yes, is the new guest's seat confirmed only after they pay?
- Who may cancel (guest self-serve vs staff only)?
