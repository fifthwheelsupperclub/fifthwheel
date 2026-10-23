---
id: decision-app-host-render-free
type: decision
status: accepted
date: 2026-10-23
owner: liza
related_evidence: [evidence-product-app-code]
related_objects: [object-seat]
related_decisions: [decision-seat-confirmed-at-payment]
reversibility: reversible
---

# Host the product app on Render free with a GitHub Actions drain

## Context

The product app is Next.js (server actions, Stripe webhook, magic-link auth). Marketing stays on GitHub Pages at `fifthwheel.community`. The app hostname is `admin.fifthwheel.community`. Paid always-on hosting was considered so Stripe webhooks would not hit a sleeping instance. Pre-MVP volume does not justify that cost.

Notifications already send in the same request (`notifyNow` / `flush()`). `/api/cron/notifications` is a leftover drain. Stripe retries failed webhooks. Identity verification heals on page load.

## Options considered

- Render Starter web plus Render cron (warm, paid)
- Render free web plus GitHub Actions drain
- Vercel Hobby (native Next, commercial TOS concern)
- Cloudflare Pages (static only; not this app)
- Cloudflare Workers Paid (adapter work, ~$5/mo)

## Decision and rationale

Host `fifthwheelsupperclub/app` on a **Render free** web service. Drain queued notifications with a GitHub Action every 15 minutes. Do not rewrite the product for a different runtime.

## Consequences

After idle, the first request may wait while the instance wakes. Stripe retries. The Action curl uses a long timeout so it can wake the box. `CRON_SECRET` must exist in both Render and GitHub Actions (dashboard only). Revisit if paid tables are live and webhook misses or cold starts hurt guests.

## Revisit trigger

Missed or delayed seat confirmations after payment, or a decision to run paid tables on a warm host.
