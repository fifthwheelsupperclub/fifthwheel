import assert from "node:assert/strict";
import test from "node:test";
import { createBoundedWaitlistRateLimiter, createWaitlistPostHandler } from "./waitlist.http.server.ts";
import type { WaitlistService } from "./waitlist.service.server.ts";
import { createWaitlistService } from "./waitlist.service.server.ts";

const payload = {
  first_name: "Avery",
  last_name: "Chen",
  email: "avery@example.test",
  birthdate: "1990-10-12",
  match_age_min: 21,
  match_age_max: 120,
  neighborhood: "Inman Park",
  identity: "Woman",
  open_to: "Women",
  nights: "Friday",
  looking_for: "Open",
  surprise_game: "Yes, surprise me",
  referral: "",
  source: "landing-page",
  submitted_at: "ignored",
  _gotcha: "",
};

function request(body: string, contentType = "application/json"): Request {
  return new Request("http://127.0.0.1:8085/api/waitlist", {
    method: "POST",
    headers: { "content-type": contentType },
    body,
  });
}

const marketingOrigin = "https://fifthwheel.community";

function crossOriginRequest(body: string, headers: Record<string, string> = {}): Request {
  return new Request("http://127.0.0.1:8085/api/waitlist", {
    method: "POST",
    headers: { origin: marketingOrigin, "content-type": "application/json", ...headers },
    body,
  });
}

test("POST route gives identical neutral success bodies for persisted, duplicate and honeypot outcomes", async () => {
  const submitted: unknown[] = [];
  const service: WaitlistService = {
    async submit(value) {
      submitted.push(value);
      return { ok: true, value: { received: true } };
    },
  };
  const handler = createWaitlistPostHandler(() => service);
  const responses = await Promise.all([
    handler(request(JSON.stringify(payload))),
    handler(request(JSON.stringify(payload))),
    handler(request(JSON.stringify({ ...payload, first_name: "", _gotcha: "bot" }))),
  ]);
  const results = await Promise.all(responses.map(async (response) => ({
    status: response.status,
    body: await response.json(),
    cacheControl: response.headers.get("cache-control"),
  })));
  assert.deepEqual(results, Array.from({ length: 3 }, () => ({
    status: 200,
    body: { received: true },
    cacheControl: "no-store",
  })));
  assert.equal(submitted.length, 3);
});

test("rejects wrong method, content type, oversized and malformed JSON without calling service", async () => {
  let calls = 0;
  const handler = createWaitlistPostHandler(() => ({
    async submit() { calls += 1; return { ok: true, value: { received: true } }; },
  }));
  const get = await handler(new Request("http://127.0.0.1:8085/api/waitlist"));
  const mediaType = await handler(request("{}", "text/plain"));
  const oversized = await handler(request(" ".repeat(16_385)));
  const malformed = await handler(request("{"));
  assert.equal(get.status, 405);
  assert.equal(mediaType.status, 415);
  assert.equal(oversized.status, 413);
  assert.equal(malformed.status, 400);
  assert.equal(calls, 0);
});

test("returns safe validation errors and generic provider recovery without exposing thrown errors", async () => {
  const invalidHandler = createWaitlistPostHandler(() => ({
    async submit() {
      return { ok: false, error: { code: "validation_failed", safeMessage: "Check the form fields.", fields: { match_age_max: "Enter an age from 21 to 120." } } };
    },
  }));
  const invalid = await invalidHandler(request(JSON.stringify({ ...payload, match_age_max: 121 })));
  assert.equal(invalid.status, 400);
  assert.deepEqual(await invalid.json(), {
    error: {
      code: "validation_failed",
      safeMessage: "Check the form fields.",
      fields: { match_age_max: "Enter an age from 21 to 120." },
    },
  });

  const outageHandler = createWaitlistPostHandler(() => ({
    async submit() { throw new Error("secret database URL and PII"); },
  }));
  const outage = await outageHandler(request(JSON.stringify(payload)));
  assert.equal(outage.status, 503);
  const body = JSON.stringify(await outage.json());
  assert.match(body, /temporarily_unavailable/);
  assert.doesNotMatch(body, /secret database URL|PII/);
});

test("underage, malformed DOB and out-of-range ages return validation errors without intake side effects", async () => {
  let persistenceCalls = 0;
  const service = createWaitlistService({
    repository: {
      async insertIfAbsent() {
        persistenceCalls += 1;
        throw new Error("invalid intake must not be persisted");
      },
    },
    now: () => new Date("2026-11-12T17:00:00.000Z"),
  });
  const handler = createWaitlistPostHandler(() => service);
  const outcomes = await Promise.all([
    handler(request(JSON.stringify({ ...payload, birthdate: "2005-11-13" }))),
    handler(request(JSON.stringify({ ...payload, birthdate: "2001-02-29" }))),
    handler(request(JSON.stringify({ ...payload, match_age_min: 121, match_age_max: 121 }))),
    handler(request(JSON.stringify({ ...payload, match_age_min: 21, match_age_max: 121 }))),
  ]);

  for (const response of outcomes) {
    assert.equal(response.status, 400);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const body = JSON.stringify(await response.json());
    assert.match(body, /validation_failed/);
    assert.doesNotMatch(body, /avery@example\.test|2005-11-13/);
  }
  assert.equal(persistenceCalls, 0);
});

