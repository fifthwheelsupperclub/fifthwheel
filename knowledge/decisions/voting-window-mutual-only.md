---
id: decision-voting-window-mutual-only
type: decision
status: accepted
date: 2026-10-23
owner: liza
related_evidence: [evidence-linear-pre-mvp-scope, evidence-product-app-code]
related_objects: [object-vote, object-table, object-guest]
related_decisions: []
reversibility: reversible
---

# Timed private vote; disclose interest only when mutual

## Context

The night ends with a private vote about other guests at the table. Vote/reveal routes exist in the app; they still need a rules pass against this decision.

## Options considered

- Open voting for the whole night
- Show every vote to every guest
- Timed window, eligible attendees only, mutual disclosure

## Decision and rationale

Private voting opens 90 minutes after the event starts and closes 30 minutes later. Ballots show eligible attendees only. Disclose interest only when mutual. Source: Linear Pre-MVP description.

## Consequences

Product must hide non-mutual interest. Voting is not available at check-in. Implementation work is `FIF-30`, not a new voting product.

## Revisit trigger

If event start time is unreliable, or if dessert-stop timing makes the 90/30 window unusable in the room.
