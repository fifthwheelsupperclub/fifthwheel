import test from "node:test";
import assert from "node:assert/strict";
import { createRefundHttpHandlers } from "./refunds.http.server.ts";
import type { RefundService } from "./refunds.contract.server.ts";

const ok = { ok: true as const, value: { items: [], nextCursor: null } };
test("refund mutation rejects a foreign Origin before service access", async () => {
  let called = false;
  const service = { async dispatchRefund() { called = true; return ok; } } as unknown as RefundService;
  const handlers = createRefundHttpHandlers(() => service, "http://127.0.0.1:8085");
  const response = await handlers.dispatchRefund(new Request("http://127.0.0.1:8085/api/admin/refunds/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/dispatch", {
    method: "POST", headers: { origin: "http://evil.example", "content-type": "application/json" },
    body: JSON.stringify({ operationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }),
  }), "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  assert.equal(response.status, 403);
  assert.equal(called, false);
});

test("refund mutation reads the access token only from the HttpOnly session cookie", async () => {
  let accessToken: string | null | undefined;
  const service = { async dispatchRefund(input: { accessToken?: string | null }) { accessToken = input.accessToken; return ok; } } as unknown as RefundService;
  const handlers = createRefundHttpHandlers(() => service, "http://127.0.0.1:8085");
  const response = await handlers.dispatchRefund(new Request("http://127.0.0.1:8085/api/admin/refunds/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/dispatch", {
    method: "POST", headers: { origin: "http://127.0.0.1:8085", cookie: "fw_access_token=aaa.bbb.ccc", "content-type": "application/json" },
    body: JSON.stringify({ operationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }),
  }), "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  assert.equal(response.status, 200);
  assert.equal(accessToken, "aaa.bbb.ccc");
});

test("refund mutation rejects extra caller-controlled amount fields", async () => {
  let called = false;
  const service = { async dispatchRefund() { called = true; return ok; } } as unknown as RefundService;
  const handlers = createRefundHttpHandlers(() => service, "http://127.0.0.1:8085");
  const response = await handlers.dispatchRefund(new Request("http://127.0.0.1:8085/api/admin/refunds/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/dispatch", {
    method: "POST", headers: { origin: "http://127.0.0.1:8085", "content-type": "application/json" },
    body: JSON.stringify({ operationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", amountCents: 1 }),
  }), "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  assert.equal(response.status, 400);
  assert.equal(called, false);
});
