# Operator runbook (rewrite)

Status: drafted 2026-11-15 from the code as built. Everything here is **unverified against production**: no hosted project, domain, provider account or scheduler has been touched. Steps marked **[human]** need you (or a named operator) to act or explicitly authorize that exact action. Nothing in this document deploys, sends, charges or refunds anything.

## 1. What runs where

| Piece | Runs | Notes |
|---|---|---|
| App (guest, admin, host, restaurant, API, webhook) | One Node web service built from `app/` (`pnpm build`, `pnpm start`, health `GET /api/health`) | [`render.yaml`](../../render.yaml) is a blueprint for a **new** Render service. Always-on plan recommended so Stripe webhooks and magic links never meet a sleeping instance. |
| Database, Auth, Storage | A **new** hosted Supabase project (never the legacy one) | Apply `app/supabase/migrations/*` in order with the Supabase CLI against the new project. Never run `reset`. |
| Background worker | `POST /api/internal/worker` every 5 minutes | Scheduler: [`.github/workflows/app-worker.yml`](../../../.github/workflows/app-worker.yml). Needs repository secrets `APP_URL`, `JOB_SECRET`, optional `HEARTBEAT_URL`. |
| Email | Resend (`RESEND_API_KEY`, verified sending domain) | Local runs use loopback Mailpit only. |
| Payments | Stripe | Keys, webhook endpoint and mode must match (`scripts/preflight.mjs` checks the prefixes). |
| Supply | In-app admin editing | The Airtable provider is intentionally disabled. |

## 2. Before any deploy

1. `pnpm install --frozen-lockfile && pnpm typecheck && pnpm test && pnpm build` (all must pass).
2. Export the production variables into a shell or an env file kept **outside the repository**, then run `node scripts/preflight.mjs`. It prints variable names and rules only, never values. Fix every `FAIL`; read every `WARN`.
3. Leave `CHECKOUT_FULFILLMENT_READY=false` and `REFUND_WORKER_READY=false` for the first deploy. Guests cannot pay and refunds cannot dispatch until you flip them.

