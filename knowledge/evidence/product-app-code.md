---
id: evidence-product-app-code
type: evidence
status: observed
date: 2026-10-23
owner: scout
source_type: product
source: https://github.com/fifthwheelsupperclub/app
confidence: medium
related_objects: [object-guest, object-table, object-invitation, object-seat, object-waitlist-signup, object-vote]
related_evidence: [evidence-marketing-site-code, evidence-linear-pre-mvp-scope]
related_decisions: [decision-seat-confirmed-at-payment, decision-voting-window-mutual-only]
---

# Product app routes present in GitHub

## Observation or source claim

[fifthwheelsupperclub/app](https://github.com/fifthwheelsupperclub/app) is a Next.js + Supabase + Stripe app. File tree observed 2026-10-23 includes:

- Guest: `src/app/login/`, `onboarding/`, `verify/`, `tables/`, `book/[id]/`, `account/`
- Night of: `tables/[id]/tonight/`, `vote/`, `reveal/`, `recap/`, `rate/`
- Staff: `src/app/admin/(console)/` waitlist, venues, tables, match, host, queue, reports
- Payments and cancel: `src/app/api/stripe/webhook/route.ts`, `supabase/migrations/20260821092519_cancel_booking.sql`, cancellation email in `src/lib/notify/templates.ts`
- Matching scores: `src/lib/matching.ts` (age spread, mutual openness, tenets)
- Waitlist API: `src/app/api/waitlist/route.ts`, `supabase/migrations/20260903213955_waitlist_signups.sql`
- Events in code (`src/lib/events.ts`) map to the guest-facing Table object

Default branch at inspection was `master`. Live host referenced from the marketing site is `https://www.5thwheel.app`.

## Context and population

GitHub tree listing and targeted file reads. Not a walkthrough of production.

## Limitations and contradictions

Presence in the repo is not a verified production pass. Admin match UI is not the same as the confirmed staff-approve-then-invite workflow. Guest-facing language should stay Table even though code uses `event`. Confidence is medium because live behavior was not exercised.

## Analyst inference

Much of the pre-MVP guest and staff surface already has an implementation. Remaining product work is workflow alignment (approval, invitations, replacement, voting rules) plus verification, not a greenfield app.

## Product implication

Do not rebuild login, checkout, vote, or admin consoles from scratch. Record gaps as issues. Treat matching.ts as a starting composition check, not proof the confirmed invitation gate exists.
