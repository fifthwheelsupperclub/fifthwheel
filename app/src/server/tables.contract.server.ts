import type {
  MinimalTablePreviewDTO, OwnTableRequestDTO, TableDetailResponseDTO, TableListDTO,
  TableRequestHistoryDTO, TableRequestMutation, TableRequestResponse,
} from "../tables.contract.ts";

export type TableServiceFailure = Readonly<{ code: Exclude<TableRequestResponse<never>, { ok: true }>['error']['code']; safeMessage: string }>;
export type TableServiceResult<T> = Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; error: TableServiceFailure }>;
export type TableListInput = Readonly<{
  accessToken?: string | null;
  dateFrom?: string;
  dateTo?: string;
  neighborhood?: string;
  cursor?: string;
  limit: number;
}>;
export type TableDetailInput = Readonly<{ accessToken?: string | null; tableId: string }>;
export type CreateTableRequestInput = Readonly<{ accessToken?: string | null; tableId: string; request: TableRequestMutation }>;
export type TableRequestHistoryInput = Readonly<{ accessToken?: string | null; cursor?: string; limit: number }>;
export type WithdrawTableRequestInput = Readonly<{ accessToken?: string | null; requestId: string; request: TableRequestMutation }>;

export interface TablesRepository {
  listPublishedTables(actorUserId: string, input: Omit<TableListInput, "accessToken">): Promise<TableListDTO>;
  readPublishedPreview(tableId: string): Promise<MinimalTablePreviewDTO | null>;
  readPublishedTable(actorUserId: string, tableId: string): Promise<TableDetailResponseDTO>;
  createRequest(actorUserId: string, tableId: string, operationId: string): Promise<OwnTableRequestDTO>;
  listMemberRequests(actorUserId: string, input: Omit<TableRequestHistoryInput, "accessToken">): Promise<TableRequestHistoryDTO>;
  withdrawRequest(actorUserId: string, requestId: string, operationId: string): Promise<OwnTableRequestDTO>;
}

export type TablesServiceDependencies = Readonly<{
  resolvePrincipal: (accessToken: string | null | undefined) => Promise<import("./authorization.server.ts").ServerVerifiedPrincipal | null>;
  repository: TablesRepository;
}>;

export interface TablesService {
  listTables(input: TableListInput): Promise<TableServiceResult<TableListDTO>>;
  readTable(input: TableDetailInput): Promise<TableServiceResult<TableDetailResponseDTO>>;
  createRequest(input: CreateTableRequestInput): Promise<TableServiceResult<OwnTableRequestDTO>>;
  listRequests(input: TableRequestHistoryInput): Promise<TableServiceResult<TableRequestHistoryDTO>>;
  withdrawRequest(input: WithdrawTableRequestInput): Promise<TableServiceResult<OwnTableRequestDTO>>;
}
