---
id: object-invitation
type: object
name: Invitation
status: draft
date: 2026-10-23
owner: luke
source_project: fifthwheel
derived_from: null
evidence: [evidence-linear-pre-mvp-scope]
related_objects: [object-guest, object-table, object-seat, object-waitlist-signup]
related_evidence: [evidence-linear-pre-mvp-scope, evidence-product-app-code]
related_decisions: [decision-invitations-do-not-expire, decision-staff-approve-before-invites, decision-waitlist-replacement-prompt]
---

# Invitation

## Definition

The staff-approved ask to take a Seat at a Table. It is addressed to a WaitlistSignup and points at a Guest once that person signs in. Distinguished from a Seat (paid confirmation).

## Attributes

| Attribute | Meaning | Required | Sensitive | Source |
| --- | --- | --- | --- | --- |
| Guest | Who was invited | yes | yes | Linear workflow |
| Table | Which night | yes | no | Linear workflow |
| Sent at | When it went out | Assumed | no | Assumed for T-2 unanswered notice |
| Answered | Whether the guest has progressed toward a seat | Assumed | no | Linear: unanswered invitations |

No expiry timestamp. Lean-list expiration language is superseded.

## Relationships

| Related object | Relationship | Cardinality | Direction | Lifecycle consequence |
| --- | --- | --- | --- | --- |
| Table | Belongs to | 1 | Invitation → Table | Sent only after staff approve the table |
| WaitlistSignup | Addressed to | 1 for a launch invite | Invitation → Signup | `waitlist_id` is set when staff invite, including a replacement. The row can exist before a Guest. |
| Guest | Set when they claim | 0..1 until claim, then 1 | Invitation → Guest | `profile_id` is filled at sign-in. A seat still requires that Guest. |
| Seat | May become | 0..1 | Invitation → Seat | Seat exists when paid |

## Actions

| Action | Actor | Preconditions | State change | Failure behavior |
| --- | --- | --- | --- | --- |
| Send automatically | App | Table approved | Invitation sent | Must not send before approval |
| Follow up unanswered | Staff | Two days before the event, still unanswered | No expiry; manual follow-up | Notice to staff (`FIF-33`) |
| Replace | Staff | Guest removed; eligible waitlisted suggestion | New invitation if Yes | Must preserve composition |

## States and transitions

| State | Meaning | May enter from | May exit to | Visible to |
| --- | --- | --- | --- | --- |
| Sent / unanswered | Invite out, no confirmed seat | — | Seat confirmed / guest removed | Guest, staff |
| Converted | Guest paid | Unanswered | — | Guest, staff |
| Void | Guest removed without replacement, or replaced | Unanswered | — | Staff |

There is no Expired state for now.

## Permissions and rules

Invitations do not expire. Staff, not the app, chase unanswered invites at T-2 days. Sending is gated on table approval.

## Mental-model notes

Guests should hear “you're invited to this table,” not “your reservation expires.”

## Open questions

- Does “unanswered” mean no click, no account, or no payment?
- The invitation is a row. `waitlist_id` is who was asked. `profile_id` is filled when they sign in. There is no expiry column.
- What does the guest receive (email/SMS) as the invitation artifact?
