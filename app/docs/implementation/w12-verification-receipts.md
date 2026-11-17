# W12 verification receipts (2026-11-15)

Everything below was run in this session against the **isolated local test stack** (`fifthwheel-rewrite-test`), the working tree at commit `e368217`. Nothing was run against hosted Supabase, Stripe, Resend or any deployed service. Stripe, email provider and scheduler behaviour is therefore **unverified**. "Passed" means that command exited successfully in this session.

## Clean install, type, test, build (fresh copy of the committed tree)

| Check | Result |
|---|---|
| `git archive HEAD` of `app/` into an empty directory, then `CI=true pnpm install --frozen-lockfile` | passed |
| `pnpm typecheck` (same fresh copy and the working tree) | passed |
| `pnpm test` (same fresh copy) | 317/317 passed |
| `pnpm build` | passed |
| Production server (`pnpm start` on a spare port): `GET /api/health` 200, `POST /api/internal/worker` without secret 401, `/sign-in` 200, `/preview` 404, a built asset 200 | passed (run earlier in the session on commit `7aa02be`; not repeated) |
| Client bundle inspection (99 files in `dist/client`): zero matches for `sk_live_`, `sk_test_`, `whsec_`, `sb_secret`, `service_role`, `SUPABASE_SECRET`, `STRIPE_SECRET`, `JOB_SECRET`, `REFUND_WORKER_SECRET`, `RESEND_API_KEY`, `api.stripe.com/v1`, `rest/v1/rpc`, `node:crypto`, `timingSafeEqual`; no JWT-shaped strings | passed |

## Database: clean full migration replay

The guarded `test reset` replayed the migration chain onto an empty database and **failed at migration 13**: `20261112202411_supply_draft_management.sql` contained a stray `end if;` (it had only ever worked on a database that was migrated incrementally before an edit). Fixed. After the fix `supabase migration up` applied all 37 migrations to the empty database without error. Because the reset began before the failure, the test database was left empty and partially migrated until the repair; it is now fully migrated and holds no data.

Run on that freshly replayed database (all rollback-only harnesses, each passed): table requests, roster curation, checkout holds, checkout fulfillment, seat cancellations, refunds, Table cancellation, W08 operations, W08 removal and replacement, W09 vote and feedback, W10 overview and retention, W10 notices, profile foundation, supply management, supply sync, weekly clone, admission operation, invitation attempts, Table invitation delivery.

Defect found by the replay and fixed: weekly-clone **undo** deleted cloned Table heads but not their runtime rows, so undo failed with a foreign-key error after the payment slice added `app_table_runtime`.

## Browser, real local stack (actual Auth, database, Mailpit, app server)

| Runner | Result |
|---|---|
| W03 marketing signup, admin admission, real magic link, member home, returning link | passed (1/1) |
| W03 expired link | passed (1/1) |
| W04 profile, private evidence, admin review | passed (2/2) |
| W06 member Tables, requests, access gates, shared preview | passed (1/1) |
| W06.5 Table invitation delivery and recovery | passed (1/1) |
| W05 supply sync, Table management, weekly clone | **passing** (2026-11-14): `node scripts/run-w05-browser.mjs`, 3/3, after updating test strings to the current copy (no product change). Real stack, fixture provider only; Airtable remains disabled. |

Stale test strings (copy edits made after the tests were written) were corrected in the W03, W06, W06.5 and roster mock tests. One W03 assertion that no downstream tables existed yet was changed to the current schema.

## Browser, intercepted API (screens and request shapes only)

43/43 passed: roster curation, four W07 suites, W08 operations, W09 Tonight, W10 overview, preview. These prove layouts, states, accessibility basics at 390px and exact request bodies; they do not prove permissions or persistence.

## Not run (and why)

- Any Stripe sandbox or live action (no keys available). The payment journey, signed-webhook replay against real Stripe objects, refund settlement and the nightly comparison are unverified end to end.
- A real send through Resend or Mailpit from the notice worker.
- A deployed build, DNS, TLS, scheduler runs and the heartbeat monitor.
- Concurrency beyond the single-session harnesses (final-slot races, parallel webhook and return, concurrent ballots or check-ins).
- Keyboard, screen-reader, 200% zoom and 320px passes by a person; archived-style side-by-side comparison.
- W11.3 cutover rehearsal beyond the waitlist-only plan in the [runbook](runbook.md).

## Housekeeping

An accidental `app/Untitled` file holding placeholder Stripe values (no real keys) was committed and then untracked and ignored. The runners that create Table fixtures now delete their runtime rows; a stale lock directory left by a failed run (`$TMPDIR/fifthwheel-rewrite-test-w06-table-invitation.lock`) blocks the next run and must be removed after a failure.

## 2026-11-16 addendum (local stack, working tree at the commit after `89005e1`)

| Check | Result |
|---|---|
| `pnpm typecheck`, `pnpm test` (340/340), `pnpm build`, `pnpm lint:ui` | passed |
| Real-stack journey `node scripts/run-w12-journey-browser.mjs` | passed 11/11 on the final run (two earlier runs each failed one stage on a timeout or a 503 while the machine was at a load average of about 18; the next run passed with no code change). Fixtures cleaned; Stripe test-mode objects remain in the sandbox. |
| Permission and direct-route sweep `node scripts/run-w12-authz.mjs` | 1550 pass, 0 fail, 1 deliberately skipped (admin GET of supply sync), of 1551 |
| DB harnesses extended: vote window to the second, DOB and age edges, 250-notice drain, abandoned lease → unknown, supply sync partial failure | passed |
| Worker evidence cleanup (journey stage 9c) | object removed from the private bucket, row `deleted`, checkout still works 31 days after review |

Defects found by these runs and fixed: Table-cancel refunds invisible/unsendable in the admin queue (`56261d8`); lost save confirmations after reload; unknown upload returned 503 instead of 404 (two RPC messages, `9ae4c0c` and `63b6b23`); draft update checked the mutation gate before authorization (`9ae4c0c`); hosts saw full guest names (now first names, `97613d7`).

Still not run: anything on a host (Supabase, Render, Resend, the GitHub scheduler, heartbeat alarm); live Stripe; backup restore rehearsal; keyboard, 320px, 200% zoom and screen-reader passes; archived-style visual comparison. Known open items: admins cannot submit or approve a roster they edited; no email for the extra refund remainder when a Table is cancelled after a partial refund; wrong-method API paths return 200 empty HTML in dev (production build not yet checked).
