import { defineConfig } from "@playwright/test";

const appOrigin = "http://127.0.0.1:8086";

export default defineConfig({
  testDir: "./tests/browser",
  testMatch: /w05-(?:supply-curation|weekly-clone)\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: appOrigin,
    headless: true,
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
  },
  webServer: {
    command: "pnpm dev:test",
    cwd: ".",
    url: appOrigin,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      ...process.env,
      APP_ORIGIN: appOrigin,
      SUPABASE_URL: "http://127.0.0.1:57421",
    },
  },
});
