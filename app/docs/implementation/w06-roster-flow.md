---

> **Superseded 2026-11-16.** This flow was removed; staff place guests directly from the waitlist queue (`place_guest_at_table`). See [PRD §0](../PRD.md#0-version-4-change-2026-11-16-no-approval-steps). Kept as history.
id: flow-fifthwheel-w06-roster
type: flow
status: proposed
date: 2026-11-13
owner: liza
related_objects: [object-guest, object-table]
related_evidence: []
related_decisions: []
---

# W06 roster curation flow

Coordinator draft from PRD R03 and the accepted Table/Guest object guides. Luke and Relay review before UI/API implementation.

## Primary scenarios

### Admin curates and approves a Table roster

1. Admin opens a published future Table's request queue.
2. The app shows current Seat requests, ordered by `created_at` then guest UUID. It marks requests whose member no longer has a current approved profile or is not eligible on the Table date.
3. Admin creates a versioned proposal and selects 3–5 eligible members. The app recomputes pairwise age compatibility, total age span, and whether each member has at least one mutual open-to connection.
4. Admin sees actionable reasons for an invalid draft and can edit it. A valid draft names each selected guest and identifies the roster revision.
5. Admin confirms approval. The server revalidates the exact current Table, profile versions and proposal revision in one transaction. It records the approving admin and enqueues one Table invitation per selected member.
6. Duplicate approval retries return the recorded result; a changed proposal/profile/Table revision conflicts without queuing additional invitations.

### Assigned host proposes, admin approves

1. Assigned host opens only an assigned Table's request queue.
2. Host may inspect eligible candidate summaries and create or revise a roster proposal.
3. Host can see validation outcomes and submit a proposal for admin review.
4. Host has no approval, invitation-send, checkout, payment, or other-Table access.
5. Admin reviews the host proposal, revalidates the current revision and explicitly approves it.

## Page / surface sketch

| Surface | Job |
|---|---|
| Admin Table roster workspace | Review requests, see deterministic eligible order, edit versioned roster, understand each failed rule, approve a valid current proposal |
| Host assigned-Table roster proposal | View authorized Table applicants and propose/revise; cannot approve or send |
| Member Requests | Keep Seat request status and Table invitation status distinct; W06.2 request history is implemented, invitation display remains W06.5 |

## Edge states

| State | Actor experience | Recovery |
|---|---|---|
| Fewer than 3 or more than 5 selected | Roster remains a draft and lists valid range | Add/remove candidates |
| Individual candidate not currently eligible | Candidate is excluded from recommendations with a safe reason | Resolve profile review or select another request |
| Pairwise age mismatch | Shows the affected pair and safe reason, not DOB | Select a compatible member |
| Age span exceeds 12 | Shows span rule and roster revision | Replace one or more members |
| A member has no mutual open connection | Names affected member(s) with a safe reason | Select a member whose exact preference set produces a mutual edge |
| Profile or Table changes after draft | Proposal is marked stale; approval rejected with no invitation | Reload candidates, rebuild and revalidate the proposal |
| Concurrent or repeated approval | Existing operation result is replayed; no duplicate invite | Inspect current approval/delivery status |
| Host attempts approval or another Table URL | Safe permission denial | Return to assigned workspace or ask an admin |

## Loading / error / permission

All roster operations derive actors from the verified server session and resource assignment. Admin may approve and queue invitations. Assigned host may propose only on an assigned Table. Applicants are owner-scoped Seat requests. Matching uses current approved profile versions and the immutable current Table revision; the UI never trusts client-supplied actor, age, identity, open-to set, score, revision, or recipient.

## Out of flow

Automated compatibility scores, personality/temperament ranking, contact sharing, invitation expiry, direct payment from a request, host approval, bulk admission, and rescheduling are excluded. Recommendation order remains request time then guest UUID.
