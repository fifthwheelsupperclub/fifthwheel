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
| Date of birth | Age fact; years derived on the event date, or today when there is none | Assumed for validation | yes | Waitlist `birthdate`. Existing app integer ages stay historical unless a birthdate is present. |
| Age | Whole years from date of birth | Derived when birthdate exists | yes | Copied onto `profiles.age` from `birthdate` as of today. Matching SQL still reads this integer. |
| Star sign | Tropical sun sign from month and day | Derived when birthdate exists | yes | `profiles.star_sign`. Staff and the guest’s own profile. Not shown to other guests. No birth time, so cusp days use the listed inclusive starts. |
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
| Register / sign in | Guest | Email is on the waitlist, or a profile already exists | Account exists; signup links by `waitlist.profile_id` | Unknown emails do not get a code. Staff sign in with `is_admin` on the same profile. |
| Join the waitlist | Guest | Marketing form | Waitlist signup; confirmation email queued; enters the staff placement queue | Duplicate emails get the same neutral response and no second email |
| Placed at a Table | Admin | Waitlist signup, published future Table with fewer than five invitations, age 21+ on the Table date | Access, profile and a Table Invitation are created; the invitation email is queued | Preference-rule warnings need the admin to confirm; nothing is written until then |
| Edit profile | Guest | Signed in | Profile saved | No review step |
| Pay for seat | Guest | Active Table Invitation, signed in | Seat confirmed after verified payment | Stripe failure leaves seat unconfirmed |

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

Placement follows `decision-staff-place-guests-directly`; guests cannot browse or request Tables.

- A Guest has exactly one identity and a non-empty `open_to` set containing one or more of `woman`, `man`, and `non_binary`. Preserve all seven possible sets exactly. Mutual openness is checked against each pair's identities and preference sets; equal preference sets are not required.
- Calculate the Guest's age on the Table's Atlanta-local date; placement requires at least 21. The matching-age range and mutual openness are checked as warnings at placement.
- There is no photo, selfie or profile review. Profile edits take effect immediately.
- Placement creates app access and the Table invitation together. Payment confirms the Seat.

These preconditions follow `decision-staff-place-guests-directly` (2026-11-16).

## Mental-model notes

Guests meet “a table of five,” not an `event` record. Replacement guests are still Guests, suggested from the waitlist.

## Open questions

- A waitlist email and an app account are the same person after claim, and two rows. `waitlist.profile_id` is the link. Intake facts copy onto the profile at claim. The historical integer age is left as stored.
- Which profile fields from onboarding (beyond the marketing form) are required for a valid table?
- Must identity verification complete before invitation, before payment, or before the night?
