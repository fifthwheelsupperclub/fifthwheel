---
id: glossary-fifthwheel
type: glossary
status: draft
date: 2026-10-23
owner: echo
related_objects: [object-guest, object-table, object-invitation, object-seat, object-waitlist-signup, object-vote]
related_evidence: [evidence-linear-pre-mvp-scope, evidence-marketing-site-code, evidence-product-app-code]
related_decisions: [decision-staff-approve-before-invites, decision-seat-confirmed-at-payment]
---

# Fifth Wheel glossary

| Concept | Canonical domain term | UI label | Code identifier | Avoid | Notes |
| --- | --- | --- | --- | --- | --- |
| The product / the night for five | Fifth Wheel | Fifth Wheel | — | “the fifth wheel” as a person | The five-person night, not an extra guest |
| Person who may be waitlisted, invited, or seated | Guest | Guest (staff); you (guest UI) | profile / user | Customer, User in guest UI | |
| One five-person night | Table | Table | `event` | Reservation | Guest-facing Table; app code uses event |
| Paid place at a table | Seat | Seat | booking / seat | Reservation | Confirmed after payment |
| Staff-approved ask to take a seat | Invitation | Invitation | (not confirmed) | Match, reservation | Does not expire for now |
| Marketing intake / replacement pool | Waitlist | Atlanta waitlist | waitlist signup | Reservation | Two systems of record may exist |
| App proposes a valid group; staff approve | Curation | (staff) Approve table | matching | “A real person curates every table” as the whole story | Landing copy is out of date |
| Private interest ballot | Vote | Vote | vote | Poll, like | Disclose only when mutual |
| People who work the product | Staff | Staff | admin | Host (host console is a separate night-of tool) | |
| Three-stop neighborhood path | Itinerary | Drinks / dinner / dessert | itinerary | Tour | Neighborhood and venues are notes on Table, not objects yet |
