---
id: fifthwheel-local-environment
type: runbook
status: active-local-only
date: 2026-11-13
owner: relay
related_objects: [local-rewrite-environment]
related_evidence: [supabase/config.toml, supabase/migrations/20261112043346_app_admission_foundation.sql, supabase/migrations/20261112053915_app_audit_events.sql, supabase/migrations/20261112070000_app_admission_queue_rpc.sql, supabase/migrations/20261112080000_app_invitation_attempt_rpcs.sql, supabase/migrations/20261112090000_member_link_activation.sql, supabase/migrations/20261112091000_reconcile_unknown_invitation_attempt.sql, scripts/test-admission-operation.mjs, scripts/test-invitation-attempts.mjs]
related_decisions: [decision-fresh-app-rewrite]
---

# Local rewrite environment

This setup belongs to the fresh `app/` rewrite. It does not reuse archived app source, legacy local database volumes, hosted project references, or hosted credentials. The development project ID is `fifthwheel-rewrite-dev`; the independent browser-test project is `fifthwheel-rewrite-test`.

## Ports

| Service | Port | Address / note |
|---|---:|---|
| Rewrite preview app | 8085 | `http://127.0.0.1:8085` |
| Independent browser-test app | 8086 | `pnpm dev:test` uses strict port binding |
| Marketing dev site | 4321 | Astro development default; `http://127.0.0.1:4321` |
| Marketing integration-test site | 4322 | Run Astro with `--port 4322 --strictPort`; fails on collision |
| Supabase API | 56421 | `http://127.0.0.1:56421` |
| Supabase database | 56422 | `127.0.0.1:56422` |
| Supabase Studio | 56423 | `http://127.0.0.1:56423` |
| Mailpit | 56424 | `http://127.0.0.1:56424`; email is intercepted |
| SMTP / POP3 | 56425 / 56426 | Local Mailpit only |
| Analytics | 56427 | Local Supabase service |
| Shadow database | 56420 | Local migration tooling |
| Pooler | 56429 | Reserved but disabled |
| Test shadow database | 57420 | Local migration tooling |
| Test API | 57421 | `http://127.0.0.1:57421` |
| Test database | 57422 | `127.0.0.1:57422` |
| Test Studio | 57423 | `http://127.0.0.1:57423` |
| Test Mailpit | 57424 | `http://127.0.0.1:57424`; email is intercepted |
| Test SMTP / POP3 | 57425 / 57426 | Local Mailpit only |
| Test Analytics | 57427 | Local Supabase service |
| Test Pooler | 57429 | Reserved but disabled |

`app/test-stack/supabase/migrations` is a symlink to the canonical `app/supabase/migrations` directory; schema SQL is not copied. Test-specific configuration and browser fixtures live under `app/test-stack/supabase/`. The historical 2026-11-12 check recorded migrations through `20261112091000` on both projects. On 2026-11-13, the isolated browser-test project advanced incrementally through `20261113055016_w06_roster_proposals_and_invitations.sql`; no database reset was run. The development project’s current migration history has not been rechecked. Keep test fixtures synthetic and isolated. Do not point browser tests at development data. Supabase service-port collisions fail before startup; never attach either stack to an existing project based only on a matching default port. The marketing integration site uses Astro's `--strictPort` on 4322 so it also fails instead of silently choosing another port. The marketing test port is separate from the Supabase port-collision scan. The machine also has unrelated Supabase projects on other port ranges.

The local Supabase CLI currently emits a warning that service ports bind to `0.0.0.0`, while the app and API URLs use `127.0.0.1`. Treat this stack as local-development only and do not expose it to an untrusted network.

Set `APP_ORIGIN` to the exact app origin for the process: development uses `http://127.0.0.1:8085` and browser tests use `http://127.0.0.1:8086`. Protected cookie-authenticated POST routes require an exact matching `Origin` header; missing or mismatched origins fail closed. The server does not infer the origin from forwarded headers, and `APP_ORIGIN` must not include a path, query, fragment or trailing slash.

Set `MARKETING_ORIGIN` to the exact origin of the marketing site calling `POST /api/waitlist` (development: `http://127.0.0.1:4321`; integration test: `http://127.0.0.1:4322`; production: `https://fifthwheel.community`). The endpoint uses this value for CORS and preflight checks; if it is missing or malformed, cross-origin submissions fail closed. Do not use a wildcard origin.

The local app email adapters require `MAILPIT_URL` and `MAIL_FROM_EMAIL`. Use `http://127.0.0.1:56424` for development and `http://127.0.0.1:57424` for the isolated browser-test stack; use a synthetic sender such as `admissions@example.test`. Both adapters reject non-loopback HTTP targets. Mailpit captures admission and returning sign-in messages locally; this integration does not send production email. Set `MAIL_FROM_NAME` only for a local display name.

