import test from "node:test";
import assert from "node:assert/strict";
import { createWeeklyCloneRepository } from "./supply.weekly-clone.repository.server.ts";
import type { WeeklyCloneItemWork } from "./supply.weekly-clone.contract.server.ts";

const actor = "d7a6c8e2-51e8-4a2b-9672-052160a54601";
const operation = "d7a6c8e2-51e8-4a2b-9672-052160a54602";
const source = "d7a6c8e2-51e8-4a2b-9672-052160a54603";
const revision = "d7a6c8e2-51e8-4a2b-9672-052160a54604";
const target = "d7a6c8e2-51e8-4a2b-9672-052160a54605";
const targetRevision = "d7a6c8e2-51e8-4a2b-9672-052160a54606";
const marker = "d7a6c8e2-51e8-4a2b-9672-052160a54607";
const undoId = "d7a6c8e2-51e8-4a2b-9672-052160a54608";
const hash = "a".repeat(32);

function rawOperation() {
  return {
    operation: {
      operation_id: operation, actor_user_id: actor, source_week_start: "2026-11-16", target_week_start: "2026-11-23", week_delta: 1,
      plan_hash: hash, request_hash: hash, state: "undoing", manifest_revision: 4, retry_disposition: "blocked", undo_operation_id: undoId,
      undo_request_hash: hash, undo_expected_manifest_revision: 3, undo_retry_disposition: "same_operation_after_no_delete",
      started_at: "2026-11-13T00:00:00.000Z", updated_at: "2026-11-13T00:02:00.000Z", finished_at: null,
    },
    items: [{
      operation_id: operation, ordinal: 1, source_table_id: source, source_revision_id: revision, source_revision: 1,
      source_hash: hash, target_table_id: target, target_revision_id: targetRevision, target_hash: hash, marker_id: marker,
      source_record_id: null, provider_record_id: "fixture-weekly:run:record", target_content: { title: "Captured snapshot" },
      state: "undoing", safe_code: null, lease_until: "2026-11-13T00:03:00.000Z", created_at: "2026-11-13T00:01:00.000Z", updated_at: "2026-11-13T00:02:00.000Z",
    }],
  };
}

test("reconciling an exact surviving delete marker requests same-undo retry", async () => {
  let rpcName = "";
  let rpcPayload: Record<string, unknown> = {};
  const repository = createWeeklyCloneRepository({
    url: "http://127.0.0.1:57421", publishableKey: "publishable-key", secretKey: "service-key",
    fetch: async (input, init) => {
      rpcName = new URL(String(input)).pathname.split("/").at(-1) ?? "";
      rpcPayload = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Response.json(rawOperation());
    },
  });
  const work: WeeklyCloneItemWork = {
    operationId: operation, sourceTableId: source, sourceRevisionId: revision, sourceRecordId: null,
    targetTableId: target, markerId: marker, content: { title: "Captured snapshot" } as WeeklyCloneItemWork["content"],
    contentHash: hash, state: "undo_unknown", providerRecordId: "fixture-weekly:run:record",
  };
  const result = await repository.reconcileDelete(actor, work, { state: "found", providerRecordId: work.providerRecordId!, contentHash: hash });
  assert.equal(rpcName, "finish_weekly_supply_clone_undo_item");
  assert.equal(rpcPayload.p_resolution, "present");
  assert.equal(result.undoRetryDisposition, "same_operation_after_no_delete");
  assert.equal(result.undoExpectedManifestRevision, 3);
});
