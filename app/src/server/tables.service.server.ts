/** A member's own Table placements and their invitations (staff create placements; members never request Seats). */

import { authorize } from "./authorization.server.ts";
import type { TableRequestHistoryInput, TablesServiceDependencies, TableServiceFailure, TableServiceResult, TablesService } from "./tables.contract.server.ts";
import type { TableRequestHistoryDTO } from "../tables.contract.ts";
import { TablesRepositoryError } from "./tables.repository.server.ts";

const cursorRequestPattern = /^\d{4}-\d{2}-\d{2}T[^|]{1,40}\|[0-9a-f-]{36}$/i;

function failure<T>(code: TableServiceFailure["code"], safeMessage: string): TableServiceResult<T> {
  return { ok: false, error: { code, safeMessage } };
}

function mapRepositoryError(error: unknown): TableServiceFailure {
  if (error instanceof TablesRepositoryError) {
    switch (error.code) {
      case "not_found": return { code: "not_found", safeMessage: "This Table is no longer available." };
      case "invalid_input": return { code: "invalid_input", safeMessage: "Check the filters and try again." };
      case "operation_conflict": return { code: "operation_conflict", safeMessage: "Refresh this page before trying that action again." };
      case "forbidden": return { code: "forbidden", safeMessage: "Your app access is not active for this action." };
      case "configuration_invalid":
      case "request_failed":
      case "response_invalid": return { code: "temporarily_unavailable", safeMessage: "Tables are temporarily unavailable. Try again shortly." };
    }
  }
  return { code: "temporarily_unavailable", safeMessage: "Tables are temporarily unavailable. Try again shortly." };
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
  });
}
