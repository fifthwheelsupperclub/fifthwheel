import type { TableRequestHistoryDTO, TableRequestResponse } from "../tables.contract.ts";

export type TableServiceFailure = Readonly<{ code: Exclude<TableRequestResponse<never>, { ok: true }>['error']['code']; safeMessage: string }>;
export type TableServiceResult<T> = Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; error: TableServiceFailure }>;
export type TableRequestHistoryInput = Readonly<{ accessToken?: string | null; cursor?: string; limit: number }>;

export interface TablesRepository {
  listMemberRequests(actorUserId: string, input: Omit<TableRequestHistoryInput, "accessToken">): Promise<TableRequestHistoryDTO>;
}

export type TablesServiceDependencies = Readonly<{
  resolvePrincipal: (accessToken: string | null | undefined) => Promise<import("./authorization.server.ts").ServerVerifiedPrincipal | null>;
  repository: TablesRepository;
}>;

export interface TablesService {
  listRequests(input: TableRequestHistoryInput): Promise<TableServiceResult<TableRequestHistoryDTO>>;
}
