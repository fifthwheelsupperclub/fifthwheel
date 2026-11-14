/** Browser-safe W05.2 supply management DTOs. Never expose source record IDs or provider payloads. */

import type { SupplyStopRole } from "./supply.contract.ts";

export type SupplyDraftContent = Readonly<{
  title: string;
  localDate: string;
  startLocalTime: string;
  neighborhood: string;
  /** Private operational guidance for assigned hosts; never serialize through guest Table DTOs. */
  hostNotes: string;
  stops: readonly [
    Readonly<{ role: "drinks"; venueId: string; venueName: string; venueAddress: string; minutesFromStart: number; publicNotes: string }> ,
    Readonly<{ role: "dinner"; venueId: string; venueName: string; venueAddress: string; minutesFromStart: number; publicNotes: string }> ,
    Readonly<{ role: "dessert"; venueId: string; venueName: string; venueAddress: string; minutesFromStart: number; publicNotes: string }> ,
  ];
}>;

export type SupplyTableLifecycle = "draft" | "accepted" | "published" | "review_required" | "upstream_missing";
export type SupplyDraftSource =
  | Readonly<{ kind: "candidate"; revisionId: string; tableId: string }>
  | Readonly<{ kind: "manual"; content: SupplyDraftContent }>;

export type SupplyTableListItemDTO = Readonly<{
  tableId: string;
  title: string;
  localDate: string;
  startLocalTime: string;
  startsAt: string | null;
  neighborhood: string;
  lifecycle: SupplyTableLifecycle;
  draftRevision: number | null;
  acceptedRevisionId: string | null;
  publishedRevisionId: string | null;
  updatedAt: string;
  sourceRevisionId: string | null;
  syncState: "current" | "stale" | "missing";
  canCreateDraft: boolean;
}>;

export type SupplyStagedCandidateDTO = Readonly<{
  tableId: string;
  sourceRevisionId: string;
  title: string;
  localDate: string;
  startLocalTime: string;
  neighborhood: string;
  canCreateDraft: boolean;
}>;

export type SupplyTableListDTO = Readonly<{
  providerState: "fixture" | "disabled_unmapped" | "ready" | "unavailable";
  mutationsEnabled: boolean;
  canCreateDraft: boolean;
  items: readonly SupplyTableListItemDTO[];
  stagedCandidates: readonly SupplyStagedCandidateDTO[];
  nextCursor: string | null;
}>;

export type SupplyVenueOptionDTO = Readonly<{
  venueId: string;
  name: string;
  address: string;
  neighborhood: string;
}>;

export type SupplyVenueListDTO = Readonly<{
  providerState: "fixture" | "disabled_unmapped" | "ready" | "unavailable";
  items: readonly SupplyVenueOptionDTO[];
}>;

export type SupplyRevisionSummaryDTO = Readonly<{
  revisionId: string;
  revision: number;
  state: "draft" | "accepted" | "published";
  createdAt: string;
  updatedAt: string;
  content: SupplyDraftContent;
}>;

export type SupplyTableDetailDTO = Readonly<{
  providerState: "fixture" | "disabled_unmapped" | "ready" | "unavailable";
  mutationsEnabled: boolean;
  tableId: string;
  lifecycle: SupplyTableLifecycle;
  draft: SupplyRevisionSummaryDTO | null;
  accepted: SupplyRevisionSummaryDTO | null;
  published: SupplyRevisionSummaryDTO | null;
  syncState: "current" | "stale" | "missing";
  currentSyncState: "current" | "stale" | "missing";
  canEditDraft: boolean;
  canAccept: boolean;
  canPublish: boolean;
}>;

export type SupplyValidationIssue = Readonly<{
  field: "title" | "schedule" | "neighborhood" | "stops" | "venue";
  code: "required" | "invalid_date" | "invalid_time" | "nonexistent_local_time" | "ambiguous_local_time" | "invalid_stop_set" | "missing_venue" | "stale_revision" | "protected_change";
  stopRole?: SupplyStopRole;
  message: string;
}>;

export type SupplyDraftPreviewDTO = Readonly<{
  tableId: string;
  draftRevision: number;
  valid: boolean;
  startsAt: string | null;
  changes: readonly Readonly<{ field: string; before: string | null; after: string | null }>[];
  issues: readonly SupplyValidationIssue[];
  canAccept: boolean;
  canPublish: boolean;
  providerState: "fixture" | "disabled_unmapped" | "ready" | "unavailable";
}>;

export type SupplyCreateDraftRequest = Readonly<{ operationId: string; source: SupplyDraftSource }>;
export type SupplyCreateDraftResultDTO = Readonly<{ tableId: string; draft: SupplyRevisionSummaryDTO }>;
export type SupplyUpdateDraftRequest = Readonly<{ operationId: string; expectedDraftRevision: number; content: SupplyDraftContent }>;
export type SupplyPreviewDraftRequest = Readonly<{ expectedDraftRevision: number }>;
export type SupplyRevisionActionRequest = Readonly<{ operationId: string; expectedDraftRevision: number }>;

export type SupplyManagementErrorCode =
  | "unauthenticated" | "forbidden" | "invalid_input" | "not_found"
  | "validation_failed" | "revision_conflict" | "operation_conflict" | "protected_change"
  | "provider_unavailable" | "temporarily_unavailable";

export type SupplyManagementError = Readonly<{
  code: SupplyManagementErrorCode;
  message: string;
  retryable: boolean;
  correlationId: string;
  fields?: Readonly<Record<string, string>>;
}>;

export type SupplyManagementResponse<T> =
  | Readonly<{ ok: true; data: T; correlationId: string }>
  | Readonly<{ ok: false; error: SupplyManagementError }>;

/**
 * W05.2 routes and contracts:
 * GET /api/supply/tables?state=&cursor=&limit= -> SupplyManagementResponse<SupplyTableListDTO>
 * GET /api/supply/tables/:tableId -> SupplyManagementResponse<SupplyTableDetailDTO>
 * GET /api/supply/venues?query=&cursor= -> SupplyManagementResponse<SupplyVenueListDTO>
 * POST /api/supply/drafts {operationId,source} -> SupplyManagementResponse<SupplyCreateDraftResultDTO>
 * PUT /api/supply/drafts/:draftId {operationId,expectedDraftRevision,content} -> SupplyManagementResponse<SupplyRevisionSummaryDTO>
 * POST /api/supply/drafts/:draftId/preview {expectedDraftRevision} -> SupplyManagementResponse<SupplyDraftPreviewDTO>
 * POST /api/supply/drafts/:draftId/accept {operationId,expectedDraftRevision} -> SupplyManagementResponse<SupplyRevisionSummaryDTO>
 * POST /api/supply/drafts/:draftId/publish {operationId,expectedDraftRevision} -> SupplyManagementResponse<SupplyTableDetailDTO>
 *
 * All mutations are restricted to explicit local fixture mode until Airtable mappings are verified.
 * Admins may create/edit/accept/publish. An assigned host may read/edit an assigned draft only;
 * authorization remains deny-by-default until the trusted assignment reader is configured.
 */
