import assert from "node:assert/strict";
import { test } from "node:test";
import { checkProductionEnv } from "./preflight.server.ts";

const good = { NODE_ENV: "production", APP_ORIGIN: "https://app.fifthwheel.community", MARKETING_ORIGIN: "https://fifthwheel.community", SUPABASE_URL: "https://abc.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x", SUPABASE_SECRET_KEY: "sb_secret_y", RESEND_API_KEY: "re_abcdefgh123", MAIL_FROM_EMAIL: "hello@fifthwheel.community",
  STRIPE_MODE: "live", STRIPE_SECRET_KEY: "sk_live_abc", STRIPE_PUBLISHABLE_KEY: "pk_live_abc", VITE_STRIPE_PUBLISHABLE_KEY: "pk_live_abc", STRIPE_WEBHOOK_SECRET: "whsec_abc",
  CHECKOUT_FULFILLMENT_READY: "false", REFUND_WORKER_READY: "false", JOB_SECRET: "j".repeat(40), REFUND_WORKER_SECRET: "r".repeat(40), REFUND_WORKER_ID: "e0840000-0000-4000-8000-000000000001" };

test("a complete, consistent production configuration passes with no secrets echoed", () => {
  const r = checkProductionEnv(good);
  assert.deepEqual(r, { ok: true, problems: [], warnings: [] });
});

test("each misconfiguration is caught by name without repeating its value", () => {
  const cases: Array<[Record<string, string | undefined>, RegExp]> = [
    [{ NODE_ENV: "development" }, /NODE_ENV/], [{ APP_ORIGIN: "http://app.fifthwheel.community" }, /APP_ORIGIN: must be an https origin/], [{ APP_ORIGIN: "https://app.fifthwheel.community/" }, /APP_ORIGIN: must be exactly an origin/],
    [{ MARKETING_ORIGIN: undefined }, /MARKETING_ORIGIN: required/], [{ SUPABASE_URL: "http://127.0.0.1:57421" }, /SUPABASE_URL: must be a hosted/], [{ SUPABASE_SECRET_KEY: "sb_publishable_x" }, /must differ/],
    [{ MAILPIT_URL: "http://127.0.0.1:8025" }, /MAILPIT_URL: must not be set/], [{ RESEND_API_KEY: "nope" }, /RESEND_API_KEY/], [{ STRIPE_MODE: "live", STRIPE_SECRET_KEY: "sk_test_abc" }, /STRIPE_SECRET_KEY: must start with sk_live_/],
    [{ STRIPE_PUBLISHABLE_KEY: "pk_test_abc" }, /STRIPE_PUBLISHABLE_KEY: must start with pk_live_/], [{ VITE_STRIPE_PUBLISHABLE_KEY: "pk_live_other" }, /VITE_STRIPE_PUBLISHABLE_KEY: must equal/],
    [{ STRIPE_WEBHOOK_SECRET: "abc" }, /whsec_/], [{ JOB_SECRET: "short" }, /JOB_SECRET: must be at least 32/], [{ REFUND_WORKER_ID: "x" }, /REFUND_WORKER_ID/],
    [{ CHECKOUT_FULFILLMENT_READY: "yes" }, /CHECKOUT_FULFILLMENT_READY: must be exactly true or false/], [{ STRIPE_MODE: "sandbox" }, /STRIPE_MODE/],
  ];
  for (const [override, pattern] of cases) {
    const r = checkProductionEnv({ ...good, ...override });
    assert.equal(r.ok, false, JSON.stringify(Object.keys(override)));
    assert.ok(r.problems.some((p) => pattern.test(p)), `${Object.keys(override)}: ${r.problems.join(" | ")}`);
    for (const value of Object.values(override)) if (value && value.length > 8) assert.ok(!r.problems.join().includes(value), "a value was echoed");
  }
});

test("going live is flagged as a warning, not silently allowed", () => {
  const r = checkProductionEnv({ ...good, CHECKOUT_FULFILLMENT_READY: "true", REFUND_WORKER_READY: "true" });
  assert.equal(r.ok, true);
  assert.match(r.warnings.join(), /guests can pay/);
  assert.match(checkProductionEnv({ ...good, STRIPE_MODE: "test", STRIPE_SECRET_KEY: "sk_test_a", STRIPE_PUBLISHABLE_KEY: "pk_test_a", VITE_STRIPE_PUBLISHABLE_KEY: "pk_test_a", CHECKOUT_FULFILLMENT_READY: "true" }).warnings.join(), /staging configuration/);
});