The sign-out action revokes the current Supabase refresh session with local scope and clears both app cookies. Supabase access-token JWTs already issued remain valid until expiry, according to the [Supabase sign-out behavior](https://supabase.com/docs/reference/javascript/auth-signout); the app removes them from the current browser immediately.

## Commands

Use the guarded wrapper for local dev and test operations. It parses the active TOML `project_id`, `[api].port` and `[db].port`; refuses linked project metadata and nonmatching Supabase/database URL or project-ref inputs; checks Supabase service port ownership; and invokes only fixed local CLI arguments. Before reset, seed and test actions, it inspects `.env.test.local` in both `app/` and `app/test-stack/` in addition to the ordinary env files. Port 8086 belongs to the separate browser-test app and is not part of the Supabase collision scan. The wrapper suppresses CLI output that contains local keys. The CLI discovered for this environment is `2.105.0`.

```sh
node scripts/local-supabase.mjs dev start
node scripts/local-supabase.mjs dev status
node scripts/local-supabase.mjs dev reset
node scripts/local-supabase.mjs test start
node scripts/local-supabase.mjs test status
node scripts/local-supabase.mjs test reset
node scripts/local-supabase.mjs test seed
node scripts/local-supabase.mjs test test
node scripts/local-supabase.mjs test stop
node scripts/local-supabase.mjs self-check
# In the marketing-site workspace: pnpm dev --host 127.0.0.1 --port 4322 --strictPort
```

The wrapper's `reset` action destroys data in only the selected local database, replays migrations with `--local`, and skips seed. `seed` is refused until an isolated `seed.sql` exists; when added it will use only that project's local reset path. `test` runs the configured `pnpm test` script against the verified test API/publishable key/database URL in its process environment. Do not use raw `--linked`, `--db-url`, `--project-ref`, or `stop --all` commands for rewrite operations. Keep the app's ignore/secret rules in place; never copy generated local keys or provider credentials into source control or the browser bundle.

Apply reviewed incremental test-only schema changes through tracked migrations. Preflight with guarded `node scripts/local-supabase.mjs test status` and `SUPABASE_TELEMETRY_DISABLED=1 supabase migration list --local --workdir test-stack`; apply pending canonical migrations with `SUPABASE_TELEMETRY_DISABLED=1 supabase migration up --local --workdir test-stack`; then recheck status and migration history before running any fixture test. Never reset either stack for a feature migration. `node scripts/test-admission-operation.mjs` is pinned to the test workdir/ports, checks the guarded status and active RPC, creates deterministic synthetic fixtures, exercises concurrent/idempotent RPC calls, and cleans its exact rows in `finally`.

## Previous verification (2026-11-12)

On 2026-11-12, the guarded commands reported both isolated Supabase stacks running:

```text
dev status:  API http://127.0.0.1:56421, database 127.0.0.1:56422
test status: API http://127.0.0.1:57421, database 127.0.0.1:57422
```

Both dev and test migration histories show `20261112043346`, `20261112053915`, `20261112070000`, `20261112080000`, `20261112090000`, and `20261112091000`. Both stacks were running when checked. Supabase advisors were run with `--local --workdir .` and `--local --workdir test-stack`; each exited successfully with INFO findings only. These included intentionally policy-free RLS tables (default-deny with no anon/auth grants), unused indexes on empty local data, and foreign keys without covering indexes. The isolated invitation-attempt harness passed activation/replay/cross-user/deleted checks, concurrent cooldown claim and denial cases, service-role grants and anon/authenticated denial, concurrent attempt claims, stale-finisher protection, unknown non-resend and reconciliation. Exact synthetic fixture cleanup and post-run cooldown/audit residual checks returned zero. No reset was run as part of this migration/advisor verification. No hosted endpoint was contacted.

The read-only `self-check` exercises active TOML parsing with misleading commented and nested values, verifies 8086 is excluded from the Supabase service ports, and confirms both `.env.test.local` paths are included in the reset/test guard. It performs no Supabase or Docker operation.

Auth signup is disabled in both projects. Only the app server may issue links after admission/role checks. Development redirects are limited to `http://127.0.0.1:8085/auth/callback`; test redirects are limited to `http://127.0.0.1:8086/auth/callback`. Both use a one-hour token expiry. Local Auth email lands in the stack’s Mailpit; no provider email is sent. No production provider settings, live data, charges, refunds or deployment are configured here.

## Current verification (2026-11-13)

The `fifthwheel-rewrite-test` project was confirmed on API/database ports `57421/57422` with no linked project reference. A read-only `supabase migration list --local --workdir test-stack` on 2026-11-13 confirms history through `20261113142334_w06_table_invitation_history_and_delivery.sql`; migrations were applied incrementally without reset. The rollback-only roster harness exposed an applicant-pagination cursor bug. Tracked migration source is corrected, but the local function has not been updated because automatic approval review rejected that exact database operation; human approval to retry remains pending. No roster fixtures were committed. The W06.5 rollback-only delivery harness passes owner/member/admin DTO and grant boundaries, trusted delivery context, attempt begin/finish/replay, unknown resend denial, message-ID-bound delivery transition, failed retry replay/conflict and rollback. The real guarded W06.5 Mailpit/browser journey also passes, including a single queued retry, local worker delivery, actual member magic-link callback, owner-only detail, request/offer history and other-member denial; it removed its exact synthetic Auth/DB fixtures and Mailpit messages. This was intercepted local email only; no external/provider email was sent. Latest unit/server suite passes 214/214; fresh-copy frozen install, typecheck/build and preview startup pass. Do not accept W06.3–W06.4 roster DB evidence until the local pagination function is aligned and its harness passes.
