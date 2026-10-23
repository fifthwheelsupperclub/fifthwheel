---
id: decision-seat-confirmed-at-payment
type: decision
status: accepted
date: 2026-10-23
owner: liza
related_evidence: [evidence-linear-pre-mvp-scope, evidence-product-app-code]
related_objects: [object-seat, object-table]
related_decisions: [decision-refunds]
reversibility: reversible
---

# A seat is confirmed after payment

## Context

Table capacity is counted in confirmed guests. Checkout already exists in the product app.

## Options considered

- Confirm when the guest accepts an invitation
- Confirm when staff assign a seat
- Confirm after checkout/payment

## Decision and rationale

A seat is confirmed after checkout/payment. Source: Linear Pre-MVP description.

## Consequences

Capacity, minimum viability (three), and replacement logic should count paid seats, not merely invited guests. Refund policy is still open (`decision-refunds`).

## Revisit trigger

If a guest must be treated as committed before payment (for example a staff-held seat), record a new decision.
