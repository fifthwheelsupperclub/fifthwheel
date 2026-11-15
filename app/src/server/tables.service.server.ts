/** W06 published-supply and Seat-request use cases. Requests never reserve or sell Seats. */

import { authorize } from "./authorization.server.ts";
import type {
  CreateTableRequestInput, TableDetailInput, TableListInput, TableRequestHistoryInput,
  TablesServiceDependencies, TableServiceFailure, TableServiceResult, TablesService, WithdrawTableRequestInput,
} from "./tables.contract.server.ts";
import type { OwnTableRequestDTO, TableDetailResponseDTO, TableListDTO, TableRequestHistoryDTO } from "../tables.contract.ts";
import { TablesRepositoryError } from "./tables.repository.server.ts";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const cursorTablePattern = /^\d{4}-\d{2}-\d{2}\|(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d\|[0-9a-f-]{36}$/i;
const cursorRequestPattern = /^\d{4}-\d{2}-\d{2}T[^|]{1,40}\|[0-9a-f-]{36}$/i;

function failure<T>(code: TableServiceFailure["code"], safeMessage: string): TableServiceResult<T> {
  return { ok: false, error: { code, safeMessage } };
}

function mapRepositoryError(error: unknown): TableServiceFailure {
  if (error instanceof TablesRepositoryError) {
    switch (error.code) {
      case "profile_incomplete": return { code: "profile_incomplete", safeMessage: "Finish your profile review first." };
      case "not_found": return { code: "not_found", safeMessage: "This Table is no longer available." };
      case "not_future": return { code: "not_future", safeMessage: "This Table is no longer available for requests." };
      case "invalid_input": return { code: "invalid_input", safeMessage: "Check the filters and try again." };
      case "invalid_transition": return { code: "invalid_transition", safeMessage: "This request can no longer be withdrawn." };
      case "operation_conflict": return { code: "operation_conflict", safeMessage: "Refresh this page before trying that action again." };
      case "forbidden": return { code: "forbidden", safeMessage: "Your app access is not active for this action." };
      case "configuration_invalid":
      case "request_failed":
      case "response_invalid": return { code: "temporarily_unavailable", safeMessage: "Tables are temporarily unavailable. Try again shortly." };
    }
  }
  return { code: "temporarily_unavailable", safeMessage: "Tables are temporarily unavailable. Try again shortly." };
}

function validCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year!, month! - 1, day!);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month! - 1 && date.getUTCDate() === day;
}

function validList(input: TableListInput): boolean {
  if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 50) return false;
  if (input.dateFrom && !validCalendarDate(input.dateFrom) || input.dateTo && !validCalendarDate(input.dateTo)) return false;
  if (input.dateFrom && input.dateTo && input.dateFrom > input.dateTo) return false;
  if (input.neighborhood && (input.neighborhood.trim().length < 1 || input.neighborhood.length > 120 || /[\u0000-\u001f\u007f]/.test(input.neighborhood))) return false;
  return input.cursor === undefined || input.cursor.length <= 150 && cursorTablePattern.test(input.cursor);
}

function validHistory(input: TableRequestHistoryInput): boolean {
  return Number.isSafeInteger(input.limit) && input.limit >= 1 && input.limit <= 50
    && (input.cursor === undefined || input.cursor.length <= 150 && cursorRequestPattern.test(input.cursor));
}

function validAccess(principal: Awaited<ReturnType<TablesServiceDependencies["resolvePrincipal"]>>) {
  return authorize(principal, { workspace: "member", action: "member:read-own" });
}

