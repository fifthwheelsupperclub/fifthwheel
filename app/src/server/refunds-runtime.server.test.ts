import test from "node:test";
import assert from "node:assert/strict";
import { createRefundWorkerRuntime } from "./refunds-runtime.server.ts";

test("refund worker composition rejects an untrusted worker secret before Supabase/provider construction", () => {
  assert.throws(() => createRefundWorkerRuntime("wrong-secret", { REFUND_WORKER_SECRET: "a".repeat(48) }), /refund_worker_unauthorized/);
});

test("refund worker requires a configured secret and never constructs a browser HTTP route", () => {
  assert.throws(() => createRefundWorkerRuntime("x".repeat(40), {}), /REFUND_WORKER_SECRET_unavailable/);
});
