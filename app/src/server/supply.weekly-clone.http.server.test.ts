import assert from "node:assert/strict";
import test from "node:test";
import type { WeeklyClonePreviewDTO } from "../supply.weekly-clone.contract.ts";
import type { WeeklyCloneService } from "./supply.weekly-clone.contract.server.ts";
import { createWeeklyCloneHttpHandlers } from "./supply.weekly-clone.http.server.ts";

const preview: WeeklyClonePreviewDTO = {
  weekStartPolicy: "monday", sourceWeekStart: "2026-11-16", targetWeekStart: "2026-11-23",
  weekDelta: 1, items: [], eligibleCount: 0, conflictCount: 0,
};

function setup() {
  const calls: { previewToken: string | null | undefined; previewSource?: string; listLimit?: number; listCursor?: string | null; readId?: string } = { previewToken: undefined };
  const service = {
    async preview(input: { accessToken?: string | null; sourceWeekStart: string }) {
      calls.previewToken = input.accessToken; calls.previewSource = input.sourceWeekStart;
      return { ok: true as const, value: preview };
    },
    async listOperations(input: { accessToken?: string | null; cursor?: string | null; limit: number }) {
      calls.listLimit = input.limit; calls.listCursor = input.cursor; return { ok: true as const, value: { items: [], nextCursor: null } };
    },
    async readOperation(input: { operationId: string }) { calls.readId = input.operationId; return { ok: false as const, error: { code: "not_found" as const, safeMessage: "not found" } }; },
  } as unknown as WeeklyCloneService;
  return { calls, handlers: createWeeklyCloneHttpHandlers(() => service, "http://127.0.0.1:8086") };
}

test("preview enforces exact origin and returns a no-store DTO envelope", async () => {
  const { calls, handlers } = setup();
  const wrong = await handlers.preview(new Request("http://127.0.0.1:8086/api/admin/supply/weekly-clone/preview", {
    method: "POST", headers: { origin: "http://127.0.0.1:8085", "content-type": "application/json" }, body: JSON.stringify({ sourceWeekStart: "2026-11-16", targetWeekStart: "2026-11-23" }),
  }));
  assert.equal(wrong.status, 403); assert.equal(calls.previewSource, undefined);

  const response = await handlers.preview(new Request("http://127.0.0.1:8086/api/admin/supply/weekly-clone/preview", {
    method: "POST", headers: { origin: "http://127.0.0.1:8086", cookie: "fw_access_token=a.b.c", "content-type": "application/json" },
    body: JSON.stringify({ sourceWeekStart: "2026-11-16", targetWeekStart: "2026-11-23" }),
  }));
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(calls.previewToken, "a.b.c"); assert.equal(calls.previewSource, "2026-11-16");
  const body = await response.json() as { ok: boolean; data: WeeklyClonePreviewDTO };
  assert.equal(body.ok, true); assert.equal(body.data.weekStartPolicy, "monday");
});

test("preview and history reject unknown fields and invalid pagination", async () => {
  const { calls, handlers } = setup();
  const extra = await handlers.preview(new Request("http://127.0.0.1:8086/api/admin/supply/weekly-clone/preview", {
    method: "POST", headers: { origin: "http://127.0.0.1:8086", "content-type": "application/json" },
    body: JSON.stringify({ sourceWeekStart: "2026-11-16", targetWeekStart: "2026-11-23", admin: true }),
  }));
  const badList = await handlers.listOperations(new Request("http://127.0.0.1:8086/api/admin/supply/weekly-clone/operations?limit=0"));
  assert.equal(extra.status, 400); assert.equal(badList.status, 400); assert.equal(calls.previewSource, undefined); assert.equal(calls.listLimit, undefined);
});

test("operation detail rejects malformed ids before calling the service", async () => {
  const { calls, handlers } = setup();
  const response = await handlers.readOperation(new Request("http://127.0.0.1:8086/api/admin/supply/weekly-clone/operations/nope"), "nope");
  assert.equal(response.status, 400); assert.equal(calls.readId, undefined);
});

test("undo accepts only an empty JSON body", async () => {
  const { handlers } = setup();
  const id = "59d4e311-1a24-45b8-b361-93527521d008";
  const response = await handlers.undo(new Request(`http://127.0.0.1:8086/api/admin/supply/weekly-clone/operations/${id}/undo`, {
    method: "POST", headers: { origin: "http://127.0.0.1:8086", "content-type": "application/json" }, body: JSON.stringify({ undoOperationId: id }),
  }), id);
  assert.equal(response.status, 400);
});
