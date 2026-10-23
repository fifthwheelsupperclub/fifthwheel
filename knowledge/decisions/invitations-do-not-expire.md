---
id: decision-invitations-do-not-expire
type: decision
status: accepted
date: 2026-10-23
owner: liza
related_evidence: [evidence-linear-pre-mvp-scope, evidence-lean-list-historical]
related_objects: [object-invitation]
related_decisions: [decision-staff-approve-before-invites, decision-waitlist-replacement-prompt]
reversibility: reversible
---

# Invitations do not expire; staff follow up unanswered invites

## Context

The lean list contains invitation-expiration language. The Linear project description says that language is superseded.

## Options considered

- Invitations expire after a set window
- Invitations stay open; staff chase unanswered ones
- Invitations stay open with no staff reminder

## Decision and rationale

Invitations do not expire for now. Staff are notified about unanswered invitations two days before the event and follow up manually. Source: Linear Pre-MVP description.

## Consequences

Do not build expiry into invitation state. Build a T-2 days unanswered notice (`FIF-33`). Seat confirmation remains payment, not “invite accepted before a deadline.”

## Revisit trigger

If unanswered invitations regularly leave tables below minimum viability, or if staff cannot follow up by hand.
