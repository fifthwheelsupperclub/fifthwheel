import test from "node:test";
import assert from "node:assert/strict";
import { createWeeklyCloneRepository, WeeklyCloneRepositoryError } from "./supply.weekly-clone.repository.server.ts";

const actor = "d7a6c8e2-51e8-4a2b-9672-052160a54601";
const operation = "d7a6c8e2-51e8-4a2b-9672-052160a54602";
const source = "d7a6c8e2-51e8-4a2b-9672-052160a54603";
const target = "d7a6c8e2-51e8-4a2b-9672-052160a54605";

function repository(respond: () => Response, seen: { name?: string; payload?: Record<string, unknown> } = {}) {
  return createWeeklyCloneRepository({
    url: "http://127.0.0.1:57421", publishableKey: "publishable-key", secretKey: "service-key",
    fetch: async (input, init) => {
      seen.name = new URL(String(input)).pathname.split("/").at(-1) ?? "";
      seen.payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return respond();
    },
  });
}

test("clone calls the single RPC and parses the operation DTO", async () => {
  const seen: { name?: string; payload?: Record<string, unknown> } = {};
  const result = await repository(() => Response.json({
    operationId: operation, sourceWeekStart: "2026-11-16", targetWeekStart: "2026-11-23", state: "completed",
    startedAt: "2026-11-13T00:00:00.000Z", updatedAt: "2026-11-13T00:00:00.000Z", undoState: "available", draftCount: 1,
    items: [{ sourceTableId: source, targetTableId: target, title: "Copied", targetLocalDate: "2026-11-26", state: "created" }],
  }), seen).clone(actor, { operationId: operation, sourceWeekStart: "2026-11-16", targetWeekStart: "2026-11-23" });
  assert.equal(seen.name, "clone_weekly_supply");
  assert.deepEqual(seen.payload, { p_actor_user_id: actor, p_operation_id: operation, p_source_week: "2026-11-16", p_target_week: "2026-11-23" });
  assert.equal(result.items[0]?.targetTableId, target);
});

test("undo refusal and malformed responses surface as typed errors", async () => {
  const refused = repository(() => Response.json({ message: "undo_refused" }, { status: 400 }));
  await assert.rejects(refused.undo(actor, operation), (error) => error instanceof WeeklyCloneRepositoryError && error.code === "undo_refused");
  const malformed = repository(() => Response.json({ operationId: operation, state: "running" }));
  await assert.rejects(malformed.read(actor, operation), (error) => error instanceof WeeklyCloneRepositoryError && error.code === "response_invalid");
});
