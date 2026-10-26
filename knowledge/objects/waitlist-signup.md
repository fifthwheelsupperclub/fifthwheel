---
id: object-waitlist-signup
type: object
name: WaitlistSignup
status: draft
date: 2026-10-23
owner: luke
source_project: fifthwheel
derived_from: null
evidence: [evidence-marketing-site-code, evidence-product-app-code, evidence-linear-pre-mvp-scope]
related_objects: [object-guest, object-invitation, object-table]
related_evidence: [evidence-marketing-site-code, evidence-product-app-code]
related_decisions: [decision-waitlist-replacement-prompt, decision-age-from-birthdate]
---

# WaitlistSignup

## Definition

A person's intake row expressing interest in Atlanta tables. Used later as a pool for composition-safe replacements. Distinguished from Guest (account/profile) and Invitation.

## Attributes

Observed on the marketing form (`src/components/Waitlist.astro`):

| Attribute | Meaning | Required | Sensitive | Source |
| --- | --- | --- | --- | --- |
| First name | | yes on form | yes | `first_name` |
| Email | | yes on form | yes | `email` |
| Date of birth | Age fact; years derived on the date a rule runs | yes on form | yes | `birthdate` |
| Identity | Woman / Man / Non-binary | yes on form | yes | `identity` |
| Seat you with | | form | yes | `open_to` |
| Match age min | Youngest age they want to meet | yes on form | yes | `match_age_min` |
| Match age max | Oldest age they want to meet; at least min | yes on form | yes | `match_age_max` |
| Looking for | Casual / Open / Relationship | yes on form | yes | `looking_for` |
| Surprise game | | form | no | `surprise_game` |
| Neighborhood | Where they'd walk | yes on form | no | Inman Park, Chamblee, Virginia Highlands |
| Nights | | form | no | `nights` |
| Referral | | form | no | `referral` |

## Relationships

| Related object | Relationship | Cardinality | Direction | Lifecycle consequence |
| --- | --- | --- | --- | --- |
| Guest | May become, linked by `waitlist.profile_id` | 0..1 | Signup → Guest | Claimed when that email signs in. The signup row remains. |
| Invitation | May source a replacement | 0..n | Signup → Invitation | Must keep table valid |
| Table | Preference, not assignment | 0..n neighborhoods | Signup → Table | Neighborhood is a preference |

## Actions

| Action | Actor | Preconditions | State change | Failure behavior |
| --- | --- | --- | --- | --- |
| Submit form | Visitor | Valid fields | Signup stored | Posts to `https://admin.fifthwheel.community/api/waitlist`. Birthdate and match range are stored on `waitlist`. A repeat email updates those answers and does not clear the claim link or the welcome stamp. |
| Suggest as replacement | App | Guest removed; composition-safe | Staff sees Yes/No prompt | Do not suggest an invalid replacement |

## States and transitions

| State | Meaning | May enter from | May exit to | Visible to |
| --- | --- | --- | --- | --- |
| Submitted | On a waitlist store | — | Invited / used as replacement | Staff |
| Used as replacement | Suggested and accepted | Submitted | Guest invited | Staff |

No expiry of waitlist rows is specified.

## Permissions and rules

Maintain a waitlist from which the app can suggest an eligible replacement. Marketing waitlist and app waitlist may currently be two systems of record.

## Mental-model notes

Visitors think they joined “the Atlanta waitlist,” not that they created an account. Staff think of the waitlist as people they can seat.

## Open questions

- One system of record: the product app writes Supabase `waitlist`. Older `5thwheel.app` rows are historical unless imported.
- Are waitlisted people eligible replacements before they have an app account and verification?
- Does neighborhood preference constrain which table they can replace into?
- Existing app integer ages and age-range text, if they appear later, stay historical. Do not derive a birthday from a band or from “current year minus age.” (`decision-age-from-birthdate`)
