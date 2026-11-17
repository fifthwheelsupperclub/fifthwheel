/** Browser-safe supply management DTOs. */

export type SupplyStopRole = "drinks" | "dinner" | "dessert";

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
export type SupplyDraftSource = Readonly<{ kind: "manual"; content: SupplyDraftContent }>;

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
  syncState: "current" | "stale" | "missing";
  canCreateDraft: boolean;
}>;

export type SupplyTableListDTO = Readonly<{
  canCreateDraft: boolean;
  items: readonly SupplyTableListItemDTO[];
  nextCursor: string | null;
}>;

export type SupplyVenueOptionDTO = Readonly<{
  venueId: string;
  name: string;
  address: string;
  neighborhood: string;
  /** Archived venues stay listed for admins but cannot be chosen for a stop. */
  active: boolean;
}>;

export type SupplyVenueListDTO = Readonly<{ items: readonly SupplyVenueOptionDTO[] }>;
export type SupplySaveVenueRequest = Readonly<{ name: string; address: string; neighborhood: string; active: boolean }>;

export type SupplyRevisionSummaryDTO = Readonly<{
  revisionId: string;
  revision: number;
  state: "draft" | "accepted" | "published";
  createdAt: string;
  updatedAt: string;
  content: SupplyDraftContent;
}>;

export type SupplyTableDetailDTO = Readonly<{
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
 * GET /api/supply/venues?query= -> SupplyManagementResponse<SupplyVenueListDTO>
 * PUT /api/supply/venues/:venueId {name,address,neighborhood,active} -> SupplyManagementResponse<SupplyVenueOptionDTO> (admin; creates or updates)
 * POST /api/supply/drafts {operationId,source} -> SupplyManagementResponse<SupplyCreateDraftResultDTO>
 * PUT /api/supply/drafts/:draftId {operationId,expectedDraftRevision,content} -> SupplyManagementResponse<SupplyRevisionSummaryDTO>
 * POST /api/supply/drafts/:draftId/preview {expectedDraftRevision} -> SupplyManagementResponse<SupplyDraftPreviewDTO>
 * POST /api/supply/drafts/:draftId/accept {operationId,expectedDraftRevision} -> SupplyManagementResponse<SupplyRevisionSummaryDTO>
 * POST /api/supply/drafts/:draftId/publish {operationId,expectedDraftRevision} -> SupplyManagementResponse<SupplyTableDetailDTO>
 *
 * Supabase is the source of truth for supply. Admins curate Venues and create/edit/accept/publish Tables. An assigned host may read/edit an assigned draft only;
 * authorization remains deny-by-default until the trusted assignment reader is configured.
 */
