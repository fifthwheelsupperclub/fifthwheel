import { defineConfig } from "@playwright/test";

const appUrl = "http://127.0.0.1:8086";

export default defineConfig({
  testDir: "./tests/browser",
  testMatch: "w03-expired-link.spec.ts",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  timeout: 60_000,
  expect: { timeout: 12_000 },
  use: { baseURL: appUrl, headless: true, trace: "retain-on-failure", screenshot: "only-on-failure" },
  webServer: {
    command: "pnpm dev:test",
    cwd: ".",
    url: appUrl,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      ...process.env,
      APP_ORIGIN: appUrl,
      MARKETING_ORIGIN: "http://127.0.0.1:4322",
    },
  },
});
