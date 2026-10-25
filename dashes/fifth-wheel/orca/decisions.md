# Decisions

These are the product decisions for the first working night. Accepted items are rules. Proposed items are not rules. Do not implement a proposed item as if it were accepted.

## Accepted

### Staff approve a table before invitations send

The app proposes a table and validates composition. Staff approve that table. Only then do invitations send. Invitations are not a self-serve booking path before approval.

Landing copy that says a real person curates every table is out of date. The decision is app-proposes, staff-approve. The sentence on the site still needs a copy change. That change is not itself this rule.

### Invitations do not expire

There is no expiry and no Expired state. Staff are notified about invitations that still have no confirmed seat two days before the table, and they follow up by hand. Accepting an invitation is not what confirms the seat. Payment is.

### A seat is confirmed after payment

Capacity, the minimum of three, and replacement logic count paid seats. An invitation, a hold, or a staff assignment does not confirm a seat.

### Age comes from date of birth

Date of birth is the age fact. Years are calculated on the date the rule runs. The waitlist form checks 21+ against today. A table checks against the table date. The 21st birthday passes.

Match preference is youngest and oldest, both at least 21, oldest at least youngest. Two people fit only when each age falls inside the other’s range. A table’s ages span at most 12 years. That cap is not a form field.

Staff see age in years and can open the birthday. Other guests see neither.

Existing integer ages in the app stay historical. Do not invent a birthday from “current year minus age.” The waitlist API does not persist birthdate or match-range keys yet. Those keys are part of this decision. The form is ahead of the store.

### One replacement prompt

Remove guest, then: “Replace with [name] from the waitlist?”

- Yes sends that one invitation if the person still keeps the composition valid. The new seat is unpaid until they pay.
- No removes the guest and sends nobody.
- If nobody is eligible, Yes is unavailable and No still removes.
- Revalidate when a seat is added, removed, or replaced.

The prompt offers one suggestion, not a list to pick from.

### The vote is a 90/30 window, and interest is mutual only

Voting opens 90 minutes after the recorded start and closes 30 minutes later. It is not open at check-in. Ballots show eligible attendees only. Disclose interest only when both people expressed it. Never show one-sided interest.

### Historical dates are not targets

Lean-list dates, signup deadlines, and the landing page’s “November” are not the plan. Do not put them on milestones or treat them as a launch date.

## Not decided

Do not build these. Do not invent a policy in the interface.

| Topic | What is known | What not to build |
| --- | --- | --- |
| Refunds | Cancel-booking code exists. Who is refunded, when, and through which Stripe path is open. | A refund policy, including for a guest staff remove. |
| Rescheduling | Would depend on cutoff and refund. | A flow that moves a guest to a later table. |
| Table cutoffs | Target 5. Valid at 3 or 4. Minimum 3 with mutual-preference rules. | A cutoff time, or a “cancelled for low fill” state. |
| Launch timing and success | No numeric goal is accepted. | A launch date, a waitlist-size goal, or a success target. |
| Browse and pay | Tables can be published in the app. | A requirement that guests can pay without an invitation. |
| Unanswered | This model uses “no confirmed seat” so the two-day notice has a list. | A second definition (no click, no account) unless this decision is revised. |
| Eligible voter | Illustration uses a confirmed seat. | A wider ballot (invited but unpaid, or “still in the room”) unless this is decided. |
| Vote clock | The rule says the recorded start. | A switch to check-in time or drinks time unless this is decided. |
| When mutual reveal happens | One-sided interest stays hidden either way. | A promise that reveal happens at the close, or as soon as both have voted. |
| Identity verification timing | Verification is in scope. | A gate before invite, before pay, or before the night until one of those is chosen. |
| One waitlist store | Marketing posts to `www.5thwheel.app/api/waitlist`. The app also has waitlist signups. | An assumption that they are the same record. |
| Invitation as a row | The domain object is an invitation. The app may still be notifications and holds. | Pretending the row already exists, or dropping the object because the row is missing. |
| Hold versus seat | Holds and a hold-expiry sweep exist in code. | Treating a hold as a confirmed seat. |

## Words

Guest interface: Table, Seat, Invitation, Vote, and “you.” Staff: Approve table, Remove guest, Replace with [name]. Avoid Match, Reservation, Customer, and event in guest copy.
