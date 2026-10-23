---
id: object-guest
type: object
name: Guest
status: draft
date: 2026-10-23
owner: luke
source_project: fifthwheel
derived_from: null
evidence: [evidence-linear-pre-mvp-scope, evidence-product-app-code, evidence-marketing-site-code]
related_objects: [object-waitlist-signup, object-invitation, object-seat, object-vote, object-table]
related_evidence: [evidence-linear-pre-mvp-scope, evidence-product-app-code]
related_decisions: [decision-waitlist-replacement-prompt, decision-voting-window-mutual-only, decision-age-from-birthdate]
---

# Guest

## Definition

A person Fifth Wheel may waitlist, invite, seat, or show on a ballot. Distinguished from Staff (operates the product) and from WaitlistSignup (a form row that may or may not yet be this person).

## Attributes

| Attribute | Meaning | Required | Sensitive | Source |
| --- | --- | --- | --- | --- |
| Name | What to call them | Assumed for invite/seat | yes | Waitlist and onboarding (`first_name` on the marketing form) |
| Email | How to reach them | Assumed for invite | yes | Waitlist, login |
| Date of birth | Age fact; years derived on the event date, or today when there is none | Assumed for validation | yes | Waitlist `birthdate`. Existing app integer ages stay historical. |
| Match age min | Youngest age they want to meet | yes on form | yes | `match_age_min` |
| Match age max | Oldest age they want to meet | yes on form | yes | `match_age_max` |
| Identity | Woman / Man / Non-binary on the marketing form | Observed on waitlist | yes | `identity` |
| Open to | Who they want to be seated with | Observed on waitlist | yes | `open_to`; matching uses `interestedIn` |
| Identity verification | Pre-MVP includes verification | Required by Linear scope | yes | `src/app/verify/` |

## Relationships

| Related object | Relationship | Cardinality | Direction | Lifecycle consequence |
| --- | --- | --- | --- | --- |
| WaitlistSignup | May originate from | 0..1 | Guest ← Signup | Signup is not automatically a seated Guest |
| Invitation | Receives | 0..n | Table → Guest | Invite does not expire |
| Seat | Occupies when paid | 0..n over time | Guest → Table | Confirmed seat counts toward capacity |
| Vote | Casts / appears on | 0..1 per table | Guest → Vote | Mutual-only reveal |
| Table | Attends | 0..n | Guest → Table | Past tables used in matching (`metBefore` in code) |

## Actions

| Action | Actor | Preconditions | State change | Failure behavior |
| --- | --- | --- | --- | --- |
| Register / sign in | Guest | Email | Account exists | Open: magic-link vs password not specified here |
| Complete profile | Guest | Signed in | Profile usable for curation | Unverified guests may be blocked; not proven in production |
| Verify identity | Guest | Signed in | Verification recorded | Failure path not modeled |
| Pay for seat | Guest | Invitation or published table (assumed) | Seat confirmed | Stripe failure leaves seat unconfirmed |

## States and transitions

| State | Meaning | May enter from | May exit to | Visible to |
| --- | --- | --- | --- | --- |
| Waitlisted | On a signup list, not seated | — | Invited / Removed | Staff |
| Invited | Has an open invitation | Waitlisted or replacement | Seated / Removed | Guest, staff |
| Seated | Paid confirmed seat | Invited | Removed / Attended | Guest, staff |
| Attended | Night completed (assumed) | Seated | — | Staff; ballot eligibility |

Exact state names in code are not copied here.

## Permissions and rules

Guests see only eligible attendees on a ballot and only mutual interest after voting (`decision-voting-window-mutual-only`). Staff see waitlist and table composition. Do not treat matching tenets as guest-facing attributes until named in UI.

## Mental-model notes

Guests meet “a table of five,” not an `event` record. Replacement guests are still Guests, suggested from the waitlist.

## Open questions

- Is a waitlist email the same record as an app account?
- Which profile fields from onboarding (beyond the marketing form) are required for a valid table?
- Must identity verification complete before invitation, before payment, or before the night?
