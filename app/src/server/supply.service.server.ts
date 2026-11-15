/** W05.1 staged synchronization; intentionally has no Airtable adapter or publish operation. */

import { createHash } from "node:crypto";
import type {
  SupplyLastGoodPublished, SupplySyncAdminSummaryDTO, SupplySyncConflict,
  SupplySyncCounts, SupplySyncRunDTO,
} from "../supply.contract.ts";
import { authorize } from "./authorization.server.ts";
import type { VerifiedPrincipalResolver } from "./principal.server.ts";
import type {
  SupplyProvider, SupplySyncCompletion, SupplySyncRepository, SupplyTableSource, SupplyVenueSource,
} from "./supply.contract.server.ts";
import { atlantaLocalDateTime } from "./supply.time.server.ts";

export type SupplySyncServiceDependencies = Readonly<{
  resolvePrincipal: VerifiedPrincipalResolver;
  provider: SupplyProvider;
  repository: SupplySyncRepository;
  now?: () => Date;
}>;

export type SupplyServiceError = Readonly<{ code: "unauthenticated" | "forbidden" | "validation_failed" | "temporarily_unavailable"; safeMessage: string }>;
export type SupplyServiceResult<T> = Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; error: SupplyServiceError }>;
export type SupplySyncInput = Readonly<{ accessToken?: string | null; operationId: string }>;
export type SupplySummaryInput = Readonly<{ accessToken?: string | null }>;

