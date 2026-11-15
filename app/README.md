# Fifth Wheel — fresh rewrite

The previous app is preserved as a local reference in [archives](../archives/README.md). This `app/` directory is the new runtime, being rebuilt from the current [requirements](docs/PRD.md), [architecture](docs/architecture.md), [flows](docs/flow-ui-brief.md) and [rewrite task list](docs/tasks-checklist.md). Archived app code is not imported into this runtime.

The rewrite preserves the previous app’s visual style while improving layouts, information architecture and navigation. Implementation uses isolated synthetic local data and intercepted email. Existing live data and financial obligations must be preserved; local reset/test scripts must refuse hosted targets. Real email, provider writes, charges/refunds, deployment, publication and external PRs require separate explicit authorization.

## Local setup

Use Node.js `>=22.12.0` and pnpm `10.17.1` (the exact versions are recorded in `package.json`). Install with `pnpm install --frozen-lockfile`; run `pnpm typecheck`, `pnpm test`, and `pnpm build` for local checks. On 2026-11-13, a fresh temporary source copy passed the frozen-lockfile install, typecheck, build, and Vite preview startup/HTTP 200. The server suite passed 214/214. `pnpm test:browser` runs the six-screen visual-preview smoke check against a separately started app on port 8086; it is not the authenticated feature acceptance suite and requires Google Chrome.

The guarded Supabase test command is `node scripts/local-supabase.mjs test test`. It validates the isolated `fifthwheel-rewrite-test` target before starting the local test stack and invoking `pnpm test`.

The W03 end-to-end admission journey uses its own run-scoped Auth/database fixtures and starts the app at `127.0.0.1:8086`, the marketing site at `127.0.0.1:4322`, and intercepted test Mailpit at `127.0.0.1:57424`. Port `4322` must be free; the runner checks it before fixture creation and fails closed if it is occupied or cannot verify ownership:

```sh
node scripts/run-w03-browser.mjs
```

That runner requires the isolated test Supabase stack to be running and configured through `.env.test.local`. It checks the active local project, API/database ports, Mailpit, and required W03 migrations before creating fixtures. It never resets a database and removes only its run-scoped synthetic rows in cleanup. `pnpm test:browser` remains the visual preview smoke check and does not create authenticated fixtures.

## Current app status

The app runtime is served on `127.0.0.1:8085`; `/` routes by verified account workspaces. `/preview` is a development-only six-screen visual reference, not the app. Working local journeys currently include app admission/sign-in, profile review, supply management, Table browse/request, and partial roster/Table-offer work. Use the [task checklist](docs/tasks-checklist.md) and [task ledger](docs/implementation/task-ledger.md) for current acceptance state: some screens have mock-only evidence, and payment/Seat, night-of, partner, release and several W06 database/provider checks remain incomplete. See [implementation artifacts](docs/implementation/) for milestone evidence and screenshots.
