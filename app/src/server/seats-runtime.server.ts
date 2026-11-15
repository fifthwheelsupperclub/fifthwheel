/** Server-only W07.3 composition root for member Seat reads. */

import { env } from "node:process";
import { createVerifiedPrincipalResolver } from "./principal.server.ts";
import { createSeatRepository } from "./seats.repository.server.ts";
import { createSeatService } from "./seats.service.server.ts";
import { createSeatHttpHandlers } from "./seats.http.server.ts";
import { createSupplyTableAssignmentReader } from "./supply-table-assignment-reader.server.ts";
import { createSupabaseServerClient, type SupabaseServerConfig } from "./supabase.server.ts";

type Environment = Readonly<Record<string, string | undefined>>;
function required(name: string, value: string | undefined): string {
  const normalized = value?.trim(); if (!normalized) throw new Error(`${name}_unavailable`); return normalized;
}

export function createSeatHttpRuntime(environment: Environment = env) {
  const config: SupabaseServerConfig = {
    url: required("SUPABASE_URL", environment.SUPABASE_URL),
    publishableKey: required("SUPABASE_PUBLISHABLE_KEY", environment.SUPABASE_PUBLISHABLE_KEY ?? environment.SUPABASE_ANON_KEY),
    secretKey: required("SUPABASE_SECRET_KEY", environment.SUPABASE_SECRET_KEY ?? environment.SUPABASE_SERVICE_ROLE_KEY),
  };
  const resolvePrincipal = createVerifiedPrincipalResolver(createSupabaseServerClient(config), createSupplyTableAssignmentReader(config));
  return createSeatHttpHandlers(() => createSeatService({ resolvePrincipal, repository: createSeatRepository(config) }));
}
