/** Browser-safe W05.1 sync DTOs. Provider rows, source IDs, credentials and raw errors stay server-side. */

export type SupplyEntityKind = "table" | "venue";
export type SupplyStopRole = "drinks" | "dinner" | "dessert";

export type SupplySyncState =
  | "running"
  | "staged"
  | "no_change"
  | "incomplete"
  | "conflict"
  | "failed";

export type SupplyProviderState =
  | "disabled_unmapped"
  | "fixture"
  | "ready"
  | "unavailable";

export type SupplySyncConflict = Readonly<{
  entityKind: SupplyEntityKind;
  /** One-based index in the complete provider snapshot; source identifiers remain server-only. */
  recordOrdinal: number;
  field: "source" | "title" | "schedule" | "neighborhood" | "stops" | "venue";
  code:
    | "duplicate_source_id"
    | "invalid_source_record"
    | "invalid_date"
    | "invalid_time"
    | "nonexistent_local_time"
    | "ambiguous_local_time"
    | "invalid_stop_set"
    | "missing_venue"
    | "invalid_venue";
  stopRole?: SupplyStopRole;
  message: string;
}>;

export type SupplySyncCounts = Readonly<{
  tablePages: number;
  venuePages: number;
  tables: number;
  venues: number;
}>;

export type SupplyLastGoodPublished = Readonly<{
  revisionId: string;
  publishedAt: string;
}>;

export type SupplySyncRunDTO = Readonly<{
  runId: string;
  state: SupplySyncState;
  startedAt: string;
  finishedAt: string | null;
  counts: SupplySyncCounts;
  candidateRevisionId: string | null;
  candidateSourceHash: string | null;
  conflictCount: number;
  conflicts: readonly SupplySyncConflict[];
  retryDisposition: "safe_to_retry" | "new_operation_required" | "blocked";
  safeMessage: string | null;
}>;

export type SupplySyncAdminSummaryDTO = Readonly<{
  providerState: SupplyProviderState;
  lastGoodPublished: SupplyLastGoodPublished | null;
  latestRun: SupplySyncRunDTO | null;
}>;

export type SupplySyncStartRequest = Readonly<{ operationId: string }>;

export type SupplySyncErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "invalid_input"
  | "conflict"
  | "temporarily_unavailable";

export type SupplySyncError = Readonly<{
  code: SupplySyncErrorCode;
  message: string;
  retryable: boolean;
  correlationId: string;
}>;

export type SupplySyncResponse<T> =
  | Readonly<{ ok: true; data: T; correlationId: string }>
  | Readonly<{ ok: false; error: SupplySyncError }>;

/**
 * W05.1 HTTP contract:
 * GET /api/admin/supply/sync -> SupplySyncResponse<SupplySyncAdminSummaryDTO>
 * POST /api/admin/supply/sync { operationId } -> SupplySyncResponse<SupplySyncRunDTO>
 *
 * A `staged` result is a validated candidate only. W05.1 has no accept or
 * publish operation, so a staged revision never replaces lastGoodPublished.
 */
