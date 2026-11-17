import { defineConfig } from "@playwright/test";

const appUrl = "http://127.0.0.1:8086";

export default defineConfig({
  testDir: "./tests/browser",
  testMatch: "w12-journey.spec.ts",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  timeout: 900_000,
  expect: { timeout: 20_000 },
  use: { baseURL: appUrl, headless: true, actionTimeout: 30_000, navigationTimeout: 30_000, viewport: { width: 1440, height: 1000 }, trace: "retain-on-failure", screenshot: "only-on-failure" },
  webServer: {
    command: "pnpm dev:test",
    cwd: ".",
    url: appUrl,
    reuseExistingServer: false,
    timeout: 60_000,
    env: { ...process.env, APP_ORIGIN: appUrl, SUPABASE_URL: "http://127.0.0.1:57421", MAILPIT_URL: "http://127.0.0.1:57424" },
  },
});
