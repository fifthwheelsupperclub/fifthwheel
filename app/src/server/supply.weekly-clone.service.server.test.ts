import assert from "node:assert/strict";
import test from "node:test";
import type { SupplyDraftContent } from "../supply.management.contract.ts";
import type { WeeklyCloneOperationDTO, WeeklyClonePreviewDTO, WeeklyCloneUndoRequest } from "../supply.weekly-clone.contract.ts";
import type { ServerVerifiedPrincipal } from "./authorization.server.ts";
import type { WeeklyCloneItemWork, WeeklyClonePlan, WeeklyCloneProvider, WeeklyCloneRepository } from "./supply.weekly-clone.contract.server.ts";
import { createWeeklyCloneService } from "./supply.weekly-clone.service.server.ts";

const adminId = "59d4e311-1a24-45b8-b361-93527521d001";
const memberId = "59d4e311-1a24-45b8-b361-93527521d002";
const tableId = "59d4e311-1a24-45b8-b361-93527521d003";
const revisionId = "59d4e311-1a24-45b8-b361-93527521d004";
const targetId = "59d4e311-1a24-45b8-b361-93527521d005";
const targetRevisionId = "59d4e311-1a24-45b8-b361-93527521d006";
const markerId = "59d4e311-1a24-45b8-b361-93527521d007";
const operationId = "59d4e311-1a24-45b8-b361-93527521d008";
const undoOperationId = "59d4e311-1a24-45b8-b361-93527521d009";
const hash = "aabbccddeeff00112233445566778899";
const content: SupplyDraftContent = {
  title: "Synthetic Thursday Table", localDate: "2026-11-19", startLocalTime: "19:00", neighborhood: "Inman Park", hostNotes: "",
  stops: [
    { role: "drinks", venueId: "59d4e311-1a24-45b8-b361-93527521d011", venueName: "Olive Room", venueAddress: "10 Example Way", minutesFromStart: 0, publicNotes: "" },
    { role: "dinner", venueId: "59d4e311-1a24-45b8-b361-93527521d012", venueName: "Olive Room", venueAddress: "10 Example Way", minutesFromStart: 45, publicNotes: "" },
    { role: "dessert", venueId: "59d4e311-1a24-45b8-b361-93527521d013", venueName: "Night Garden", venueAddress: "20 Example Way", minutesFromStart: 120, publicNotes: "" },
  ],
};
const plan: WeeklyClonePlan = {
  planHash: hash, weekDelta: 1, items: [{ sourceTableId: tableId, sourceRevisionId: revisionId, sourceRevision: 3, sourceHash: hash,
    content, targetContent: { ...content, localDate: "2026-11-26" }, title: content.title,
    sourceLocalDate: content.localDate, targetLocalDate: "2026-11-26", eligibility: "eligible", conflictCode: null }],
};
const work: WeeklyCloneItemWork = { operationId, sourceTableId: tableId, sourceRevisionId: revisionId, sourceRecordId: "source:table:1",
  targetTableId: targetId, markerId, content: plan.items[0]!.targetContent, contentHash: hash, state: "creating", providerRecordId: null };

function principal(role: "admin" | "member"): ServerVerifiedPrincipal {
  return { userId: role === "admin" ? adminId : memberId, emailNormalized: `${role}@example.test`, emailVerified: true,
    staffRoles: new Set(role === "admin" ? ["admin"] : []),
    admission: { state: role === "member" ? "activated" : "none", authUserId: role === "member" ? memberId : null, emailNormalized: role === "member" ? "member@example.test" : null },
    assignedTableIds: new Set(), assignedVenueIds: new Set() };
}

function operation(state: WeeklyCloneOperationDTO["state"] = "completed"): WeeklyCloneOperationDTO {
  return { providerState: "fixture", mutationsEnabled: true, operationId, state, manifestRevision: 4,
    sourceWeekStart: "2026-11-16", targetWeekStart: "2026-11-23", planHash: hash, startedAt: "2026-11-12T12:00:00Z",
    updatedAt: "2026-11-12T12:01:00Z", finishedAt: "2026-11-12T12:01:00Z", retryDisposition: "blocked",
    undoOperationId: null, undoExpectedManifestRevision: null, undoRetryDisposition: null, undoState: "available", undoBlockedCode: null,
    items: [{ sourceTableId: tableId, sourceRevisionId: revisionId, targetTableId: targetId, targetRevisionId,
      state: "created", safeCode: null }] };
}

