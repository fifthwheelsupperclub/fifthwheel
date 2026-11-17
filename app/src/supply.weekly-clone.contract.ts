/** Browser-safe W05.3 weekly clone DTOs. */

export type WeeklyCloneWeekStartPolicy = "monday";

export type WeeklyCloneEligibility = "eligible" | "conflict";
export type WeeklyCloneConflictCode = "source_not_draft" | "source_changed" | "protected_change";

export type WeeklyClonePreviewItemDTO = Readonly<{
  sourceTableId: string;
  title: string;
  sourceLocalDate: string;
  targetLocalDate: string;
  eligibility: WeeklyCloneEligibility;
  conflictCode: WeeklyCloneConflictCode | null;
}>;

export type WeeklyClonePreviewDTO = Readonly<{
  weekStartPolicy: WeeklyCloneWeekStartPolicy;
  sourceWeekStart: string;
  targetWeekStart: string;
  /** Whole-week offset; cloned local dates shift by `weekDelta * 7` calendar days. */
  weekDelta: number;
  items: readonly WeeklyClonePreviewItemDTO[];
  eligibleCount: number;
  conflictCount: number;
}>;

export type WeeklyCloneOperationState = "completed" | "undone";
/** `blocked` means at least one cloned draft was edited or used, so undo is refused. */
export type WeeklyCloneUndoState = "available" | "blocked" | "undone";

export type WeeklyCloneOperationListItemDTO = Readonly<{
  operationId: string;
  sourceWeekStart: string;
  targetWeekStart: string;
  state: WeeklyCloneOperationState;
  startedAt: string;
  updatedAt: string;
  undoState: WeeklyCloneUndoState;
  draftCount: number;
}>;

export type WeeklyCloneOperationItemDTO = Readonly<{
  sourceTableId: string;
  targetTableId: string;
  title: string;
  targetLocalDate: string;
  state: "created" | "undone";
}>;

export type WeeklyCloneOperationDTO = WeeklyCloneOperationListItemDTO & Readonly<{
  items: readonly WeeklyCloneOperationItemDTO[];
}>;

export type WeeklyCloneOperationListDTO = Readonly<{
  items: readonly WeeklyCloneOperationListItemDTO[];
  nextCursor: string | null;
}>;

export type WeeklyClonePreviewRequest = Readonly<{
  sourceWeekStart: string;
  targetWeekStart: string;
}>;

export type WeeklyCloneStartRequest = WeeklyClonePreviewRequest & Readonly<{ operationId: string }>;

export type WeeklyCloneErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "invalid_input"
  | "not_found"
  | "revision_conflict"
  | "operation_conflict"
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
 * POST /api/admin/supply/weekly-clone {operationId,sourceWeekStart,targetWeekStart}
 *   -> WeeklyCloneResponse<WeeklyCloneOperationDTO>
 * GET /api/admin/supply/weekly-clone/operations?limit=20&cursor=
 *   -> WeeklyCloneResponse<WeeklyCloneOperationListDTO> (capped at 50)
 * GET /api/admin/supply/weekly-clone/operations/:operationId
 *   -> WeeklyCloneResponse<WeeklyCloneOperationDTO>
 * POST /api/admin/supply/weekly-clone/operations/:operationId/undo {}
 *   -> WeeklyCloneResponse<WeeklyCloneOperationDTO>
 *
 * Weeks run Monday through Sunday in America/New_York; each cloned local date
 * shifts by the whole-week delta. Only draft revisions are cloned. Clone is one
 * database transaction, idempotent on operationId. Undo is all-or-nothing and
 * refused once any cloned draft has been edited or used.
 */
