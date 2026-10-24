# Flow — Fifth Wheel pre-MVP night

**Dash**: fifth-wheel  
**Date**: 2026-10-23  
**User role**: Guest and Staff (Host excluded)  
**In-scope objects**: guest, table, invitation, seat, vote, waitlist-signup  
**Steward**: Charlie. Liza checked the forced moves against accepted decisions.  
**Reconciliation Gate**: not cleared. Assumed mental models are listed in `scope.md` and must not drive an irreversible choice without a test in `assumptions.md`.

## Mental models

See `scope.md`. This phase does not author a second table.

## Scenarios

### Scenario 1: Invited guest pays and is seated — maps to "a seat counts only after payment"

Maya opens one invitation. She signs in, pays, and only then has a confirmed seat. Voting stays closed when she arrives. Interest is disclosed only when mutual.

### Scenario 2: Staff approve a curated table and invitations send — maps to "no invitation before approval"

The app proposes a valid table. Staff approve it. Invitations send from that approval and do not expire.

### Scenario 3: Staff remove a guest and answer one replacement prompt — maps to "Yes sends one safe invitation; No sends none"

Staff remove Jordan and see “Replace with Sam from the waitlist?” Sam’s seat stays unconfirmed until Sam pays. The flow has no refund, reschedule, or cutoff step.

## Flow steps

### Scenario 1 flow

| Step # | Actor | Action | Object touched | State change |
| --- | --- | --- | --- | --- |
| 1 | Guest | Open the invitation | Invitation, Table | Sees the table, invited and unpaid. No deadline. Void invite shows Invitation closed and no pay action. |
| 2 | Guest | Sign in | Guest | Returns to this table. Auth failure leaves the invitation sent. |
| 3 | Guest | Finish profile if needed | Guest | Pay stays unavailable until the profile can be used. Required fields beyond the marketing form are open (`A-12`). |
| 4 | Guest | Pay for this seat | Seat, Invitation | Checkout starts only with this invitation. No invitation means permission denied and no seat. |
| 5 | Guest | Complete payment | Seat | Failure or a lapsed hold leaves the seat unconfirmed and the invitation open. |
| 6 | App | Confirm after payment | Seat, Table | Seat confirmed, invitation converted, composition revalidated. A delayed webhook shows processing, not confirmed. |
| 7 | Guest | Open Tonight | Table | Only a confirmed seat. Voting is closed. |
| 8 | App | Open the window | Vote | 90 minutes after the recorded start, for 30 minutes. Outside it, Vote closed accepts nothing. |
| 9 | Guest | Cast | Vote | Stored private. A late submit is rejected. |
| 10 | App | Reveal | Vote | Mutual pairs only. One-sided interest is absent in empty, loading, and error states. |

### Scenario 2 flow

| Step # | Actor | Action | Object touched | State change |
| --- | --- | --- | --- | --- |
| 1 | App | Propose a valid composition | Table | Invalid groups are not approvable and have no invitations. Rules: mutual age inclusion, span ≤ 12 years, target 5, valid at 3–4, minimum 3. |
| 2 | Staff | Review the draft | Table, Guest | Age in years visible. Birthday behind an explicit disclosure. Zero invitations. |
| 3 | Staff | Approve | Table | Confirmation states invitations will send and stay open. Dismiss leaves the table in draft. |
| 4 | App | Send | Invitation | One sent invitation per guest. A failed send stays unsent and can be retried. No expired state. |
| 5 | Staff | Read the T-2 notice | Invitation | Lists invitations with no confirmed seat. The notice does not void them. |

### Scenario 3 flow

| Step # | Actor | Action | Object touched | State change |
| --- | --- | --- | --- | --- |
| 1 | Staff | Choose Remove | Guest | The person stays until the prompt is answered. Dismiss-without-remove is `A-11`, not a decision. |
| 2 | App | Suggest one safe person | WaitlistSignup, Table | No safe person: Yes is unavailable. Staff can still remove with no invite. |
| 3a | Staff | Yes | Invitation, Seat | Jordan’s open invitation voids. A paid seat is released. What happens to the charge is not decided. Sam gets one invitation and is unpaid. An invalid Sam does not send. |
| 3b | Staff | No | Guest, Seat | Jordan is removed. Nobody is invited. Paid count updates. The table may sit under five or under three. No cutoff action appears. |

