# Privacy impact brief — fifth-wheel

**Dash:** fifth-wheel  
**Date:** 2026-10-23  
**Prepared by:** Cipher  
**Liza spot-check:** `src/pages/privacy.astro` renders `PrivacyContent.astro`. Confirmed lines for Meta Pixel (around line 109), waitlist retention “two years without contact” (around line 285), “Whatever state or country you are in, we will honour the following” (around line 319), and “adults aged 21 and over” (around line 391). The rest of Cipher’s page reading was not re-quoted line by line.

## What is changing

This dash plans the guest, waitlist, vote, and seat model already in the knowledge files. It does not add a new collection. The sensitive flows are name, email, date of birth, identity, who someone will sit with, looking-for, Stripe payment, private votes, and algorithmic matching.

Publishing the accepted age rule would start **persisting** birthdate and match range where `src/scripts/waitlist.ts` says the current endpoint does not. That is a storage change for data the form already collects.

## Applicable regulation

Working baseline is GDPR because the knowledge files do not say which law applies. Product intent is Atlanta adults, age floor 21. COPPA under 13 is not the product intent. Birthdate is still sensitive.

The privacy page says Fifth Wheel operates in the United States and that people elsewhere are processed under United States law, and it also says it will honour access, correction, deletion, portability, marketing opt-out, and a limit on sensitive information. It does not name GDPR, CCPA, or COPPA in the lines checked. Counsel has to name the law. Reviewer: unassigned — needs Aaron.

## Data involved

| Data element | Source | Who has access | Retention | Used for |
| --- | --- | --- | --- | --- |
| First name, email | Waitlist and account | Staff; the person. Other guests: not specified in the object beyond mutual contact rules on the privacy page | Knowledge: no waitlist expiry. Page: until removal or two years without contact; profile 12 months after inactive (page claim, not verified as built) | Invite and seat |
| Date of birth | Waitlist `birthdate` | Staff see age in years and can open the birthday. Other guests do not | Not set in knowledge | 21+ check. Today on the form; event date when there is one |
| Match age min / max | Waitlist | Staff. Hidden from other guests | Not set in knowledge | Mutual inclusion. Both ≥ 21 |
| Identity, open_to, looking_for | Waitlist | Staff for curation. Guest display of identity is unspecified | Not set in knowledge | Composition. Relationship intent is sensitive |
| Payment | Stripe, `seat_price_cents` | Guest and staff see the confirmed seat | Page claims 7 years. Refunds undecided | Confirm the seat |
| Vote | Vote and reveal routes | Mutual pairs only on the guest surface. Staff readability of stored one-sided ballots is not specified | Page claims 12 months. Knowledge does not | Private ballot |
| Match inputs | `matching.ts` | Staff match UI. Not proof of the approval gate | Not set | Who is proposed |

## Third parties

| Party | In the files | Current requirement? |
| --- | --- | --- |
| Stripe | Checkout and webhook | Yes, already the payment path |
| Supabase | App database, including waitlist signups | Yes, as named in product-app evidence |
| Render and GitHub Actions | `decision-app-host-render-free` | Yes, for hosting and the notification drain. The decision does not say the drain carries profile or vote fields |
| Waitlist endpoint on `www.5thwheel.app` | `waitlist.ts` | Yes, as the form target. Airtable is **not** in the current script. The marketing evidence file still says Airtable. See `A-17` |
| Meta Pixel | Privacy page says the landing page loads it. Lean list is historical | Not a requirement of this dash. Do not add one |
| Vercel, Twilio, Resend, Stripe Identity | Named on the privacy page in Cipher’s reading | Policy names until a decision says they are current. Host decision puts the app on Render |

## DPA status

Unknown. No signed DPA is in the files. The page’s promise that each provider is bound to one purpose is a policy sentence, not a DPA record.

## Mitigations that follow recorded rules

- Derive age from date of birth. Do not invent a birthday from an integer age.
- Staff see age in years. Other guests do not see the birthday or the match range.
- Disclose vote interest only when mutual. Hide one-sided interest in empty, loading, and error states.
- Confirm the seat at payment.
- Do not add a pixel or a new analytics SDK in this dash.
- Do not put ballot choices on the proposed analytics events (`metrics.md`).

## Why self-check fails

Retention in the object files is unset. Two stores can make a deletion miss a copy. The 18-versus-21 gap is unresolved. Consent text and access logs were not verified. Refunds are undecided. Host on the privacy page (Vercel, in Cipher’s reading) does not match the accepted Render decision.

```yaml
privacy_gate:
  triggered: true
  applicable_regulations: [GDPR] # baseline only
  path: legal_escalation
  self_check_status: escalated
  legal_sign_off:
    status: pending
    reviewer: "unassigned — needs Aaron"
    evidence_link: dashes/fifth-wheel/privacy-review.md
    date: ""
  tier_forced: high-stakes
```
