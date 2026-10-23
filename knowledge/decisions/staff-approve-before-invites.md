---
id: decision-staff-approve-before-invites
type: decision
status: accepted
date: 2026-10-23
owner: liza
related_evidence: [evidence-linear-pre-mvp-scope]
related_objects: [object-table, object-invitation]
related_decisions: [decision-invitations-do-not-expire]
reversibility: reversible
---

# Staff approve a curated table before invitations send

## Context

Pre-MVP needs a table-assembly workflow that is not fully manual and not fully automatic. Landing copy still says a person curates every table (`evidence-marketing-site-code`).

## Options considered

- Staff assemble every table by hand with no app validation
- App sends invitations as soon as a scored group exists
- App proposes and validates a table; staff approve; then invitations send automatically

## Decision and rationale

Chosen: the app automates table curation and validates composition. Staff must approve each curated table before invitations are sent automatically. Source: Linear Pre-MVP description.

## Consequences

Invitations are not a guest self-serve “book any open seat” path until after staff approval. Admin match UI in the app must grow an approval gate (`FIF-8`, `FIF-28`).

## Revisit trigger

If staff approval becomes the bottleneck for a working first night, or if composition validation is trusted enough to auto-send without a human.
