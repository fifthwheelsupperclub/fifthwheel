---
id: evidence-linear-pre-mvp-scope
type: evidence
status: observed
date: 2026-10-23
owner: scout
source_type: stakeholder
source: https://linear.app/fifthwheel/project/fifth-wheel-pre-mvp-59788221cab3
confidence: high
related_objects: [object-guest, object-table, object-invitation, object-seat, object-waitlist-signup, object-vote]
related_evidence: [evidence-lean-list-historical]
related_decisions: [decision-staff-approve-before-invites, decision-invitations-do-not-expire, decision-seat-confirmed-at-payment, decision-voting-window-mutual-only, decision-waitlist-replacement-prompt, decision-historical-dates-not-targets, decision-table-cutoffs, decision-refunds, decision-rescheduling, decision-launch-timing-and-success]
---

# Linear Pre-MVP project description

## Observation or source claim

The Fifth Wheel Pre-MVP project (`P-FIF-2`) on Linear is the confirmed product scope. It states:

- Outcome: first working experience beyond the landing page — registration and authentication, guest profiles and identity verification, automated table curation and validation, staff approval, invitations, seat payments, cancellations and replacement guests, private voting and mutual introductions, and staff oversight.
- The app automates table curation and validates composition. Staff must approve each curated table before invitations are sent automatically.
- Invitations do not expire for now. Staff are notified about unanswered invitations two days before the event and follow up manually.
- Waitlist replacement flow: Remove guest → “Replace with [Guest Name] from the waitlist?” → Yes/No. Yes approves the suggested waitlisted guest and sends the new invitation. Suggested replacements must preserve valid table composition.
- Target capacity is five confirmed guests. Three- or four-person configurations can be valid. Minimum viability is three confirmed guests with mutual-preference requirements.
- Revalidate table composition when a seat is added, removed, or replaced. A seat is confirmed after checkout/payment.
- Private voting opens 90 minutes after the event starts and closes 30 minutes later. Ballots show eligible attendees only. Disclose interest only when mutual.
- Open: detailed handling of table cutoffs, cancellations, refunds, and rescheduling; launch timing and current success targets.
- Historical launch dates and signup deadlines in the attached source are not current project targets. Confirmed decisions supersede conflicting invitation-expiration language in that source.

## Context and population

Written 2026-10-23 as the project description for team FifthWheel. It is a stakeholder brief, not a production audit.

## Limitations and contradictions

The attached lean list mixes requirements, old feedback, marketing plans, and draft terms. Where the description and the lean list disagree, the description wins. Landing-page copy still describes a person curating every table (`evidence-marketing-site-code`).

## Analyst inference

Treat this file as the default for “what is in pre-MVP” unless a later accepted decision supersedes it.

## Product implication

Build and backlog work should follow these rules. Do not revive lean-list dates as targets. Cutoffs, refunds, rescheduling, and launch success remain decisions, not requirements.
