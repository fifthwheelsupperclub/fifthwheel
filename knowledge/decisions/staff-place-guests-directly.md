---
id: decision-staff-place-guests-directly
type: decision
status: accepted
date: 2026-11-16
owner: liza
related_evidence: [evidence-product-app-code]
related_objects: [object-guest, object-table, object-invitation, object-waitlist-signup]
related_decisions: [decision-staff-approve-before-invites, decision-invitations-do-not-expire, decision-seat-confirmed-at-payment]
reversibility: reversible
---

# Staff place waitlisted guests at a table; the invitation sends on placement

Supersedes `decision-staff-approve-before-invites`.

## Context

Before this change a person passed three staff approvals before any invitation: admission off the waitlist, a photo and selfie identity review, and a host-proposed roster that an admin approved after the guest had requested a seat. The human product owner asked to remove every approval step.

## Options considered

- Keep self-serve browsing and seat requests, and drop only the approvals
- Staff place people from a queue, and the invitation goes out on placement (chosen)
- Staff assemble a full group, then send every invitation at once

## Decision and rationale

Chosen: joining the waitlist sends a confirmation email and puts the person in a staff placement queue. An admin adds them to an upcoming Table, and their Table invitation is queued in the same step. There is no admission approval, no profile review, no seat request and no roster approval. Guests are invite-only: they cannot browse Tables. Hosts no longer propose rosters.

Rules at placement:
- Hard blocks: the guest must be 21 or older on the Table's Atlanta-local date, and a Table holds at most five active invitations.
- Warnings the admin can override: a pair outside each other's age range, an age span over 12 years, or a guest with no mutual "open to" match.
- Placement does not enforce the three-guest minimum. The T−24 proceed decision covers it.

A placed guest can sign in only through their invitation: their access exists only once they are placed. Payment still confirms the Seat (`decision-seat-confirmed-at-payment`).

Implementation: `app/supabase/migrations/20261117000000_waitlist_confirmation_email.sql` and `20261117120000_remove_approval_steps.sql` (`place_guest_at_table`, `list_placement_queue`).

## Consequences

- Removing a guest no longer suggests a replacement. Staff fill the seat from the placement queue.
- Internally, each placement still writes a pending table-request row and a new approved roster revision, because checkout, fulfillment and email delivery join through them. These are bookkeeping records, not a guest action or a staff approval.
- Waitlisters who signed up before this change are not sent the new confirmation email.

## Revisit trigger

If staff placement becomes the bottleneck, or if guests ask to choose their own Tables again.