export function createTablesService(dependencies: TablesServiceDependencies): TablesService {
  async function resolve(token: string | null | undefined) {
    return dependencies.resolvePrincipal(token);
  }
  return Object.freeze({
    async listTables(input: TableListInput): Promise<TableServiceResult<TableListDTO>> {
      if (!validList(input)) return failure("invalid_input", "Check the date, neighborhood and page filters.");
      let principal;
      try { principal = await resolve(input.accessToken); } catch { return failure("temporarily_unavailable", "Tables are temporarily unavailable. Try again shortly."); }
      const decision = validAccess(principal);
      if (!decision.allowed) {
        const code = decision.reason === "unauthenticated" || decision.reason === "email-unverified" ? "unauthenticated" : "forbidden";
        return failure(code, code === "unauthenticated" ? "Sign in to browse Tables." : "App member access is required to browse Tables.");
      }
      try {
        const value = await dependencies.repository.listPublishedTables(decision.principal.userId, {
          dateFrom: input.dateFrom, dateTo: input.dateTo, neighborhood: input.neighborhood?.trim(), cursor: input.cursor, limit: input.limit,
        });
        return { ok: true as const, value };
      } catch (error) { return { ok: false as const, error: mapRepositoryError(error) }; }
    },
    async readTable(input: TableDetailInput): Promise<TableServiceResult<TableDetailResponseDTO>> {
      if (!uuidPattern.test(input.tableId)) return failure("invalid_input", "Use a valid Table link.");
      let principal;
      try { principal = await resolve(input.accessToken); } catch { return failure("temporarily_unavailable", "This Table is temporarily unavailable."); }
      if (!principal || !validAccess(principal).allowed) {
        try {
          const preview = await dependencies.repository.readPublishedPreview(input.tableId);
          return preview ? { ok: true as const, value: { view: "preview" as const, table: preview } }
            : failure("not_found", "This Table is no longer available.");
        } catch (error) { return { ok: false as const, error: mapRepositoryError(error) }; }
      }
      try { return { ok: true as const, value: await dependencies.repository.readPublishedTable(principal.userId, input.tableId) }; }
      catch (error) { return { ok: false as const, error: mapRepositoryError(error) }; }
    },
    async createRequest(input: CreateTableRequestInput): Promise<TableServiceResult<OwnTableRequestDTO>> {
      if (!uuidPattern.test(input.tableId) || !uuidPattern.test(input.request.operationId)) return failure("invalid_input", "Refresh the Table and try again.");
      let principal;
      try { principal = await resolve(input.accessToken); } catch { return failure("temporarily_unavailable", "Your request could not be verified. Try again shortly."); }
      const decision = validAccess(principal);
      if (!decision.allowed) {
        const code = decision.reason === "unauthenticated" || decision.reason === "email-unverified" ? "unauthenticated" : "forbidden";
        return failure(code, code === "unauthenticated" ? "Sign in to request a Seat." : "App member access is required to request a Seat.");
      }
      try { return { ok: true as const, value: await dependencies.repository.createRequest(decision.principal.userId, input.tableId, input.request.operationId) }; }
      catch (error) { return { ok: false as const, error: mapRepositoryError(error) }; }
    },
    async listRequests(input: TableRequestHistoryInput): Promise<TableServiceResult<TableRequestHistoryDTO>> {
      if (!validHistory(input)) return failure("invalid_input", "Something went wrong. Reload and try again.");
      let principal;
      try { principal = await resolve(input.accessToken); } catch { return failure("temporarily_unavailable", "Your requests are temporarily unavailable."); }
      const decision = validAccess(principal);
      if (!decision.allowed) {
        const code = decision.reason === "unauthenticated" || decision.reason === "email-unverified" ? "unauthenticated" : "forbidden";
        return failure(code, code === "unauthenticated" ? "Sign in to view your requests." : "You don’t have access yet.");
      }
      try { return { ok: true as const, value: await dependencies.repository.listMemberRequests(decision.principal.userId, { cursor: input.cursor, limit: input.limit }) }; }
      catch (error) { return { ok: false as const, error: mapRepositoryError(error) }; }
    },
    async withdrawRequest(input: WithdrawTableRequestInput): Promise<TableServiceResult<OwnTableRequestDTO>> {
      if (!uuidPattern.test(input.requestId) || !uuidPattern.test(input.request.operationId)) return failure("invalid_input", "Refresh this request and try again.");
      let principal;
      try { principal = await resolve(input.accessToken); } catch { return failure("temporarily_unavailable", "This request could not be verified. Try again shortly."); }
      const decision = validAccess(principal);
      if (!decision.allowed) {
        const code = decision.reason === "unauthenticated" || decision.reason === "email-unverified" ? "unauthenticated" : "forbidden";
        return failure(code, code === "unauthenticated" ? "Sign in to withdraw this request." : "You don’t have access yet.");
      }
      try { return { ok: true as const, value: await dependencies.repository.withdrawRequest(decision.principal.userId, input.requestId, input.request.operationId) }; }
      catch (error) { return { ok: false as const, error: mapRepositoryError(error) }; }
    },
  });
}