test("allows only the configured marketing origin and answers only the supported CORS preflight", async () => {
  let calls = 0;
  const handler = createWaitlistPostHandler(() => ({
    async submit() { calls += 1; return { ok: true, value: { received: true } }; },
  }), {
    allowedOrigin: marketingOrigin,
    mode: "test",
    limiter: { consume: () => ({ allowed: true }) },
  });

  const allowed = await handler(crossOriginRequest(JSON.stringify(payload)));
  assert.equal(allowed.status, 200);
  assert.equal(allowed.headers.get("access-control-allow-origin"), marketingOrigin);
  assert.equal(allowed.headers.get("vary"), "Origin");

  const preflight = await handler(new Request("http://127.0.0.1:8085/api/waitlist", {
    method: "OPTIONS",
    headers: {
      origin: marketingOrigin,
      "access-control-request-method": "POST",
      "access-control-request-headers": "content-type, accept",
    },
  }));
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), marketingOrigin);
  assert.equal(preflight.headers.get("access-control-allow-methods"), "POST, OPTIONS");
  assert.equal(preflight.headers.get("access-control-allow-headers"), "accept, content-type");
  assert.equal(preflight.headers.get("access-control-allow-credentials"), null);
  assert.equal(calls, 1);

  const deniedOrigins = [
    new Request("http://127.0.0.1:8085/api/waitlist", { method: "OPTIONS", headers: { origin: "https://evil.example", "access-control-request-method": "POST" } }),
    crossOriginRequest(JSON.stringify(payload), { origin: "https://evil.example" }),
  ];
  for (const denied of deniedOrigins) {
    const response = await handler(denied);
    assert.equal(response.status, 403);
    assert.equal(response.headers.get("access-control-allow-origin"), null);
  }
  for (const invalidPreflight of [
    new Request("http://127.0.0.1:8085/api/waitlist", { method: "OPTIONS", headers: { origin: marketingOrigin, "access-control-request-method": "PUT" } }),
    new Request("http://127.0.0.1:8085/api/waitlist", { method: "OPTIONS", headers: { origin: marketingOrigin, "access-control-request-method": "POST", "access-control-request-headers": "authorization" } }),
  ]) {
    const response = await handler(invalidPreflight);
    assert.equal(response.status, 403);
    assert.equal(response.headers.get("access-control-allow-origin"), marketingOrigin);
    assert.equal(response.headers.get("access-control-allow-methods"), null);
  }
  assert.equal(calls, 1);
});

test("bounds the local shared rate bucket with opaque digests and reports retry time", async () => {
  let now = 10_000;
  let calls = 0;
  const limiter = createBoundedWaitlistRateLimiter({
    secret: "test-only-secret",
    maxRequests: 2,
    windowMs: 1_000,
    maxKeys: 1,
    now: () => now,
    getTrustedClientAddress: (request) => request.headers.get("test-trusted-peer"),
  });
  const handler = createWaitlistPostHandler(() => ({
    async submit() { calls += 1; return { ok: true, value: { received: true } }; },
  }), { allowedOrigin: marketingOrigin, mode: "test", limiter });
  const first = await handler(crossOriginRequest(JSON.stringify(payload), { "test-trusted-peer": "peer-a", "x-forwarded-for": "198.51.100.9" }));
  const second = await handler(crossOriginRequest(JSON.stringify(payload), { "test-trusted-peer": "peer-a", "x-forwarded-for": "198.51.100.9" }));
  const blocked = await handler(crossOriginRequest(JSON.stringify(payload), { "test-trusted-peer": "peer-a", "x-forwarded-for": "198.51.100.9" }));
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers.get("retry-after"), "1");
  assert.equal(blocked.headers.get("access-control-allow-origin"), marketingOrigin);
  assert.equal(calls, 2);

  now += 1_001;
  assert.equal((await handler(crossOriginRequest(JSON.stringify(payload), { "test-trusted-peer": "peer-a", "x-forwarded-for": "198.51.100.9" }))).status, 200);
  assert.equal(calls, 3);
});

test("fails closed in production without a durable limiter and on malformed allowed-origin config", async () => {
  let calls = 0;
  const service: () => WaitlistService = () => ({
    async submit() { calls += 1; return { ok: true, value: { received: true } as const }; },
  });
  const noLimiter = createWaitlistPostHandler(service, { allowedOrigin: marketingOrigin, mode: "production" });
  const unavailable = await noLimiter(crossOriginRequest(JSON.stringify(payload)));
  assert.equal(unavailable.status, 503);
  assert.equal(unavailable.headers.get("access-control-allow-origin"), marketingOrigin);
  assert.equal(calls, 0);

  const invalidConfig = createWaitlistPostHandler(service, { allowedOrigin: "https://fifthwheel.community/waitlist", mode: "test" });
  assert.equal((await invalidConfig(crossOriginRequest(JSON.stringify(payload)))).status, 503);
  assert.equal(calls, 0);
});
