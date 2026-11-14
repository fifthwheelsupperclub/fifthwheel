/** Server-only W05.2 use-case and repository boundaries. */

import type {
  SupplyCreateDraftRequest, SupplyCreateDraftResultDTO, SupplyDraftContent, SupplyDraftPreviewDTO,
  SupplyManagementErrorCode, SupplyRevisionActionRequest, SupplyRevisionSummaryDTO,
  SupplyTableDetailDTO, SupplyTableListDTO, SupplyUpdateDraftRequest, SupplyVenueListDTO,
} from "../supply.management.contract.ts";

export type SupplyManagementFailure = Readonly<{
  code: SupplyManagementErrorCode;
  safeMessage: string;
  fields?: Readonly<Record<string, string>>;
}>;
export type SupplyManagementResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; error: SupplyManagementFailure }>;

export type SupplyListInput = Readonly<{ accessToken?: string | null; state?: string; cursor?: string; limit: number }>;
export type SupplyDetailInput = Readonly<{ accessToken?: string | null; tableId: string }>;
export type SupplyVenueListInput = Readonly<{ accessToken?: string | null; query?: string }>;
export type SupplyCreateInput = Readonly<{ accessToken?: string | null; request: SupplyCreateDraftRequest }>;
export type SupplyUpdateInput = Readonly<{ accessToken?: string | null; draftId: string; request: SupplyUpdateDraftRequest }>;
export type SupplyPreviewInput = Readonly<{ accessToken?: string | null; draftId: string; expectedDraftRevision: number }>;
export type SupplyRevisionActionInput = Readonly<{ accessToken?: string | null; draftId: string; request: SupplyRevisionActionRequest }>;

export type SupplyStoredTableDetail = Readonly<{
  detail: SupplyTableDetailDTO;
  draftContent: SupplyDraftContent | null;
}>;

export interface SupplyManagementRepository {
  listTables(actorUserId: string, assignedTableIds: readonly string[], input: Omit<SupplyListInput, "accessToken">): Promise<SupplyTableListDTO>;
  readTable(actorUserId: string, tableId: string): Promise<SupplyStoredTableDetail | null>;
  listVenues(actorUserId: string, assignedTableIds: readonly string[], query?: string): Promise<SupplyVenueListDTO>;
  readDraftTableId(actorUserId: string, draftId: string): Promise<string | null>;
  createDraft(actorUserId: string, request: SupplyCreateDraftRequest): Promise<SupplyCreateDraftResultDTO>;
  updateDraft(actorUserId: string, draftId: string, request: SupplyUpdateDraftRequest): Promise<SupplyRevisionSummaryDTO>;
  previewDraft(actorUserId: string, draftId: string, expectedDraftRevision: number): Promise<SupplyStoredTableDetail | null>;
  acceptDraft(actorUserId: string, draftId: string, request: SupplyRevisionActionRequest): Promise<SupplyRevisionSummaryDTO>;
  publishDraft(actorUserId: string, draftId: string, request: SupplyRevisionActionRequest): Promise<SupplyTableDetailDTO>;
}

export type SupplyManagementServiceDependencies = Readonly<{
  resolvePrincipal: (accessToken: string | null | undefined) => Promise<import("./authorization.server.ts").ServerVerifiedPrincipal | null>;
  repository: SupplyManagementRepository;
  providerState: "fixture" | "disabled_unmapped" | "ready" | "unavailable";
  mutationsEnabled: boolean;
}>;

export interface SupplyManagementService {
  listTables(input: SupplyListInput): Promise<SupplyManagementResult<SupplyTableListDTO>>;
  readTable(input: SupplyDetailInput): Promise<SupplyManagementResult<SupplyTableDetailDTO>>;
  listVenues(input: SupplyVenueListInput): Promise<SupplyManagementResult<SupplyVenueListDTO>>;
  createDraft(input: SupplyCreateInput): Promise<SupplyManagementResult<SupplyCreateDraftResultDTO>>;
  updateDraft(input: SupplyUpdateInput): Promise<SupplyManagementResult<SupplyRevisionSummaryDTO>>;
  previewDraft(input: SupplyPreviewInput): Promise<SupplyManagementResult<SupplyDraftPreviewDTO>>;
  acceptDraft(input: SupplyRevisionActionInput): Promise<SupplyManagementResult<SupplyRevisionSummaryDTO>>;
  publishDraft(input: SupplyRevisionActionInput): Promise<SupplyManagementResult<SupplyTableDetailDTO>>;
}

export type { SupplyDraftContent };
