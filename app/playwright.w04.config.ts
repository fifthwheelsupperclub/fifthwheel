import { defineConfig } from "@playwright/test";

const appOrigin = "http://127.0.0.1:8086";

export default defineConfig({
  testDir: "./tests/browser",
  testMatch: /w04-(profile|route-auth)\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  timeout: 120_000,
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
  },
});
