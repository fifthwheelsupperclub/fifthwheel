/** Local/production composition for the protected supply sync service. No Airtable adapter is wired. */

import { env } from "node:process";
import { createVerifiedPrincipalResolver } from "./principal.server.ts";
import { createSupabaseServerClient, type SupabaseServerConfig } from "./supabase.server.ts";
import { createSupplySyncRepository } from "./supply.repository.server.ts";
import { createSupplySyncService } from "./supply.service.server.ts";
import { createSupplyAssignmentReader } from "./supply.assignment.reader.server.ts";
import { createSupplyManagementRepository } from "./supply.management.repository.server.ts";
import { createSupplyManagementService } from "./supply.management.service.server.ts";
import type { SupplyProvider } from "./supply.contract.server.ts";

function required(name: string, value: string | undefined): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${name}_unavailable`);
  return normalized;
}

const disabledSupplyProvider: SupplyProvider = Object.freeze({
  state: "disabled_unmapped",
  async listTables() { throw new Error("provider_disabled"); },
  async listVenues() { throw new Error("provider_disabled"); },
});

const fixtureRunPattern = /^(?:[a-f0-9]{12}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

function createFixtureSupplyProvider(runId: string): SupplyProvider {
  const suffix = runId.toLowerCase().replaceAll("-", "").slice(0, 12);
  const venueOne = `fixture:${suffix}:venue:olive-room`;
  const venueTwo = `fixture:${suffix}:venue:night-garden`;
  return Object.freeze({
    state: "fixture",
    async listVenues(cursor: string | null) {
      if (cursor !== null) return { records: [], nextCursor: null };
      return { records: [
        { sourceRecordId: venueOne, name: `Olive Room ${suffix} (Synthetic)`, address: "10 Example Way", neighborhood: "Inman Park" },
        { sourceRecordId: venueTwo, name: `Night Garden ${suffix} (Synthetic)`, address: "20 Example Way", neighborhood: "Inman Park" },
      ], nextCursor: null };
    },
    async listTables(cursor: string | null) {
      if (cursor !== null) return { records: [], nextCursor: null };
      return { records: [
        {
          sourceRecordId: `fixture:${suffix}:table:2026-11-19-example`,
          title: `Synthetic Thursday Table ${suffix}`, localDate: "2026-11-19", startLocalTime: "19:00",
          neighborhood: "Inman Park", publicationIntent: "candidate" as const,
          stops: [
            { role: "drinks", venueSourceRecordId: venueOne, minutesFromStart: 0 },
            { role: "dinner", venueSourceRecordId: venueOne, minutesFromStart: 45 },
            { role: "dessert", venueSourceRecordId: venueTwo, minutesFromStart: 120 },
          ] as const,
        },
      ], nextCursor: null };
    },
  });
}

function isLoopbackHttpOrigin(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
      && url.username === "" && url.password === "" && url.pathname === "/" && !url.search && !url.hash;
  } catch { return false; }
}

export function fixtureModeAllowed(environment: Readonly<Record<string, string | undefined>> = env): boolean {
  if (environment.SUPPLY_PROVIDER_MODE !== "fixture" || environment.NODE_ENV === "production" || !isLoopbackHttpOrigin(environment.APP_ORIGIN)) return false;
  if (!environment.SUPPLY_FIXTURE_RUN_ID || !fixtureRunPattern.test(environment.SUPPLY_FIXTURE_RUN_ID)) return false;
  if (!environment.SUPABASE_URL) return false;
  try {
    const url = new URL(environment.SUPABASE_URL);
    return url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
      && url.username === "" && url.password === "" && url.pathname === "/" && !url.search && !url.hash;
  } catch { return false; }
}

export function createSupplyRuntime() {
  const config: SupabaseServerConfig = {
    url: required("SUPABASE_URL", env.SUPABASE_URL),
    publishableKey: required("SUPABASE_PUBLISHABLE_KEY", env.SUPABASE_PUBLISHABLE_KEY ?? env.SUPABASE_ANON_KEY),
    secretKey: required("SUPABASE_SECRET_KEY", env.SUPABASE_SECRET_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY),
  };
  const supabase = createSupabaseServerClient(config);
  const repository = createSupplySyncRepository(config);
  const provider = fixtureModeAllowed() ? createFixtureSupplyProvider(env.SUPPLY_FIXTURE_RUN_ID!) : disabledSupplyProvider;
  const resolvePrincipal = createVerifiedPrincipalResolver(supabase, createSupplyAssignmentReader(config));
  const managementRepository = createSupplyManagementRepository(config);
  return Object.freeze({
    provider,
    service: createSupplySyncService({ resolvePrincipal, provider, repository }),
    managementService: createSupplyManagementService({
      resolvePrincipal, repository: managementRepository,
    }),
  });
}
