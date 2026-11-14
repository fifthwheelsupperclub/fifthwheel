import { defineConfig } from "@playwright/test";

const appOrigin = "http://127.0.0.1:8086";

export default defineConfig({
  testDir: "./tests/browser",
  testMatch: "w04-route-auth.spec.ts",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: appOrigin,
    headless: true,
    viewport: { width: 1440, height: 900 },
  },
  webServer: {
    command: "pnpm dev:test",
    cwd: ".",
    url: appOrigin,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      APP_ORIGIN: appOrigin,
      SUPABASE_URL: "http://127.0.0.1:57421",
      SUPABASE_PUBLISHABLE_KEY: "local-anonymous-route-probe-only",
      SUPABASE_SECRET_KEY: "local-secret-route-probe-only",
      MAILPIT_URL: "http://127.0.0.1:57424",
      MAIL_FROM_EMAIL: "route-probe@example.test",
      MARKETING_ORIGIN: "http://127.0.0.1:4322",
    },
  },
});
