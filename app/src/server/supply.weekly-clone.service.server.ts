/** W05.3 server use cases: preview, transactional clone, history, and guarded undo. */

import type { WeeklyClonePreviewDTO } from "../supply.weekly-clone.contract.ts";
import { authorize } from "./authorization.server.ts";
import type {
  WeeklyCloneFailureCode, WeeklyCloneResult, WeeklyCloneOperationInput, WeeklyClonePreviewInput, WeeklyCloneStartInput,
  WeeklyCloneService, WeeklyCloneServiceDependencies,
} from "./supply.weekly-clone.contract.server.ts";
import { WeeklyCloneRepositoryError } from "./supply.weekly-clone.repository.server.ts";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function failure<T = never>(code: WeeklyCloneFailureCode, safeMessage: string): WeeklyCloneResult<T> {
  return { ok: false, error: { code, safeMessage } };
}

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(0);
  date.setUTCFullYear(year!, month! - 1, day!);
  date.setUTCHours(0, 0, 0, 0);
  return date.toISOString().slice(0, 10) === value;
}

function isMonday(value: string): boolean { return new Date(`${value}T00:00:00Z`).getUTCDay() === 1; }

function validWeeks(sourceWeekStart: unknown, targetWeekStart: unknown): sourceWeekStart is string {
  return validDate(sourceWeekStart) && validDate(targetWeekStart) && isMonday(sourceWeekStart) && isMonday(targetWeekStart) && sourceWeekStart !== targetWeekStart;
}

function mapRepoError(error: unknown): WeeklyCloneResult<never> {
  if (error instanceof WeeklyCloneRepositoryError) {
    if (error.code === "forbidden") return failure("forbidden", "You are not allowed to manage weekly supply clones.");
    if (error.code === "not_found") return failure("not_found", "The weekly clone operation could not be found.");
    if (error.code === "operation_conflict") return failure("operation_conflict", "That operation identifier is already bound to a different request.");
    if (error.code === "undo_refused") return failure("revision_conflict", "A copied draft was edited or used, so this copy can no longer be undone.");
    if (error.code === "no_eligible_sources") return failure("invalid_input", "There are no eligible drafts in that week. Preview again.");
    if (error.code === "invalid_input") return failure("invalid_input", "Choose different Monday week starts using Atlanta local dates.");
  }
  return failure("temporarily_unavailable", "Weekly supply is temporarily unavailable. Try again shortly.");
}

export function createWeeklyCloneService(dependencies: WeeklyCloneServiceDependencies): WeeklyCloneService {
  async function admin(accessToken: string | null | undefined): Promise<WeeklyCloneResult<string>> {
    let principal;
    try { principal = await dependencies.resolvePrincipal(accessToken); }
    catch { return failure("temporarily_unavailable", "Your access could not be verified. Try again shortly."); }
    const decision = authorize(principal, { workspace: "admin", action: "supply:clone" });
    if (decision.allowed) return { ok: true, value: decision.principal.userId };
    if (decision.reason === "unauthenticated" || decision.reason === "email-unverified") return failure("unauthenticated", "Sign in with a verified staff account.");
    return failure("forbidden", "You are not allowed to manage weekly supply clones.");
  }

  return Object.freeze({
    async preview(input: WeeklyClonePreviewInput): Promise<WeeklyCloneResult<WeeklyClonePreviewDTO>> {
      const actor = await admin(input.accessToken);
      if (!actor.ok) return actor;
      if (!validWeeks(input.sourceWeekStart, input.targetWeekStart)) return failure("invalid_input", "Choose different Monday week starts using Atlanta local dates.");
      try {
        const plan = await dependencies.repository.preview(actor.value, input);
        const eligibleCount = plan.items.filter((item) => item.eligibility === "eligible").length;
        return { ok: true, value: Object.freeze({ weekStartPolicy: "monday", sourceWeekStart: input.sourceWeekStart, targetWeekStart: input.targetWeekStart,
          weekDelta: plan.weekDelta, items: plan.items, eligibleCount, conflictCount: plan.items.length - eligibleCount }) };
      } catch (error) { return mapRepoError(error); }
    },

    async clone(input: WeeklyCloneStartInput) {
      const actor = await admin(input.accessToken);
      if (!actor.ok) return actor;
      const request = input.request;
      if (!uuidPattern.test(request.operationId) || !validWeeks(request.sourceWeekStart, request.targetWeekStart)) {
        return failure("invalid_input", "Check the operation identifier and Monday week starts.");
      }
      try { return { ok: true as const, value: await dependencies.repository.clone(actor.value, request) }; }
      catch (error) { return mapRepoError(error); }
    },

    async readOperation(input: WeeklyCloneOperationInput) {
      const actor = await admin(input.accessToken);
      if (!actor.ok) return actor;
      if (!uuidPattern.test(input.operationId)) return failure("invalid_input", "Use a valid operation identifier.");
      try {
        const operation = await dependencies.repository.read(actor.value, input.operationId);
        return operation ? { ok: true as const, value: operation } : failure("not_found", "The weekly clone operation could not be found.");
      } catch (error) { return mapRepoError(error); }
    },

    async listOperations(input: Readonly<{ accessToken?: string | null; cursor?: string | null; limit: number }>) {
      const actor = await admin(input.accessToken);
      if (!actor.ok) return actor;
      if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 50
        || (input.cursor != null && (input.cursor.length > 120 || !/^[0-9TZ:.-]+\|[0-9a-f-]{36}$/i.test(input.cursor)))) {
        return failure("invalid_input", "Check the operation history page request.");
      }
      try { return { ok: true as const, value: await dependencies.repository.list(actor.value, input.cursor ?? null, input.limit) }; }
      catch (error) { return mapRepoError(error); }
    },

    async undo(input: WeeklyCloneOperationInput) {
      const actor = await admin(input.accessToken);
      if (!actor.ok) return actor;
      if (!uuidPattern.test(input.operationId)) return failure("invalid_input", "Use a valid operation identifier.");
      try { return { ok: true as const, value: await dependencies.repository.undo(actor.value, input.operationId) }; }
      catch (error) { return mapRepoError(error); }
    },
  });
}
