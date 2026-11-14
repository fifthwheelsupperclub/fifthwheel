import assert from "node:assert/strict";
import test from "node:test";
import { createSupplyManagementHttpHandlers } from "./supply.management.http.server.ts";
import type { SupplyManagementService } from "./supply.management.contract.server.ts";

function setup() {
  const calls = { create: 0 };
  const service = {
    async createDraft() { calls.create += 1; return { ok: false as const, error: { code: "unauthenticated" as const, safeMessage: "Sign in." } }; },
  } as unknown as SupplyManagementService;
  return { calls, handlers: createSupplyManagementHttpHandlers(() => service, "http://127.0.0.1:8085") };
}

test("draft mutations require exact configured Origin before service calls", async () => {
  const { calls, handlers } = setup();
  const request = new Request("http://127.0.0.1:8085/api/supply/drafts", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}),
  });
  const response = await handlers.createDraft(request);
  assert.equal(response.status, 403);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(calls.create, 0);
});

test("draft JSON is bounded while streaming even without Content-Length", async () => {
  const { calls, handlers } = setup();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(40 * 1024).fill(32));
      controller.enqueue(new Uint8Array(40 * 1024).fill(32));
      controller.close();
    },
  });
  const request = new Request("http://127.0.0.1:8085/api/supply/drafts", {
    method: "POST", headers: { origin: "http://127.0.0.1:8085", "content-type": "application/json" }, body,
    // @ts-expect-error Node's RequestInit requires duplex for a streamed test body.
    duplex: "half",
  });
  const response = await handlers.createDraft(request);
  assert.equal(response.status, 413);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(calls.create, 0);
});
