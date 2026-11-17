import assert from "node:assert/strict";
import test from "node:test";
import type { WeeklyCloneOperationDTO } from "../supply.weekly-clone.contract.ts";
import type { ServerVerifiedPrincipal } from "./authorization.server.ts";
import type { WeeklyClonePlan, WeeklyCloneRepository } from "./supply.weekly-clone.contract.server.ts";
import { WeeklyCloneRepositoryError } from "./supply.weekly-clone.repository.server.ts";
import { createWeeklyCloneService } from "./supply.weekly-clone.service.server.ts";

const adminId = "59d4e311-1a24-45b8-b361-93527521d001";
const memberId = "59d4e311-1a24-45b8-b361-93527521d002";
const tableId = "59d4e311-1a24-45b8-b361-93527521d003";
const targetId = "59d4e311-1a24-45b8-b361-93527521d005";
const operationId = "59d4e311-1a24-45b8-b361-93527521d008";
const plan: WeeklyClonePlan = {
  weekDelta: 1, items: [{ sourceTableId: tableId, title: "Synthetic Thursday Table", sourceLocalDate: "2026-11-19",
    targetLocalDate: "2026-11-26", eligibility: "eligible", conflictCode: null }],
};

function principal(role: "admin" | "member"): ServerVerifiedPrincipal {
  return { userId: role === "admin" ? adminId : memberId, emailNormalized: `${role}@example.test`, emailVerified: true,
    staffRoles: new Set(role === "admin" ? ["admin"] : []),
    admission: { state: role === "member" ? "activated" : "none", authUserId: role === "member" ? memberId : null, emailNormalized: role === "member" ? "member@example.test" : null },
    assignedTableIds: new Set(), assignedVenueIds: new Set() };
}

function operation(state: WeeklyCloneOperationDTO["state"] = "completed"): WeeklyCloneOperationDTO {
  return { operationId, state, sourceWeekStart: "2026-11-16", targetWeekStart: "2026-11-23", startedAt: "2026-11-12T12:00:00Z",
    updatedAt: "2026-11-12T12:01:00Z", undoState: state === "undone" ? "undone" : "available", draftCount: 1,
    items: [{ sourceTableId: tableId, targetTableId: targetId, title: "Synthetic Thursday Table", targetLocalDate: "2026-11-26", state: state === "undone" ? "undone" : "created" }] };
}

function setup(overrides: Partial<WeeklyCloneRepository> = {}) {
  const calls = { preview: 0, clone: 0, undo: 0 };
  const repository: WeeklyCloneRepository = {
    async preview() { calls.preview += 1; return plan; },
    async clone(actor, request) { calls.clone += 1; assert.equal(actor, adminId); assert.equal(request.operationId, operationId); return operation(); },
    async read() { return operation(); },
    async list() { return { items: [], nextCursor: null }; },
    async undo() { calls.undo += 1; return operation("undone"); },
    ...overrides,
  };
  const service = createWeeklyCloneService({
    resolvePrincipal: async (token) => token === "admin" ? principal("admin") : token === "member" ? principal("member") : null,
    repository,
  });
  return { service, calls };
}

const cloneRequest = { operationId, sourceWeekStart: "2026-11-16", targetWeekStart: "2026-11-23" };

test("weekly preview validates Monday weeks and counts eligible drafts", async () => {
  const { service, calls } = setup();
  const result = await service.preview({ accessToken: "admin", sourceWeekStart: "2026-11-16", targetWeekStart: "2026-11-23" });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.weekStartPolicy, "monday"); assert.equal(result.value.weekDelta, 1);
    assert.equal(result.value.items[0]?.targetLocalDate, "2026-11-26"); assert.equal(result.value.eligibleCount, 1);
  }
  const sunday = await service.preview({ accessToken: "admin", sourceWeekStart: "2026-11-15", targetWeekStart: "2026-11-22" });
  const same = await service.preview({ accessToken: "admin", sourceWeekStart: "2026-11-16", targetWeekStart: "2026-11-16" });
  assert.equal(sunday.ok, false); assert.equal(same.ok, false); assert.equal(calls.preview, 1);
});

test("weekly supply operations require an authenticated admin", async () => {
  const { service, calls } = setup();
  const anon = await service.clone({ accessToken: null, request: cloneRequest });
  const member = await service.clone({ accessToken: "member", request: cloneRequest });
  const memberUndo = await service.undo({ accessToken: "member", operationId });
  assert.equal(anon.ok, false); assert.equal(member.ok, false); assert.equal(memberUndo.ok, false);
  if (!anon.ok) assert.equal(anon.error.code, "unauthenticated");
  if (!member.ok) assert.equal(member.error.code, "forbidden");
  assert.equal(calls.clone, 0); assert.equal(calls.undo, 0);
});

test("clone writes through the single transactional repository call with no provider gate", async () => {
  const { service, calls } = setup();
  const result = await service.clone({ accessToken: "admin", request: cloneRequest });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.state, "completed");
  assert.equal(calls.clone, 1);
  const bad = await service.clone({ accessToken: "admin", request: { ...cloneRequest, operationId: "nope" } });
  assert.equal(bad.ok, false); assert.equal(calls.clone, 1);
});

test("clone and undo map database refusals to safe errors", async () => {
  const empty = setup({ async clone() { throw new WeeklyCloneRepositoryError("no_eligible_sources"); } });
  const none = await empty.service.clone({ accessToken: "admin", request: cloneRequest });
  assert.equal(none.ok ? null : none.error.code, "invalid_input");
  const refused = setup({ async undo() { throw new WeeklyCloneRepositoryError("undo_refused"); } });
  const blocked = await refused.service.undo({ accessToken: "admin", operationId });
  assert.equal(blocked.ok ? null : blocked.error.code, "revision_conflict");
  const ok = await setup().service.undo({ accessToken: "admin", operationId });
  assert.equal(ok.ok && ok.value.undoState, "undone");
});
