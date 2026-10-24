# Evidence summary — fifth-wheel

**Date:** 2026-10-23  
**Steward:** Scout, verified by Liza against the cited files  
**Tier:** High-stakes  
**Evidence Gate:** not cleared. There is at least one sourced record, which meets the method’s “≥1 evidence source” floor, and there is no independent observed evidence about guests. The gate stays open because this is High-stakes, the session is agent-run, and no non-author reviewer confirmed the problem is worth the build.

## Classified inventory

| id | source | type | confidence | what it supports |
| --- | --- | --- | --- | --- |
| evidence-marketing-site-code | `knowledge/evidence/marketing-site-code.md`; this repo | observed | high for text in this tree | Landing, FAQ, terms, privacy, waitlist form, Virginia Highlands example, posts to `https://www.5thwheel.app/api/waitlist`. |
| evidence-product-app-code | `knowledge/evidence/product-app-code.md`; `https://github.com/fifthwheelsupperclub/app` | observed | medium | Next.js + Supabase + Stripe routes for login, onboarding, verify, tables, book, tonight, vote, reveal, admin, cancel, matching. Not a production walkthrough. |
| evidence-linear-pre-mvp-scope | `knowledge/evidence/linear-pre-mvp-scope.md` | borrowed | high that the brief says this | Staff approve before automatic invites; invitations do not expire; replacement prompt; capacity; seat confirmed at payment; 90/30 mutual vote. Independence flag: the team that owns the claim wrote the brief. |
| evidence-lean-list-historical | `knowledge/evidence/lean-list-historical.md` | assumed | low | Auto-downgraded. Frontmatter says observed. There is no file path or URL for the lean list itself. Unsafe as backlog, dates, or metrics. |

Accepted decisions dated 2026-10-23 are the workflow record. They are decisions, not user research. Proposed and not decided: launch timing and success, table cutoffs, refunds, rescheduling.

Liza re-read on this pass:

- `src/components/Waitlist.astro` still says first Atlanta tables are seating on November and that a real person thoughtfully curates every table.
- `src/data/faq.ts` says the launch is this November.
- `src/scripts/waitlist.ts` sets `MINIMUM_AGE = 21` and says `/api/waitlist` on the existing Vercel app does not persist birthdate or match-range keys. The current file does not mention Airtable. The marketing evidence file’s Airtable sentence is stale relative to that script (`A-17`).

This session’s Linear lookup returned one project: **Fifth Wheel 1.1**, id `P-FIF-2`, URL `https://linear.app/fifthwheel/project/fifth-wheel-11-59788221cab3`. The evidence file still titles it Fifth Wheel Pre-MVP and uses the same project hash `59788221cab3`. Treat the rename as a label change observed here, not a scope change.

## Conflict map

| Conflict | Side A | Side B | How this plan treats it |
| --- | --- | --- | --- |
| Who curates | Observed landing and FAQ: a person / coordinator curates. | Accepted `decision-staff-approve-before-invites`: the app proposes and validates; staff approve; invites then send. | Workflow record wins for the product. Public copy is a known lie relative to that decision. Aaron chooses the sentence (`A-1`). |
| November | Observed landing and FAQ. | Accepted `decision-historical-dates-not-targets`. Launch timing is still proposed. | November is not a target and is not a milestone. |
| Invitation expiry | Assumed lean-list language, unsourced. | Accepted `decision-invitations-do-not-expire`. | No Expired state. No countdown. |
| Two waitlists | This repo posts to `www.5thwheel.app/api/waitlist` and does not persist birthdate keys. | The app repo has a waitlist route and `waitlist_signups`. | Two code paths are documented. That both are live, or that one is Airtable, is not shown. |
| Age floor | Decision and this marketing script: 21 from date of birth. | The age decision says the product app still checks an integer age at 18. The product-app evidence file does not cite that constant. | 21 is the rule. The 18 claim stays an assertion until the app file is cited (`A-5`). |

## Health

| Metric | Value | Gate implication |
| --- | --- | --- |
| Evidence records | 4 | Floor of one sourced item is met |
| Observed, and about code or copy only | 2 | Does not describe what guests do |
| Borrowed stakeholder brief | 1 | Default for pre-MVP scope |
| Assumed (downgraded lean list) | 1 | Out of requirements |
| Observed user research | 0 | Quality cap. No guest-need proof |
| Analytics baseline | 0 | No rates to set targets from |
| Accepted launch metric | 0 | `decision-launch-timing-and-success` |

## ORCA keys

- **Table.** Borrowed Linear brief plus accepted approval, capacity, and vote decisions. Code calls it `event`.
- **Invitation.** Borrowed brief and `decision-invitations-do-not-expire`. Not proven as a first-class row.
- **Seat.** Borrowed brief, `decision-seat-confirmed-at-payment`, observed checkout routes.
- **Vote.** Borrowed brief, `decision-voting-window-mutual-only`, observed vote/reveal routes.
- **WaitlistSignup.** Observed marketing form. Persistence of birthdate is explicitly absent.
- **Guest.** Draft object. Account-versus-signup identity is open.

No assumed user-model line in this file is allowed to override an accepted decision.
