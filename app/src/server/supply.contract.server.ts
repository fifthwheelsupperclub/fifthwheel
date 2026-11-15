/** Server-only canonical Airtable boundary. Provider field names and IDs never enter browser DTOs. */

import type { SupplyEntityKind, SupplySyncAdminSummaryDTO, SupplySyncRunDTO, SupplyStopRole } from "../supply.contract.ts";

export type SupplyVenueSource = Readonly<{
  sourceRecordId: string;
  name: string;
  address: string;
  neighborhood: string;
}>;

export type SupplyTableSource = Readonly<{
  sourceRecordId: string;
  title: string;
  localDate: string;
  startLocalTime: string;
  neighborhood: string;
  publicationIntent: "draft" | "candidate" | "unmapped";
  stops: readonly [
    Readonly<{ role: "drinks"; venueSourceRecordId: string; minutesFromStart: number }>,
    Readonly<{ role: "dinner"; venueSourceRecordId: string; minutesFromStart: number }>,
    Readonly<{ role: "dessert"; venueSourceRecordId: string; minutesFromStart: number }>,
  ];
}>;

export type SupplyPage<T> = Readonly<{ records: readonly T[]; nextCursor: string | null }>;

/** Provider adapter is deliberately unavailable until Airtable field mappings are verified. */
export interface SupplyProvider {
  readonly state: "fixture" | "ready" | "disabled_unmapped" | "unavailable";
  listTables(cursor: string | null): Promise<SupplyPage<SupplyTableSource>>;
  listVenues(cursor: string | null): Promise<SupplyPage<SupplyVenueSource>>;
}

export type SupplySyncStart = Readonly<{ run: SupplySyncRunDTO; replay: boolean }>;
export type SupplySyncCompletion = Readonly<{
  state: "staged" | "no_change" | "incomplete" | "conflict" | "failed";
  counts: SupplySyncRunDTO["counts"];
  candidateRevisionId?: string | null;
  candidateSourceHash?: string | null;
  conflicts?: SupplySyncRunDTO["conflicts"];
  totalConflictCount?: number;
  retryDisposition: SupplySyncRunDTO["retryDisposition"];
  safeMessage?: string | null;
}>;

/** Persistence methods must be transactional and service-role-only. */
export interface SupplySyncRepository {
  begin(operationId: string, actorUserId: string): Promise<SupplySyncStart>;
  finish(runId: string, actorUserId: string, completion: SupplySyncCompletion, candidate?: Readonly<{
    sourceHash: string;
    normalized: readonly unknown[];
    mappings: readonly Readonly<{ entityKind: SupplyEntityKind; sourceRecordId: string; coreId: string }>[];
  }>): Promise<SupplySyncRunDTO>;
  readSummary(actorUserId: string): Promise<Omit<SupplySyncAdminSummaryDTO, "providerState">>;
}

export type CanonicalStop = Readonly<{ role: SupplyStopRole; venueId: string; minutesFromStart: number }>;
