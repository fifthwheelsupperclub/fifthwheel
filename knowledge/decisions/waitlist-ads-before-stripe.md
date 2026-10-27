---
id: decision-waitlist-ads-before-stripe
type: decision
status: accepted
date: 2026-10-26
owner: liza
related_evidence: []
related_objects: [object-waitlist-signup, object-seat]
related_decisions: [decision-seat-confirmed-at-payment]
reversibility: reversible
---

# Waitlist ads may start before Stripe is proven

## Context

The launch bar for ads was honest public copy, a Meta Lead in Events Manager, and a paid dry-run that confirms a seat. Copy is live. Events Manager shows Lead. Stripe live keys, Identity, webhook, and a staff paid path are not proven. Aaron accepted waitlist-only ads rather than wait.

## Options considered

- Keep ads off until a staff paid path confirms a seat
- Start ads to collect waitlist only, and prove Stripe later
- Confirm seats without payment so the waitlist can be seated immediately

## Decision and rationale

Start public waitlist collection, including Meta ads, without a proven paid path. A waitlist row is still not a seat. A seat is still confirmed only after payment (`decision-seat-confirmed-at-payment`). Do not invite a stranger to pay until Stripe, Identity, and the webhook have been proven on a staff email.

## Consequences

Ads may turn on. Do not tell a waitlist person they have a table, a paid seat, or a refund path. [FIF-42](https://linear.app/fifthwheel/issue/FIF-42) remains the seating blocker, not the ads blocker. Refunds and cutoffs stay undecided.

## Revisit trigger

A paid dry-run confirms a seat, or a guest is invited to pay before that proof exists.
