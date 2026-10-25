---
id: decision-age-from-birthdate
type: decision
status: accepted
date: 2026-10-23
owner: liza
related_evidence: [evidence-marketing-site-code, evidence-product-app-code]
related_objects: [object-waitlist-signup, object-guest, object-table]
related_decisions: [decision-waitlist-replacement-prompt]
reversibility: reversible
---

# Age comes from date of birth; matching uses a youngest and oldest range

## Context

The landing form collected overlapping age bands for the member and for who they would meet. Those lists did not match each other or the FAQ. A band cannot enforce a 21st birthday. An integer age goes stale. The form is collecting member facts for people interested in a full event; nothing is stored yet.

## Options considered

- Keep self-reported age bands on the waitlist
- Collect month and year of birth
- Collect a date of birth and two whole-year match fields (youngest and oldest)
- Ask for a typed age and a single “open to any” preference

## Decision and rationale

Date of birth is the age fact. Age in years is calculated from it on the date a rule runs. On the landing form there is no event date, so the 21+ check uses today. A later event uses the event date. The 21st birthday itself passes.

The match preference is two required whole-year fields: youngest and oldest they want to be matched with. Both are at least 21. Oldest is at least youngest. Their own age does not have to fall inside that range.

Two people fit only when each one’s age falls inside the other’s range. A table’s ages still may not span more than 12 years. That cap is a table rule, not a third form question.

Staff see an age in years and can open the birthday. Other members do not see the birthday or the match range.

Existing integer ages and age-range text in the product app, if they appear later, stay as captured. Do not derive a birthday from a band or from “current year minus age.”

## Consequences

The marketing form sends `birthdate`, `match_age_min`, and `match_age_max`. The product waitlist API persists those keys on `waitlist`. Guest profiles still store an integer age and ask for a number at onboarding; that integer is checked at 21. Deriving guest age from a stored birthdate remains a separate change.

## Revisit trigger

If staff need a different match rule than mutual inclusion, if the 12-year table cap should be dropped, or if a match later shows an age on a guest-facing profile.
