# Metrics — fifth-wheel

**Date:** 2026-10-23  
**Steward:** Ledger. Liza did not add targets.  
**Status:** candidates only. None of these is an accepted metric.

Launch success is not decided (`decision-launch-timing-and-success`, Linear `FIF-38` as cited in that decision). `knowledge/README.md` says there are no metric files yet. The numbers 3, 5, T-2, and 30 minutes are domain rules, not success thresholds.

## Do not use

- Lean-list signup volume.
- Landing “November” as a date or a conversion goal.
- Founding-waitlist conversion figures from the lean list.

## Candidates

No owner. No observation date. Full invalidity rules are Ledger’s and are summarized here.

| Candidate | Grain | Numerator | Denominator |
| --- | --- | --- | --- |
| Invited guests who pay | One invitation | Invitation whose guest has a confirmed seat on that table | Invitations sent and not void |
| Tables at 3, and tables at 5 | One approved table, at one time | Approved tables with ≥3 confirmed seats; separately, with 5 | Staff-approved tables in the set |
| Unanswered at T-2 | One invitation at the notice instant | No confirmed seat and not void | Sent and not void before T-2 |
| Replacement Yes rate | One answered prompt | Answered Yes | Answered Yes or No. Prompts with no suggestion stay out |
| Votes inside the window | One guest at one table | One ballot stored inside the 30 minutes | Eligible guests. Undefined until `A-9` |
| Mutual reveals | One unordered pair | Pairs disclosed because both expressed interest | Pairs where both voted inside the window |

A table with 4 confirmed seats is valid. It is not a failure. Yes on a replacement is not a paid seat. Holds are not confirmed seats. One-sided interest is not a reveal.

Until `A-8` and `A-9` close, the only counts this plan will stand behind in prose are paid seats and approved tables.

## Events proposed, not accepted

`invitation_sent`, `seat_confirmed`, `seat_released`, `invitation_unanswered_notice`, `replacement_prompt_answered`, `vote_cast`, `mutual_revealed`.

Do not put ballot choices, pair names, or email on an analytics event. Object ids are enough to count. Privacy review is still required before any event is accepted. `seat_released` exists so a later cancel does not leave the seat in the numerator. It does not decide refunds.

## Evidence debt

No analytics baseline, no accepted event contract, and no historical rates in repo knowledge. Routes in the app are not a measured baseline.