Required variables (names only): `NODE_ENV=production`, `APP_ORIGIN`, `MARKETING_ORIGIN`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `RESEND_API_KEY`, `MAIL_FROM_EMAIL`, `MAIL_FROM_NAME`, `STRIPE_MODE`, `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `VITE_STRIPE_PUBLISHABLE_KEY` (baked in at build time), `STRIPE_WEBHOOK_SECRET`, `CHECKOUT_FULFILLMENT_READY`, `REFUND_WORKER_READY`, `REFUND_WORKER_SECRET`, `REFUND_WORKER_ID`, `JOB_SECRET`. `MAILPIT_URL` must be unset.

## 3. Provider setup **[human]**

- **Supabase:** create the project; apply migrations; Auth: disable signups, set the site URL to `APP_ORIGIN` and allow only `APP_ORIGIN/auth/callback` as a redirect; set a one-hour email token expiry; keep the secret key server-side only.
- **Resend:** verify the sending domain; create a key restricted to sending.
- **Stripe:** create a webhook endpoint at `APP_ORIGIN/api/webhooks/stripe` for the checkout and charge events the app handles; copy its signing secret into `STRIPE_WEBHOOK_SECRET`. Use test mode first. A live dry run (one real $25 payment and refund on a staff account) needs your explicit go-ahead.
- **Scheduler:** set the three GitHub secrets. `HEARTBEAT_URL` should be a monitor (for example Healthchecks) that alerts when pings stop; it is the alarm that works when the worker itself is broken.
- **Admin accounts:** roles are provisioned by an operator with database access (insert into `app_user_roles` for a confirmed Auth user). There is no self-serve staff signup.

## 4. Daily operation

Open **/admin**. Each card is a queue with a count and a link. Urgent cards are first.

| Card | What it means | What to do |
|---|---|---|
| Suspended Tables / needing a T−24 decision | A Table starts within 24 hours (checkout is already paused) or a removal broke a proceeding Table | Table decisions: record **proceed** (only possible with 3–5 valid paid guests) or cancel the Table |
| Payments with no Seat or refund | Money is verified but nothing accounts for it | Investigate in Stripe before anything else; this should never be non-zero |
| Refunds failed or unconfirmed | A provider call timed out or failed | Refunds: **reconcile** first; retry only when the screen allows it. A refund Stripe confirmed as failed stays owed and is not retried automatically (policy decision pending) |
| Guest emails failed or unconfirmed | The provider did not confirm an email | Email problems: check the provider's log for that guest; **send again** only if it was not sent, otherwise **dismiss** |
| Vote results not finalized | A closed vote has no results a day later | Ask engineering; opening any eligible guest's reveal also runs the finalizer |
| Others | Reviews, requests, rosters, cancellations, reports, supply conflicts, unstaffed Tables | Open the linked queue |

The banner at the top shows the worker heartbeat. If it says the worker has not reported in, emails and refunds are not moving: check the GitHub Action, `JOB_SECRET`, `APP_URL`, and `GET /api/health`.

## 5. Unknown outcomes (never guess)

Email, refunds and payments can end in an *unknown* state when a provider did not answer. The system never repeats the action by itself.

1. Find the item in its queue (Email problems, Refunds, Cancellations).
2. Look at the provider's own logs (Resend dashboard, Stripe dashboard) for that guest or payment.
3. If the provider shows it happened, reconcile or dismiss. If the provider shows it did not, choose **send again** or retry. If neither can be established, leave it and escalate through provider support. Do not force a failure.

## 6. Retention and deletion

- Each worker pass runs `purge_vote_data` (ballots at 30 days after the Table, results at 90 days) and `run_retention` (rating identifiers removed at 90 days, ratings deleted at 12 months, audit rows deleted after 90 days).
- Conduct reports are reviewed, not auto-deleted: they show as review-due after 12 months; delete one from Reports & ratings unless it is on hold.
- **Account deletion** (support request): an admin posts to `POST /api/admin/member-accounts/delete` with `{"guestId":"<uuid>","confirm":"delete"}` using an admin session. It refuses while the person has a live paid Seat (remove the Seat first, with its refund decision) and for staff accounts. It ends sign-in, pseudonymises the person, withdraws pending requests and invitations, and keeps money rows and held cases. There is no screen for this yet.
- **Identity photos (removed 2026-11-16):** the app no longer collects photos or selfies. **[human, once per project]** after applying `20261117120000_remove_approval_steps.sql`, empty and delete the `identity-evidence` Storage bucket from the Supabase dashboard (Storage → identity-evidence → select all → delete, then delete the bucket). SQL cannot remove Storage objects.

## 7. Secrets and rotation **[human]**

Rotate `JOB_SECRET` by changing it in the host and in the GitHub secret together (one pass fails in between; the next succeeds). Rotate `STRIPE_WEBHOOK_SECRET` by adding the new secret in Stripe, updating the host, then removing the old endpoint secret. Rotating Supabase keys requires a redeploy. Never commit values; `.env*` is ignored.

## 8. Backup and restore **[human]**

Use Supabase's backups or point-in-time recovery for the new project. Before cutover, restore once into a scratch project and run the app's test suite's read-only checks against it. Backup expiry and who may restore are release-owner decisions.

## 9. Cutover plan (waitlist-only legacy data)

You confirmed the previous app holds no members, paid Seats or live charges, only waitlist rows. That removes import, Stripe reconciliation and the old-writer drain. The plan is therefore short, and every step is **[human]** to authorize.

1. Deploy to a **new** Render service with checkout and refunds off. Run `node scripts/preflight.mjs` first.
2. Export the legacy waitlist rows to JSON (read-only), then `node scripts/waitlist-import-sql.mjs export.json > import.sql`. Rows that would need a guess (missing last name or birthdate, under 21, invalid values) are quarantined and listed by row number. Review `import.sql`, then run it once against the new project. It never creates admissions or sends email.
3. Staging checks on the new service with a staff email: admission email arrives, magic link signs in, `/admin` loads, worker heartbeat turns healthy, one Stripe **test-mode** payment and refund complete.
4. Point `app.` and `admin.` hostnames at the new service and update the marketing site's submission endpoint if it differs. Only now consider setting `CHECKOUT_FULFILLMENT_READY=true`.
5. One live $25 payment and refund on a staff account (explicit authorization), then announce.

**Rollback:** before step 5, point the hostnames back at the old service; the old database was never modified. Waitlist rows captured by the new service after cutover must be copied back. After real payments exist, do not restore the old service: switch checkout off (`CHECKOUT_FULFILLMENT_READY=false`), keep the refund worker running, and repair forward.

## 10. Known gaps this runbook cannot close

Updated 2026-11-16. Closed since the first draft (evidence in the [task ledger](task-ledger.md) and [receipts](w12-verification-receipts.md)): Stripe test-mode payments and refunds on the real local stack, refund retry that no longer relies on Stripe's 24-hour idempotency window, the nightly reconciliation step, the full guest/admin/host journey on the real local stack (11/11), the permission and direct-route sweep (1550 pass, 0 fail), and identity-photo storage cleanup.

Still open:

- **Never run on a host:** no deploy, real send through Resend, run of the GitHub scheduler, or heartbeat alert has happened. The `pnpm start` entry point was only run locally.
- **Live Stripe mode:** live keys, the live webhook endpoint and a real card are unverified until the owner-run dry run (§9 step 5).
- **Stripe Dashboard payment methods** are not card-only (Link, Cash App, Klarna and bank are offered). Turn them off in the Dashboard before checkout opens.
- **Reconciliation** only shows findings. There is no resolution workflow: staff fix the problem in Stripe or the ledger, and the next complete run clears the finding. It has not run in live mode.
- **Waitlist form rate limit:** production uses one process-local bucket shared by every caller (60 signups per 10 minutes). It caps abuse on one instance, but a flood can also block honest signups, and it resets on restart. Build a durable per-address limiter before running more than one instance.
- **Not built:** backup expiry and an account-deletion screen (it's API only).
- **Open product questions:** admins cannot submit or approve a roster they edited; no email for the extra refund remainder when a Table is cancelled after a partial refund (and the cancel-Table dialog wording is wrong then); wrong-method API paths return 200 empty HTML in dev (check the production build).
- **Deferred (P2/P3), safe after launch:** removal before T−24 only warns the admin instead of pausing checkout; only Table applicants are suggested as replacements; no notice preview or refund-progress emails; no reconciliation resolution workflow; no recap for a cancelled Table; raw hex colours outside tokens; more than 100 refunds on one PaymentIntent.
- **Release-owner decisions:** retention periods, finance record retention, the T−48 reminder wording, refunds Stripe confirmed as failed, and terms copy (Terms §6/§7 were updated 2026-11-16; see [policy copy inventory](policy-copy-inventory.md)). Defaults accepted 2026-11-16: refunds Stripe confirmed as failed stay owed/manual, the T−48 reminder goes to unpaid invitation holders, retention periods as built.