function setup(options: Readonly<{ providerState?: WeeklyCloneProvider["state"]; mutationsEnabled?: boolean; providerResult?: "created" | "outcome_unknown" | "failed" | "conflict" }> = {}) {
  const calls = { preview: 0, begin: 0, claim: 0, finish: 0, read: 0, list: 0, reconcile: 0, beginUndo: 0, finishUndo: 0, create: 0, lookup: 0, remove: 0 };
  let current = operation();
  const repository: WeeklyCloneRepository = {
    async preview() { calls.preview += 1; return plan; },
    async begin() { calls.begin += 1; return current; },
    async claimNext() { calls.claim += 1; return calls.claim === 1 ? work : null; },
    async finishCreate(_actor, _work, result) { calls.finish += 1; current = operation(result.state === "outcome_unknown" ? "outcome_unknown" : result.state === "failed" || result.state === "conflict" ? "partial" : "completed"); return current; },
    async read() { calls.read += 1; return current; },
    async list() { calls.list += 1; return { providerState: "fixture", mutationsEnabled: true, items: [], nextCursor: null }; },
    async readUnresolved() { calls.reconcile += 1; return [work]; },
    async beginUndo(_actor, _id, request: WeeklyCloneUndoRequest) { calls.beginUndo += 1; assert.equal(request.undoOperationId, undoOperationId); return { operation: current, items: [{ ...work, state: "undoing", providerRecordId: "provider:1" }] }; },
    async finishUndo(_actor, _work, result) { calls.finishUndo += 1; current = operation(result.state === "undone" ? "undone" : result.state === "undo_unknown" ? "undo_unknown" : "undo_refused"); return current; },
    async reconcileCreate() { calls.reconcile += 1; current = operation("completed"); return current; },
    async reconcileDelete() { calls.reconcile += 1; current = operation("undone"); return current; },
  };
  const provider: WeeklyCloneProvider = {
    state: options.providerState ?? "fixture",
    async create(input) { calls.create += 1; assert.equal(input.markerId, markerId); assert.equal(input.content.localDate, "2026-11-26"); return options.providerResult === "created" || !options.providerResult ? { state: "created", providerRecordId: "provider:1" } : { state: options.providerResult }; },
    async reconcileCreate(input) { calls.lookup += 1; assert.equal(input.markerId, markerId); return { state: "found", providerRecordId: "provider:1", contentHash: hash }; },
    async delete(input) { calls.remove += 1; assert.equal(input.providerRecordId, "provider:1"); return "deleted"; },
    async reconcileDelete(input) { calls.lookup += 1; assert.equal(input.providerRecordId, "provider:1"); return { state: "absent" }; },
  };
  const service = createWeeklyCloneService({
    resolvePrincipal: async (token) => token === "admin" ? principal("admin") : token === "member" ? principal("member") : null,
    repository, provider, mutationsEnabled: options.mutationsEnabled ?? true,
  });
  return { service, calls };
}

test("weekly preview validates Monday weeks and returns only the public plan summary", async () => {
  const { service, calls } = setup();
  const result = await service.preview({ accessToken: "admin", sourceWeekStart: "2026-11-16", targetWeekStart: "2026-11-23" });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.weekStartPolicy, "monday"); assert.equal(result.value.weekDelta, 1);
    assert.equal(result.value.items[0]?.targetLocalDate, "2026-11-26");
    assert.equal("content" in (result.value.items[0] ?? {}), false);
  }
  const sunday = await service.preview({ accessToken: "admin", sourceWeekStart: "2026-11-15", targetWeekStart: "2026-11-22" });
  const same = await service.preview({ accessToken: "admin", sourceWeekStart: "2026-11-16", targetWeekStart: "2026-11-16" });
  assert.equal(sunday.ok, false); assert.equal(same.ok, false); assert.equal(calls.preview, 1);
});

test("weekly supply operations require an authenticated admin", async () => {
  const { service, calls } = setup();
  const anon = await service.preview({ accessToken: null, sourceWeekStart: "2026-11-16", targetWeekStart: "2026-11-23" });
  const member = await service.preview({ accessToken: "member", sourceWeekStart: "2026-11-16", targetWeekStart: "2026-11-23" });
  assert.equal(anon.ok, false); assert.equal(member.ok, false); assert.equal(calls.preview, 0);
});

test("clone fails closed outside the local fixture provider", async () => {
  const { service, calls } = setup({ providerState: "disabled_unmapped", mutationsEnabled: false });
  const result = await service.clone({ accessToken: "admin", request: { operationId, sourceWeekStart: "2026-11-16", targetWeekStart: "2026-11-23", expectedPlanHash: hash } });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "provider_unavailable");
  assert.equal(calls.begin, 0); assert.equal(calls.create, 0);
});

test("clone calls the exact provider marker and returns an uncertain result without blind retry", async () => {
  const { service, calls } = setup({ providerResult: "outcome_unknown" });
  const result = await service.clone({ accessToken: "admin", request: { operationId, sourceWeekStart: "2026-11-16", targetWeekStart: "2026-11-23", expectedPlanHash: hash } });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.state, "outcome_unknown");
  assert.equal(calls.create, 1); assert.equal(calls.finish, 1); assert.equal(calls.claim, 1);
});

test("reconcile resolves by the exact marker; undo is a separate guarded operation", async () => {
  const { service, calls } = setup();
  const reconciled = await service.reconcile({ accessToken: "admin", operationId });
  assert.equal(reconciled.ok, true); assert.equal(calls.lookup, 1);
  const undone = await service.undo({ accessToken: "admin", operationId, request: { undoOperationId, expectedManifestRevision: 4 } });
  assert.equal(undone.ok, true); assert.equal(calls.beginUndo, 1); assert.equal(calls.remove, 1); assert.equal(calls.finishUndo, 1);
});
