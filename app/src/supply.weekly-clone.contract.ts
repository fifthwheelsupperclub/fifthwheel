/** Browser-safe W05.3 DTOs. Provider source IDs, marker values and raw responses stay server-only. */

export type WeeklyCloneProviderState = "fixture" | "disabled_unmapped" | "ready" | "unavailable";
export type WeeklyCloneWeekStartPolicy = "monday";

export type WeeklyCloneEligibility = "eligible" | "conflict";
export type WeeklyCloneConflictCode =
  | "source_not_draft"
  | "source_missing"
  | "source_changed"
  | "source_week_mismatch"
  | "target_invalid"
  | "provider_unavailable"
  | "protected_change";

export type WeeklyClonePreviewItemDTO = Readonly<{
  sourceTableId: string;
  sourceRevisionId: string;
  sourceRevision: number;
  sourceHash: string;
  title: string;
  sourceLocalDate: string;
  targetLocalDate: string;
  eligibility: WeeklyCloneEligibility;
  conflictCode: WeeklyCloneConflictCode | null;
}>;

/** Read-only plan; planHash binds both date ranges and every ordered source revision/hash. */
export type WeeklyClonePreviewDTO = Readonly<{
  providerState: WeeklyCloneProviderState;
  mutationsEnabled: boolean;
  weekStartPolicy: WeeklyCloneWeekStartPolicy;
  sourceWeekStart: string;
  targetWeekStart: string;
  /** Whole-week offset; cloned local dates shift by `weekDelta * 7` calendar days. */
  weekDelta: number;
  planHash: string;
  items: readonly WeeklyClonePreviewItemDTO[];
  eligibleCount: number;
  conflictCount: number;
}>;

export type WeeklyCloneItemState =
  | "pending"
  | "creating"
  | "created"
  | "failed"
  | "outcome_unknown"
  | "undoing"
  | "undone"
  | "undo_unknown"
  | "undo_refused";

export type WeeklyCloneOperationState =
  | "running"
  | "partial"
  | "outcome_unknown"
  | "completed"
  | "undoing"
  | "undo_unknown"
  | "undone"
  | "undo_refused";

export type WeeklyCloneUndoState = "available" | "blocked" | "not_started" | "unknown" | "undone";

/** Contains only stable application UUIDs. No Airtable record ID or marker value is returned. */
export type WeeklyCloneOperationItemDTO = Readonly<{
  sourceTableId: string;
  sourceRevisionId: string;
  targetTableId: string | null;
  targetRevisionId: string | null;
  state: WeeklyCloneItemState;
  safeCode: WeeklyCloneConflictCode | "write_unknown" | "delete_unknown" | "source_changed" | null;
}>;

export type WeeklyCloneOperationDTO = Readonly<{
  providerState: WeeklyCloneProviderState;
  mutationsEnabled: boolean;
  operationId: string;
  state: WeeklyCloneOperationState;
  manifestRevision: number;
  sourceWeekStart: string;
  targetWeekStart: string;
  planHash: string;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
  retryDisposition: "reconcile_first" | "same_operation_after_no_write" | "new_operation_required" | "blocked";
  undoOperationId: string | null;
  undoExpectedManifestRevision: number | null;
  undoRetryDisposition: "reconcile_first" | "same_operation_after_no_delete" | "blocked" | null;
  undoState: WeeklyCloneUndoState;
  undoBlockedCode: "target_changed" | "active_activity" | "provider_unavailable" | "operation_unresolved" | null;
  items: readonly WeeklyCloneOperationItemDTO[];
}>;

export type WeeklyCloneOperationListItemDTO = Readonly<{
  operationId: string;
  sourceWeekStart: string;
  targetWeekStart: string;
  state: WeeklyCloneOperationState;
  manifestRevision: number;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
  retryDisposition: "reconcile_first" | "same_operation_after_no_write" | "new_operation_required" | "blocked";
  undoState: WeeklyCloneUndoState;
  undoBlockedCode: "target_changed" | "active_activity" | "provider_unavailable" | "operation_unresolved" | null;
  counts: Readonly<{ total: number; created: number; unresolved: number; failed: number; undone: number }>;
}>;

export type WeeklyCloneOperationListDTO = Readonly<{
  providerState: WeeklyCloneProviderState;
  mutationsEnabled: boolean;
  items: readonly WeeklyCloneOperationListItemDTO[];
  nextCursor: string | null;
}>;

export type WeeklyClonePreviewRequest = Readonly<{
  sourceWeekStart: string;
  targetWeekStart: string;
}>;

export type WeeklyCloneStartRequest = WeeklyClonePreviewRequest & Readonly<{
  operationId: string;
  expectedPlanHash: string;
}>;

export type WeeklyCloneUndoRequest = Readonly<{
  undoOperationId: string;
  expectedManifestRevision: number;
}>;

export type WeeklyCloneErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "invalid_input"
  | "not_found"
  | "revision_conflict"
  | "operation_conflict"
  | "provider_unavailable"
  | "temporarily_unavailable";

export type WeeklyCloneError = Readonly<{
  code: WeeklyCloneErrorCode;
  message: string;
  retryable: boolean;
  correlationId: string;
}>;

export type WeeklyCloneResponse<T> =
  | Readonly<{ ok: true; data: T; correlationId: string }>
  | Readonly<{ ok: false; error: WeeklyCloneError }>;

/**
 * W05.3 admin-only routes:
 * POST /api/admin/supply/weekly-clone/preview {sourceWeekStart,targetWeekStart}
 *   -> WeeklyCloneResponse<WeeklyClonePreviewDTO>
 * POST /api/admin/supply/weekly-clone {operationId,sourceWeekStart,targetWeekStart,expectedPlanHash}
 *   -> WeeklyCloneResponse<WeeklyCloneOperationDTO>
 * GET /api/admin/supply/weekly-clone/operations?limit=20&cursor=
 *   -> WeeklyCloneResponse<WeeklyCloneOperationListDTO> (admin-authorized, capped at 50)
 * GET /api/admin/supply/weekly-clone/operations/:operationId
 *   -> WeeklyCloneResponse<WeeklyCloneOperationDTO>
 * POST /api/admin/supply/weekly-clone/operations/:operationId/reconcile {}
 *   -> WeeklyCloneResponse<WeeklyCloneOperationDTO>
 * POST /api/admin/supply/weekly-clone/operations/:operationId/undo
 *   {undoOperationId,expectedManifestRevision}
 *   -> WeeklyCloneResponse<WeeklyCloneOperationDTO>
 *
 * All date-only inputs and week deltas are interpreted in America/New_York. The
 * Weeks run Monday through Sunday in America/New_York. The target may be any
 * week; each cloned local date shifts by the exact whole-week delta. Only draft
 * revisions are cloned. Clone and undo are separately idempotent. Provider writes
 * are available only through the guarded local fixture until Airtable mappings and
 * the dedicated marker field are verified.
 */
