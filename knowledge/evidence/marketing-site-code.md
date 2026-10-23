---
id: evidence-marketing-site-code
type: evidence
status: observed
date: 2026-10-23
owner: scout
source_type: product
source: https://github.com/fifthwheelsupperclub/fifthwheel
confidence: high
related_objects: [object-waitlist-signup, object-table]
related_evidence: [evidence-linear-pre-mvp-scope, evidence-product-app-code]
related_decisions: [decision-staff-approve-before-invites, decision-historical-dates-not-targets]
---

# Marketing site as shipped in this repo

## Observation or source claim

This repository is the Astro marketing site. Observed 2026-10-23:

- Landing, FAQ, terms, and privacy pages exist (`src/pages/landing.astro`, `terms.astro`, `privacy.astro`). Root `src/pages/index.astro` redirects to `/landing/`.
- Positioning copy: “One table. Five people.” Drinks, dinner, dessert — three walkable stops (`src/data/site.ts`).
- Featured neighborhood in the site is Virginia Highlands (Highland Tap, Murphy’s, Truva) in `src/components/Neighborhoods.astro`.
- Atlanta waitlist form is in `src/components/Waitlist.astro`. Copy says first Atlanta tables are seating in November and that “A real person thoughtfully curates every table.”
- Submit posts to `https://www.5thwheel.app/api/waitlist`. `src/scripts/waitlist.ts` says the payload must stay compatible with Airtable on that existing Vercel app. `src/data/site.ts` names `https://www.5thwheel.app` as the production app URL.
- Canonical marketing host in code is `https://www.aaronbenjamin.design/fifthwheel`.

## Context and population

File inspection of this working tree, not a live-production crawl of every deployed host.

## Limitations and contradictions

November seating and person-curated tables contradict the Linear confirmed workflow (app proposes, staff approve). Two waitlist systems may exist: Airtable-backed `5thwheel.app/api/waitlist` and waitlist tables in the product app (`evidence-product-app-code`). Code here is not proof the GitHub Pages deploy matches this tree.

## Analyst inference

The landing page is the public face and a waitlist collector. It is not the source of workflow truth.

## Product implication

Copy and waitlist destination need a follow-up against confirmed curation and a single waitlist system of record. Do not treat November as a launch decision.
