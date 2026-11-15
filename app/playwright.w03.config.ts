import { defineConfig } from "@playwright/test";

const appUrl = "http://127.0.0.1:8086";
const marketingUrl = "http://127.0.0.1:4322";

export default defineConfig({
  testDir: "./tests/browser",
  testMatch: "w03-admission.spec.ts",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: appUrl,
    headless: true,
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      command: "pnpm dev:test",
      cwd: ".",
      url: appUrl,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        ...process.env,
        APP_ORIGIN: appUrl,
        MARKETING_ORIGIN: marketingUrl,
      },
    },
    {
      command: "pnpm dev --host 127.0.0.1 --port 4322 --strictPort",
      cwd: "..",
      url: marketingUrl,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        ...process.env,
        PUBLIC_WAITLIST_URL: `${appUrl}/api/waitlist`,
      },
    },
  ],
});
