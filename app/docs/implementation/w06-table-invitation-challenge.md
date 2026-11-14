---
id: challenge-w06-table-invitation-delivery
type: challenge
status: draft
date: 2026-11-13
owner: allie
related_objects: [object-invitation, object-seat, object-guest, object-table]
related_evidence: [../PRD.md, w06-table-invitation-delivery-contract.md, w06-roster-contract.md, ../architecture.md]
related_decisions: [../../knowledge/decisions/invitations-do-not-expire.md]
---

# Challenge

## Evidence update (2026-11-13)

This challenge was written before the W06.5 browser slice completed. Its invitation-deep-link finding is now resolved: the guarded browser journey sent an invitation through local Mailpit, followed the member's actual returning magic link, and landed on the exact owner-scoped invitation detail; see [W06.5 browser evidence](w06.5-browser-slice-evidence.md). The UI now says “You’re invited to this Table,” matching the suggested wording. The local delivery/DB recovery evidence also now passes; production sender and scheduler remain unverified. A07 is still intentionally open: W07 must provide an authoritative Seat-status reader, and the human must decide audience/channel before reminders are implemented.

## What I am challenging

Whether W06.5's Table Invitation history, email delivery/recovery, and active-invite overlay are ready to accept as a coherent member journey under PRD R03/A07. The intended outcome is that an invited member can understand the offer, recover it after sign-in, and distinguish it from a request or paid Seat, while staff can safely recover delivery. Evidence reviewed: the W06.5 delivery contract, roster contract, PRD, invitation knowledge, member/admin UI and API/service paths, and current task/acceptance ledgers.

## Strongest case against

The core object model and recovery boundaries are strong, but a signed-out recipient is sent back to generic Requests instead of the invitation they opened, and A07's notification audience/channel is not pinned down against the existing staff-follow-up decision. Accepting the slice without resolving these details risks a broken deep-link journey and a reminder behavior users or staff did not expect.

## Findings

| Finding | Severity | Evidence or assumption | Smallest next step |
| --- | --- | --- | --- |
| Invitation deep link loses its destination through sign-in. | Acceptance gap; moderate | `MemberTableInvitationWorkspace` links signed-out users to `/sign-in?returnTo=%2Frequests`. `sign-in.tsx` only permits `/tables`, `/tables/:id`, or `/requests` as `returnTo`; `/invitations/:id` is rejected and falls back to `/member`. A recipient who opens the invitation while signed out therefore does not resume that invitation after requesting/using a magic link. | Allow only a validated invitation UUID route in the safe-return pattern, pass that route from the invitation page, and test the actual emailed link through callback, refresh and a second device. Keep open-redirect rejection. |
| A07's audience and channel are ambiguous. | Product risk; moderate | PRD A07 says a T−48 reminder identifies active invitations without a confirmed Seat, but does not name its recipient/channel. The accepted project decision and `object-invitation.md` say staff are notified two days before and follow up manually. The W06.5 contract defines a per-invitation `reminder_t48` outbox message, which could be read as an automated guest email. | Explicitly say whether A07 is a staff notice for manual outreach, a guest email, or both, and identify the owner of the missed-job warning. Align the outbox/job contract before implementation. Preserve non-expiry and no invitation-state change. |
| “A place is offered for you” can suggest a reserved Seat. | Reversible product-language risk; low | The invitation detail headline uses that phrase, while the same card correctly says the invitation is separate from the request and does not confirm a paid Seat. PRD R03 treats an invitation as named checkout permission; payment creates the Seat. | Consider “You’re invited to this Table” and keep the explicit “no paid Seat yet” explanation. Validate the phrase in the first usability review; no state change is needed. |
| W06.5 is not yet acceptance-ready on the evidence recorded. | Acceptance gap; expected/open | The W06 task ledger says W06.5 persistence/worker checks and browser journey remain in progress; the contract lists worker lease/finish/unknown reconciliation, failed-retry replay, changed-body conflict, privacy, rollback and cross-role checks as required. It also states this slice sends no email and production sender/scheduler remain unverified. | Keep W06.5 `implementing` until local intercepted delivery, real callback journey, service/DB permission and recovery cases pass. Do not describe queued delivery as email sent. Track production sender and scheduler separately from local MVP acceptance. |

## T−48 dependency assessment

Deferring A07 enqueue/filter behavior until W07 provides an authoritative `SeatStatusReader` is correct. The invitation is not a Seat, and the existing decision says paid confirmation creates the Seat; an active invitation alone cannot prove the member has no confirmed Seat. Queueing a reminder before that relation exists could prompt someone who already paid, while treating unknown payment state as unpaid would be unsafe. The contract's rule that unknown Seat state is not unpaid is sound. Freeze the job shape now, but keep A07 pending until the reader, DB-clock due calculation, Table/revision/kind dedupe, per-invitation idempotency, late-run backfill and persistent missed-notice warning are verified.

## Preserve list

- Keep app admission, source request, Table Invitation, delivery attempts, checkout hold and paid Seat distinct.
- Keep active offers visible beside the still-pending request and suppress request withdrawal while an active invitation exists.
- Keep invitations non-expiring and delivery failure/uncertainty independent of invitation state.
- Keep provider acceptance distinct from confirmed delivery; unknown outcomes must reconcile before retry.
- Keep admin retry limited to known failures, operation-idempotent, and incapable of changing roster/request/Seat state or sending inline.
- Keep owner-only member detail, safe DTO redaction, the source-request Table summary fallback, and public itinerary only when current supply is available.
- Keep T−48 eligibility blocked on authoritative Seat status; never infer nonpayment from invitation state.

## Evidence gaps and recommended checks

- Browser: open a Table invitation link signed out; complete the actual local magic-link callback; verify the browser lands on that exact invitation, and verify safe return validation rejects external/unsafe destinations.
- Overlay: prove an active invitation and pending request appear as separate states; no Withdraw action is available; revoked/closed history remains visible; payment/Seat status is never implied.
- Permissions/recovery: anonymous, unadmitted, wrong-member, host and restaurant direct-ID reads are denied without cross-member disclosure; worker unknown blocks resend; failed retry is replay-safe and changed-body/operation reuse conflicts.
- A07 after W07: cover paid, no Seat, refunded/cancelled, and unknown Seat states; exact T−48 boundary; duplicate/late jobs; reminder idempotency; missed-job warning; no invitation transition.
- Confirm the A07 audience/channel against the historic manual staff-follow-up decision before choosing email copy or outbox recipient.

## Simplification options

Do not add an “accept invitation” state or a member-side acknowledgement button unless a real downstream behavior needs it; the existing distinctions already explain that checkout creates a Seat. Keep staff recovery focused on known failed delivery and route unknown outcomes to reconciliation. Treat T−48 audience selection as a small policy decision rather than adding multiple notification channels speculatively.

## Verdict

**Proceed with conditions.** The domain boundaries, privacy approach and delivery recovery model are sound. Before W06.5 acceptance, preserve the invitation deep link across sign-in and complete its actual callback test. Before implementing A07, resolve its audience/channel against the existing staff follow-up decision and then prove the Seat-status and scheduled-job invariants. Current UI wording is a low-risk refinement, not a reason to stop the slice.
