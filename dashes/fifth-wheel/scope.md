---
id: direction-fifth-wheel-pre-mvp
type: direction
status: draft
date: 2026-10-23
owner: liza
related_objects: [object-guest, object-table, object-invitation, object-seat, object-vote, object-waitlist-signup]
related_evidence: [evidence-linear-pre-mvp-scope, evidence-product-app-code, evidence-marketing-site-code, evidence-lean-list-historical]
related_decisions: [decision-staff-approve-before-invites, decision-seat-confirmed-at-payment, decision-invitations-do-not-expire, decision-voting-window-mutual-only, decision-waitlist-replacement-prompt, decision-age-from-birthdate, decision-historical-dates-not-targets, decision-launch-timing-and-success, decision-refunds, decision-rescheduling, decision-table-cutoffs]
---

# Scope — Fifth Wheel pre-MVP

## Decision needed

How the first working night runs, using the objects and decisions already in this repo: a staff-approved table, an invitation that does not expire, a seat that counts only after payment, and a private vote that discloses interest only when mutual.

Aaron has not accepted this scope. The High-stakes solo halt is recorded in `dash-config.yaml`.

## Users and breakdown

| Role | What they do in this plan | Source |
| --- | --- | --- |
| Visitor | Submits the Atlanta waitlist. That row is not an account and not a seat. | object-waitlist-signup |
| Guest | Opens an invitation, pays for a seat, attends, votes inside the window. Guest UI says “you,” not Customer. | object-guest, glossary |
| Staff | Approves a curated table, sees unanswered invites at T-2, answers one replacement prompt. | decision-staff-approve-before-invites, decision-waitlist-replacement-prompt |
| Host | Night-of console. Separate from Staff. Not the approval surface. | glossary |

## Problem

The landing page collects interest. The product app already has login, checkout, vote, reveal, and admin routes (`evidence-product-app-code`). The confirmed workflow is not the same as the landing sentence. Pre-MVP is the alignment: app proposes a valid table, staff approve, invitations send, payment confirms the seat, replacement is one prompt, voting follows the 90/30 mutual rule.

## Build mode

Align the existing app. Do not rebuild login, checkout, vote, or the admin consoles. This repo is the marketing site. The app is `fifthwheelsupperclub/app`, which is not in this tree. P7 is a stub.

## Constraints

- Invitations do not expire. No countdown. Staff get an unanswered notice two days before the table.
- A seat is confirmed after checkout/payment. Capacity counts paid seats.
- Target five confirmed guests. Three or four can be valid. Minimum viability is three with mutual-preference rules. That is not a cutoff policy.
- Age is date of birth. Years are calculated when the rule runs. Match preference is youngest and oldest, both at least 21. Two people fit only when each age falls inside the other’s range. A table’s ages span at most 12 years. Guests do not see another person’s birthday or match range.
- Historical dates, including landing “November,” are not targets.
- Refunds, rescheduling, and table cutoffs are not requirements.
- App host decision: Render free web plus a GitHub Actions drain (`decision-app-host-render-free`). Cold start is an accepted consequence, not a new hosting project.

## Success criteria for this plan

These are build criteria, not launch targets. No numeric goal is accepted (`decision-launch-timing-and-success`).

1. No invitation exists for a table before staff approve it.
2. A seat counts only after payment succeeds.
3. Invitation state has no Expired value and the guest UI shows no deadline.
4. Removing a guest asks once for one composition-safe replacement. Yes sends that invitation. No sends none. The new seat is unpaid until that guest pays.
5. Voting is closed at arrival, open for 30 minutes starting 90 minutes after the recorded start, and shows only mutual interest.
6. Guest copy uses Table, Seat, Invitation, and Vote.

## Page scoping

Primary surfaces are in `flow.md`. The wireframe illustrates the recommended concept only. Neighboring routes that exist and are out of this slice: recap, rate, host console, refund, reschedule, cutoff.

## Mental models

Owned here. Later phases read this table. They do not replace it.

| Object | Role | One sentence | Tag |
| --- | --- | --- | --- |
| WaitlistSignup | Visitor | They joined the Atlanta waitlist. The form is not an account. | observed |
| Table | Guest | The night is a table for five: drinks, dinner, dessert. The word event stays in code. | observed |
| Invitation | Guest | An open ask to take a seat, with no deadline and no seat yet. | assumed |
| Seat | Guest | The place is theirs when payment succeeds. | assumed |
| Vote | Guest | Interest is private. They learn someone’s interest only when it is mutual. | assumed |
| Table | Staff | One curated night to approve, then a paid-seat count to watch. | assumed |
| WaitlistSignup | Staff | The pool a replacement can come from. Two stores may still exist. | observed |

`observed` means the glossary, object file, or code evidence says this. `assumed` means no guest research supports it. None of the assumed lines may drive an irreversible decision. Payment confirmation, mutual reveal, and public copy are called out in `assumptions.md` for a later test (`A-6`, `A-7`, `A-1`).

## Privacy block

```yaml
privacy_gate:
  triggered: true
  applicable_regulations: [GDPR] # baseline only; not confirmed
  user_population_notes: "Atlanta adults. Age floor 21 from date of birth. COPPA under-13 is not the product intent. Birthdate, identity, and relationship intent are still sensitive. Payment via Stripe."
  path: legal_escalation
  self_check_status: escalated
  legal_sign_off:
    status: pending
    reviewer: "unassigned — needs Aaron"
    evidence_link: "dashes/fifth-wheel/privacy-review.md"
    date: ""
  tier_forced: high-stakes
pii: true
regulated_data: true
dash_tier: high-stakes
```

## Learning close

```yaml
learning_close:
  owner: "unassigned — needs Aaron"
  deadline: "unassigned — set when owner is named"
  sla_tier: high-stakes
  test_plan: dashes/fifth-wheel/research-plan.md
  status: pending
```

The Learning Gate is not cleared. Inventing a date would fake the checkpoint.

## Participant ledger

| Discipline | Person | Status |
| --- | --- | --- |
| Product direction | Liza (agent) | Draft plan only |
| Domain | Luke (agent) | Summary filed. Objects not overwritten |
| Research | Scout (agent) | Evidence classified |
| Experience | Charlie (agent) | Flows and a recommendation |
| Ethics challenge | Allie (agent) | Dissent preserved. Gate blocked |
| Privacy | Cipher (agent) | Brief filed. Sign-off pending |
| Measurement | Ledger (agent) | Candidates only. No targets |
| Human authority | Aaron | Unassigned gates. No sign-off recorded |
| Non-author tier confirmer | — | Unassigned — needs Aaron |
| Privacy / legal | — | Unassigned — needs Aaron |
