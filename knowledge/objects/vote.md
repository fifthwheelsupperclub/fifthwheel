---
id: object-vote
type: object
name: Vote
status: draft
date: 2026-10-23
owner: luke
source_project: fifthwheel
derived_from: null
evidence: [evidence-linear-pre-mvp-scope, evidence-product-app-code]
related_objects: [object-guest, object-table]
related_evidence: [evidence-linear-pre-mvp-scope, evidence-product-app-code]
related_decisions: [decision-voting-window-mutual-only]
---

# Vote

## Definition

A private ballot a Guest casts about other eligible guests at the same Table. Interest is disclosed only when mutual. Distinguished from ratings/recap after the night.

## Attributes

| Attribute | Meaning | Required | Sensitive | Source |
| --- | --- | --- | --- | --- |
| Voter | Guest casting | yes | yes | vote routes |
| Table | Night | yes | no | `tables/[id]/vote` |
| Window | Opens 90 minutes after start; closes 30 minutes later | yes | no | Linear |
| Choices | Eligible attendees only | yes | yes | Linear |
| Mutual reveal | Shown only if both expressed interest | yes | yes | Linear; `reveal/` |

Ballot contents beyond “interest in eligible attendees” are not specified here.

## Relationships

| Related object | Relationship | Cardinality | Direction | Lifecycle consequence |
| --- | --- | --- | --- | --- |
| Table | Occurs at | 1 | Vote → Table | One voting period per table |
| Guest | Voter and possible subject | 2..n | Guest ↔ Vote | Non-attendees are not on the ballot |

## Actions

| Action | Actor | Preconditions | State change | Failure behavior |
| --- | --- | --- | --- | --- |
| Open window | App | 90 minutes after event start | Voting available | Must not be open at check-in |
| Cast | Guest | Window open; eligible | Ballot stored | After close, reject |
| Reveal mutual | App | Window closed or during? (open) | Show only mutual pairs | Never show one-sided interest |

## States and transitions

| State | Meaning | May enter from | May exit to | Visible to |
| --- | --- | --- | --- | --- |
| Closed (before) | Before 90 minutes | — | Open | Nobody votes |
| Open | 30-minute window | Closed (before) | Closed (after) | Eligible guests |
| Closed (after) | Window ended | Open | Revealed | No new votes |
| Revealed | Mutual interest disclosed | Closed (after) | — | Mutual pairs only |

## Permissions and rules

Ballots show eligible attendees only. Disclose interest only when mutual. Vote/reveal/recap code exists; this object is the rules, not a rebuild.

## Mental-model notes

Guests vote privately at dessert time; they do not see who picked them unless it is mutual. Recap and ratings are neighboring flows, not this object.

## Open questions

- Exact meaning of “eligible attendees” (checked in? paid? still present?).
- Does reveal happen at close or when both have voted?
- What is on the ballot besides mutual interest (dessert partner vs general interest)? Assumed unknown.
