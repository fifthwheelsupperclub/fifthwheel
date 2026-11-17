import { defineConfig } from "@playwright/test";

const appUrl = "http://127.0.0.1:8087";

export default defineConfig({
  testDir: "./tests/browser",
  testMatch: "w12-authz.spec.ts",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  timeout: 1_200_000,
  expect: { timeout: 15_000 },
  use: { baseURL: appUrl, headless: true, viewport: { width: 1280, height: 900 } },
  webServer: {
    command: "pnpm exec vite --host 127.0.0.1 --port 8087 --strictPort",
    cwd: ".",
    url: appUrl,
    reuseExistingServer: false,
    timeout: 90_000,
    env: { ...process.env, APP_ORIGIN: appUrl, SUPABASE_URL: "http://127.0.0.1:57421", MAILPIT_URL: "http://127.0.0.1:57424", MAIL_FROM_EMAIL: "w12-probe@example.test", MAIL_FROM_NAME: "W12 probe", MARKETING_ORIGIN: "http://127.0.0.1:4322" } as Record<string, string>,
  },
});
