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

# Replace a removed guest from the waitlist in one prompt

## Context

Cancellations and no-shows can drop a table below a valid composition. The product must keep a waitlist that can suggest a replacement.

## Options considered

- Remove the guest and leave the seat empty until staff hunt
- Auto-invite the next waitlisted person with no prompt
- Prompt staff with a composition-safe suggestion

## Decision and rationale

Removal flow: Remove guest → “Replace with [Guest Name] from the waitlist?” → Yes/No. Yes approves the suggested waitlisted guest and sends the new invitation in the same workflow. No removes the guest without inviting a replacement. Suggested replacements must preserve valid table composition. Revalidate when a seat is added, removed, or replaced. Source: Linear Pre-MVP description.

## Consequences

The waitlist is both a marketing signup list and a replacement pool. Those may still be two systems (`evidence-marketing-site-code`). Build work: `FIF-31`, `FIF-32`.

## Revisit trigger

If no eligible replacement exists often enough that the prompt is noise, or if staff need to pick from a short list instead of one suggestion.
