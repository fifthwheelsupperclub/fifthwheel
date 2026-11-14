import assert from "node:assert/strict";
import test from "node:test";
import { assertExactOrigin } from "./origin.server.ts";

const appOrigin = "http://127.0.0.1:8085";

function request(headers: HeadersInit = {}): Request {
  return new Request("http://127.0.0.1:8085/api/action", { method: "POST", headers });
}

function reason(requestValue: Request, expected: string | undefined): string | undefined {
  const decision = assertExactOrigin(requestValue, expected);
  return decision.allowed ? undefined : decision.reason;
}

test("requires an exact configured scheme, host and port match", () => {
  assert.deepEqual(assertExactOrigin(request({ origin: appOrigin }), appOrigin), { allowed: true, origin: appOrigin });
  assert.equal(reason(request({ origin: "http://localhost:8085" }), appOrigin), "origin_mismatch");
  assert.equal(reason(request({ origin: "http://127.0.0.1:8086" }), appOrigin), "origin_mismatch");
  assert.equal(reason(request({ origin: "https://127.0.0.1:8085" }), appOrigin), "origin_mismatch");
});

test("fails closed for missing origin, missing configuration, malformed config and forwarded-header spoofing", () => {
  assert.equal(reason(request(), appOrigin), "origin_missing");
  assert.equal(reason(request({ origin: appOrigin }), undefined), "configuration_missing");
  assert.equal(reason(request({ origin: appOrigin }), "https://user:pass@example.test"), "configuration_invalid");
  assert.equal(reason(request({ origin: "https://evil.example", "x-forwarded-host": "127.0.0.1:8085" }), appOrigin), "origin_mismatch");
});
