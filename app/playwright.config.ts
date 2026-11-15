import { defineConfig } from "@playwright/test";

const testBaseUrl = "http://127.0.0.1:8086";

export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: testBaseUrl,
    headless: true,
    viewport: { width: 1440, height: 900 },
  },
  webServer: {
    command: "pnpm dev:test",
    url: testBaseUrl,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      APP_ORIGIN: testBaseUrl,
      SUPABASE_URL: "http://127.0.0.1:57421",
    },
  },
});
