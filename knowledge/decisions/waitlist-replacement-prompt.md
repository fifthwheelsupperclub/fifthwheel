---
id: decision-waitlist-replacement-prompt
type: decision
status: accepted
date: 2026-10-23
owner: liza
related_evidence: [evidence-linear-pre-mvp-scope]
related_objects: [object-guest, object-table, object-invitation, object-waitlist-signup, object-seat]
related_decisions: [decision-staff-approve-before-invites, decision-seat-confirmed-at-payment]
reversibility: reversible
---

# Replace a removed guest in one prompt

## Context

Cancellations and no-shows can drop a table below a valid composition. The product must keep a pool of eligible people who can be suggested as a replacement.

## Options considered

- Remove the guest and leave the seat empty until staff hunt
- Auto-invite the next waitlisted person with no prompt
- Prompt staff with a composition-safe suggestion

## Decision and rationale

Removal flow: Remove guest → “Invite [Guest Name] instead?” → Yes/No. Yes approves the suggested guest and sends the new invitation in the same workflow. No removes the guest without inviting a replacement. Suggested replacements must preserve valid table composition. Revalidate when a seat is added, removed, or replaced. Source: Linear Pre-MVP description, which phrased the prompt as “Replace with [Guest Name] from the waitlist?”.

## Consequences

Terminology (2026-11-14, language refactor D-21): “waitlist” means only website signups without app access. In UI copy the replacement pool is called “people who requested this table”. The shipped pool is pending seat requests for the table (`replacement_candidates`). Whether waitlist signups should also be eligible is still open (see `objects/waitlist-signup.md`). Build work: `FIF-31`, `FIF-32`.

## Revisit trigger

If no eligible replacement exists often enough that the prompt is noise, or if staff need to pick from a short list instead of one suggestion.