## Pages / screens / modals

| Name | Type | Trigger (step #) | Objects present |
| --- | --- | --- | --- |
| Atlanta waitlist | page | Visitor, before scenario 2 | WaitlistSignup |
| Sign in | page | Scenario 1 step 2 | Guest |
| Your table | page | Scenario 1 step 1 | Table, Invitation |
| Take your seat | page | Scenario 1 step 4 | Seat, Table, Invitation |
| Payment return | screen | Scenario 1 step 5–6 | Seat |
| Invitation closed | screen | Scenario 1 step 1 failure | Invitation |
| Seat not offered | screen | Scenario 1 step 4 failure | Seat, Invitation |
| Tonight | page | Scenario 1 step 7 | Table |
| Vote | page | Scenario 1 step 8–9 | Vote, Guest |
| Vote closed | screen | Scenario 1 step 8 failure | Vote |
| Mutual reveal | page | Scenario 1 step 10 | Vote |
| Curated tables | page | Scenario 2 step 2 | Table |
| Table review | page | Scenario 2 step 2–3 | Table, Guest |
| Approve confirmation | modal | Scenario 2 step 3 | Table, Invitation |
| Staff table | page | Scenario 2 step 5, scenario 3 | Table, Invitation, Seat, Guest |
| Replacement prompt | modal | Scenario 3 | Guest, WaitlistSignup, Invitation, Seat |
| Unanswered invitations | page | Scenario 2 step 5 | Invitation, Seat |

Identity verification, account, recap, and rate exist in the app and are edges, not happy-path pages. The host console is not an approval surface.

## Goal-page map

| Success criterion | Page / component | Notes |
| --- | --- | --- |
| No invitation before approval | Table review, Approve confirmation | Approve is the send. |
| Seat counts only after payment | Your table, Take your seat, Payment return | Processing is not confirmed. |
| No expiry and no deadline | Your table, Unanswered invitations | T-2 is a staff notice. |
| One replacement prompt | Replacement prompt | Yes / No. Charge outcome absent on purpose. |
| Mutual-only timed vote | Tonight, Vote, Vote closed, Mutual reveal | Closed on arrival. |
| Guest language is Table | Your table | Do not show event. |

## Constraints log

| Constraint | Design move forced in P6 |
| --- | --- |
| Guest word for the night is Table | Page title “Your table.” No event label. |
| Approve, then automatic send | One primary Approve on the draft. No per-guest Send. |
| Seat confirmed at payment | Primary Pay. Status text “Confirmed” only after payment. |
| Invitations do not expire | No countdown, no “expires” copy. |
| One replacement prompt | Modal names the person. Yes and No are separate. No ranked picker. |
| Mutual vote, 90/30, closed at check-in | Tonight says voting is closed. Vote page states the window in words. Reveal list has no one-sided rows. |
| Age rules | Staff see age in years. Birthday is a disclosure, not a column. Guests do not see match ranges. |
| November is not a target | Waitlist wireframe does not repeat a month as a promise. The live page still does; that is copy debt, not a date. |
| Do not rebuild existing routes | Wireframe labels gates on login, book, vote, reveal, and admin. It does not draw a new app shell. |
| Refunds, reschedule, cutoffs undecided | Those actions are absent. A note says the charge outcome is undecided. |

## Reconciliation

| User model | System model | Resolution direction |
| --- | --- | --- |
| “A real person curates every table” (observed copy) | App proposes; staff approve (accepted decision) | Change the public sentence, or Aaron explicitly keeps it. Do not ship both as truth. `A-1`. |
| “I’m on the list, so I have a seat” (assumed) | Signup is not a seat | Waitlist confirmation says it is not a seat. |
| “My invite expires” (contradicted by decision; lean list only) | No expiry | Do not add a deadline to match that expectation. |
| “I can look for an open table” (open question) | Recommended concept is invite-only | Not selected. `A-10`. Wireframe follows the recommendation and says so. |
| “I should see who liked me” (assumed) | Mutual only | Reveal hides one-sided interest in every state. Test in `A-7`. |
