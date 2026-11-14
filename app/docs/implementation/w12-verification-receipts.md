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

The guarded `test reset` replayed the migration chain onto an empty database and **failed at migration 13**: `20261112202411_supply_draft_management.sql` contained a stray `end if;` (it had only ever worked on a database that was migrated incrementally before an edit). Fixed. After the fix `supabase migration up` applied all 35 migrations to the empty database without error. Because the reset began before the failure, the test database was left empty and partially migrated until the repair; it is now fully migrated and holds no data.

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
| W05 supply sync, Table management, weekly clone | **not passing**: the tests predate the admin navigation and copy changes (they look for a sync panel and strings that no longer exist on `/admin/tables`). The product is not known to be broken, but it is not re-verified. Airtable sync is out of launch scope; Table management and weekly clone are in scope and need their tests brought up to date. |

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