export interface SupplySyncService {
  readSummary(input: SupplySummaryInput): Promise<SupplyServiceResult<SupplySyncAdminSummaryDTO>>;
  synchronize(input: SupplySyncInput): Promise<SupplyServiceResult<SupplySyncRunDTO>>;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const maxPagesPerEntity = 200;
const maxRecordsPerEntity = 10_000;
const maxConflicts = 100;
const roles = ["drinks", "dinner", "dessert"] as const;

type CanonicalVenue = Readonly<{ id: string; sourceRecordId: string; name: string; address: string; neighborhood: string }>;
type CanonicalTable = Readonly<{
  id: string; sourceRecordId: string; title: string; localDate: string; startLocalTime: string; startsAt: string;
  neighborhood: string; publicationIntent: SupplyTableSource["publicationIntent"];
  stops: readonly Readonly<{ role: typeof roles[number]; venueId: string; minutesFromStart: number }>[];
}>;

function failure(code: SupplyServiceError["code"], safeMessage: string): SupplyServiceResult<never> {
  return { ok: false, error: { code, safeMessage } };
}

function sourceUuid(entityKind: "table" | "venue", sourceRecordId: string): string {
  const digest = createHash("sha256").update(`fifthwheel:supply:v1:${entityKind}:${sourceRecordId}`).digest();
  const bytes = Buffer.from(digest.subarray(0, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function safeText(value: unknown, max = 180): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= max && !/[\u0000-\u001f\u007f]/.test(value);
}

function hashSnapshot(tables: readonly CanonicalTable[], venues: readonly CanonicalVenue[]): string {
  const stable = JSON.stringify({
    venues: [...venues].sort((a, b) => a.sourceRecordId.localeCompare(b.sourceRecordId)),
    tables: [...tables].sort((a, b) => a.sourceRecordId.localeCompare(b.sourceRecordId)),
  });
  return createHash("sha256").update(stable).digest("hex");
}

async function collectPages<T>(fetchPage: (cursor: string | null) => Promise<{ records: readonly T[]; nextCursor: string | null }>): Promise<{
  records: T[]; pages: number; complete: boolean;
}> {
  const records: T[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | null = null;
  for (let pageNumber = 0; pageNumber < maxPagesPerEntity; pageNumber += 1) {
    let page: { records: readonly T[]; nextCursor: string | null };
    try { page = await fetchPage(cursor); }
    catch { return { records, pages: pageNumber, complete: false }; }
    if (!page || !Array.isArray(page.records) || (page.nextCursor !== null && (typeof page.nextCursor !== "string" || page.nextCursor.length > 500))) {
      return { records, pages: pageNumber + 1, complete: false };
    }
    records.push(...page.records);
    if (records.length > maxRecordsPerEntity) return { records: records.slice(0, maxRecordsPerEntity), pages: pageNumber + 1, complete: false };
    if (page.nextCursor === null) return { records, pages: pageNumber + 1, complete: true };
    if (page.nextCursor === cursor || seenCursors.has(page.nextCursor)) return { records, pages: pageNumber + 1, complete: false };
    seenCursors.add(page.nextCursor);
    cursor = page.nextCursor;
  }
  return { records, pages: maxPagesPerEntity, complete: false };
}

function mapConflict(conflict: SupplySyncConflict): SupplySyncConflict {
  return Object.freeze({ ...conflict, message: conflict.message.slice(0, 180) });
}

function normalizeSnapshot(tables: readonly SupplyTableSource[], venues: readonly SupplyVenueSource[]): {
  tables: CanonicalTable[]; venues: CanonicalVenue[]; conflicts: SupplySyncConflict[];
} {
  const conflicts: SupplySyncConflict[] = [];
  const venueBySourceId = new Map<string, CanonicalVenue>();
  const tableIds = new Set<string>();
  const venueIds = new Set<string>();
  const normalizedVenues: CanonicalVenue[] = [];
  venues.forEach((venue, index) => {
    const ordinal = index + 1;
    if (!venue || !safeText(venue.sourceRecordId, 200) || !safeText(venue.name) || !safeText(venue.address, 400) || !safeText(venue.neighborhood, 120)) {
      conflicts.push({ entityKind: "venue", recordOrdinal: ordinal, field: "venue", code: "invalid_venue", message: "A venue is missing a valid name, address, neighborhood, or source key." });
      return;
    }
    if (venueIds.has(venue.sourceRecordId)) {
      conflicts.push({ entityKind: "venue", recordOrdinal: ordinal, field: "source", code: "duplicate_source_id", message: "The source returned a venue more than once." });
      return;
    }
    venueIds.add(venue.sourceRecordId);
    const canonical = Object.freeze({
      id: sourceUuid("venue", venue.sourceRecordId), sourceRecordId: venue.sourceRecordId,
      name: venue.name.trim(), address: venue.address.trim(), neighborhood: venue.neighborhood.trim(),
    });
    venueBySourceId.set(venue.sourceRecordId, canonical);
    normalizedVenues.push(canonical);
  });
  const normalizedTables: CanonicalTable[] = [];
  tables.forEach((table, index) => {
    const ordinal = index + 1;
    if (!table || !safeText(table.sourceRecordId, 200)) {
      conflicts.push({ entityKind: "table", recordOrdinal: ordinal, field: "source", code: "invalid_source_record", message: "A Table has no valid stable source key." });
      return;
    }
    if (tableIds.has(table.sourceRecordId)) {
      conflicts.push({ entityKind: "table", recordOrdinal: ordinal, field: "source", code: "duplicate_source_id", message: "The source returned a Table more than once." });
      return;
    }
    tableIds.add(table.sourceRecordId);
    if (!safeText(table.title, 180)) conflicts.push({ entityKind: "table", recordOrdinal: ordinal, field: "title", code: "invalid_source_record", message: "A Table title is missing or invalid." });
    if (!safeText(table.neighborhood, 120)) conflicts.push({ entityKind: "table", recordOrdinal: ordinal, field: "neighborhood", code: "invalid_source_record", message: "A Table neighborhood is missing or invalid." });
    if (!(table.publicationIntent === "draft" || table.publicationIntent === "candidate")) {
      conflicts.push({ entityKind: "table", recordOrdinal: ordinal, field: "source", code: "invalid_source_record", message: "The Table publication intent is unmapped or invalid." });
    }
    const localTime = atlantaLocalDateTime(table.localDate, table.startLocalTime);
    if (!localTime.ok) conflicts.push({ entityKind: "table", recordOrdinal: ordinal, field: "schedule", code: localTime.code, message: "The Table date or Atlanta local time needs correction." });
    const stops = (table as SupplyTableSource).stops;
    if (!Array.isArray(stops) || stops.length !== 3 || stops.some((stop, i) => !stop || stop.role !== roles[i] || !Number.isInteger(stop.minutesFromStart) || stop.minutesFromStart < 0 || stop.minutesFromStart > 720)) {
      conflicts.push({ entityKind: "table", recordOrdinal: ordinal, field: "stops", code: "invalid_stop_set", message: "A Table must have ordered drinks, dinner, and dessert stops with valid offsets." });
      return;
    }
    const mappedStops: { role: typeof roles[number]; venueId: string; minutesFromStart: number }[] = [];
    for (const stop of stops) {
      const venue = typeof stop.venueSourceRecordId === "string" ? venueBySourceId.get(stop.venueSourceRecordId) : undefined;
      if (!venue) {
        conflicts.push({ entityKind: "table", recordOrdinal: ordinal, field: "venue", code: "missing_venue", stopRole: stop.role, message: `The ${stop.role} stop refers to a venue missing from the complete venue snapshot.` });
        continue;
      }
      mappedStops.push({ role: stop.role, venueId: venue.id, minutesFromStart: stop.minutesFromStart });
    }
    if (localTime.ok && safeText(table.title, 180) && safeText(table.neighborhood, 120) && mappedStops.length === 3) {
      normalizedTables.push(Object.freeze({
        id: sourceUuid("table", table.sourceRecordId), sourceRecordId: table.sourceRecordId,
        title: table.title.trim(), localDate: table.localDate, startLocalTime: table.startLocalTime,
        startsAt: localTime.instant, neighborhood: table.neighborhood.trim(), publicationIntent: table.publicationIntent,
        stops: mappedStops,
      }));
    }
  });
  return { tables: normalizedTables, venues: normalizedVenues, conflicts: conflicts.map(mapConflict) };
}

function runFailure(state: SupplySyncCompletion["state"], counts: SupplySyncCounts, safeMessage: string): SupplySyncCompletion {
  // Run operation IDs are immutable idempotency keys; a retry starts a new run.
  return { state, counts, retryDisposition: state === "failed" || state === "incomplete" ? "new_operation_required" : "blocked", safeMessage };
}

export function createSupplySyncService(dependencies: SupplySyncServiceDependencies): SupplySyncService {
  const now = dependencies.now ?? (() => new Date());
  async function adminPrincipal(token: string | null | undefined, action: "supply:read" | "supply:sync") {
    const principal = await dependencies.resolvePrincipal(token);
    const decision = authorize(principal, { workspace: "admin", action });
    return decision;
  }

  return Object.freeze({
    async readSummary(input: SupplySummaryInput): Promise<SupplyServiceResult<SupplySyncAdminSummaryDTO>> {
      try {
        const decision = await adminPrincipal(input.accessToken, "supply:read");
        if (!decision.allowed) return failure(decision.reason === "unauthenticated" || decision.reason === "email-unverified" ? "unauthenticated" : "forbidden", "You are not allowed to view supply status.");
        const summary = await dependencies.repository.readSummary(decision.principal.userId);
        return { ok: true as const, value: Object.freeze({ ...summary, providerState: dependencies.provider.state }) };
      } catch {
        return failure("temporarily_unavailable", "Supply status is temporarily unavailable.");
      }
    },

    async synchronize(input: SupplySyncInput): Promise<SupplyServiceResult<SupplySyncRunDTO>> {
      let decision;
      try { decision = await adminPrincipal(input.accessToken, "supply:sync"); }
      catch { return failure("temporarily_unavailable", "Your access could not be verified. Try again."); }
      if (!decision.allowed) return failure(decision.reason === "unauthenticated" || decision.reason === "email-unverified" ? "unauthenticated" : "forbidden", "You are not allowed to synchronize Table supply.");
      const principal = decision.principal;
      if (!uuidPattern.test(input.operationId)) return failure("validation_failed", "Use a valid operation identifier.");

      let started: Awaited<ReturnType<SupplySyncRepository["begin"]>>;
      try { started = await dependencies.repository.begin(input.operationId, principal.userId); }
      catch { return failure("temporarily_unavailable", "The sync could not be started. Retry with the same operation ID."); }
      if (started.replay || started.run.state !== "running") return { ok: true, value: started.run };

      const zeroCounts: SupplySyncCounts = { tablePages: 0, venuePages: 0, tables: 0, venues: 0 };
      if (dependencies.provider.state !== "fixture" && dependencies.provider.state !== "ready") {
        try {
          const result = await dependencies.repository.finish(started.run.runId, principal.userId,
            runFailure("failed", zeroCounts, "The supply provider is not configured."));
          return { ok: true, value: result };
        } catch { return failure("temporarily_unavailable", "The sync status could not be saved. Retry with the same operation ID."); }
      }

      try {
        const [tablePageSet, venuePageSet] = await Promise.all([
          collectPages((cursor) => dependencies.provider.listTables(cursor)),
          collectPages((cursor) => dependencies.provider.listVenues(cursor)),
        ]);
        const counts: SupplySyncCounts = {
          tablePages: tablePageSet.pages, venuePages: venuePageSet.pages,
          tables: tablePageSet.records.length, venues: venuePageSet.records.length,
        };
        if (!tablePageSet.complete || !venuePageSet.complete) {
          return { ok: true, value: await dependencies.repository.finish(started.run.runId, principal.userId,
            runFailure("incomplete", counts, "The provider did not return a complete paginated snapshot. Retry with a new operation ID.")) };
        }
        const normalized = normalizeSnapshot(tablePageSet.records, venuePageSet.records);
        if (normalized.conflicts.length > 0) {
          const completion: SupplySyncCompletion = {
            state: "conflict", counts, conflicts: normalized.conflicts.slice(0, maxConflicts), totalConflictCount: normalized.conflicts.length,
            retryDisposition: "blocked", safeMessage: "Correct the listed source records, then start a new sync.",
          };
          return { ok: true, value: await dependencies.repository.finish(started.run.runId, principal.userId, completion) };
        }
        const sourceHash = hashSnapshot(normalized.tables, normalized.venues);
        const completion: SupplySyncCompletion = {
          state: "staged", counts, candidateSourceHash: sourceHash,
          retryDisposition: "blocked", safeMessage: null,
        };
        const candidate = {
          sourceHash,
          normalized: [...normalized.venues, ...normalized.tables],
          mappings: [
            ...normalized.venues.map((venue) => ({ entityKind: "venue" as const, sourceRecordId: venue.sourceRecordId, coreId: venue.id })),
            ...normalized.tables.map((table) => ({ entityKind: "table" as const, sourceRecordId: table.sourceRecordId, coreId: table.id })),
          ],
        };
        return { ok: true, value: await dependencies.repository.finish(started.run.runId, principal.userId, completion, candidate) };
      } catch {
        try {
          const result = await dependencies.repository.finish(started.run.runId, principal.userId,
            runFailure("failed", zeroCounts, "The provider or sync storage failed before a complete candidate was staged."));
          return { ok: true, value: result };
        } catch { return failure("temporarily_unavailable", "The sync outcome is unavailable. Check status before retrying."); }
      }
    },
  });
}
