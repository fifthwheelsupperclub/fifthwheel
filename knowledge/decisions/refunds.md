---
id: decision-refunds
type: decision
status: proposed
date: 2026-10-23
owner: liza
related_evidence: [evidence-linear-pre-mvp-scope, evidence-product-app-code]
related_objects: [object-seat]
related_decisions: [decision-seat-confirmed-at-payment, decision-waitlist-replacement-prompt]
reversibility: unknown
---

# Cancellation refund policy

## Context

Cancel-booking code and a cancellation email exist. Linear still lists refunds as an open operational choice.

## Options considered

Not decided. Needs: who is refunded, when, and through which Stripe path, including staff-removed guests versus guest-initiated cancel.

## Decision and rationale

Not decided.

## Consequences

Do not treat refunds as a requirement. Linear: `FIF-36`. Lean-list notes about discount codes for substitutes are not confirmed.

## Revisit trigger

A paid seat is cancelled in production, or legal/finance asks for a written policy.
