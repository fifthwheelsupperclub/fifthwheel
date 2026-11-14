/** Server-only W07.4 composition root. No email or refund provider is wired here. */

import { env } from "node:process";
import { createVerifiedPrincipalResolver } from "./principal.server.ts";
import { createSeatCancellationRepository } from "./seat-cancellation.repository.server.ts";
import { createSeatCancellationService } from "./seat-cancellation.service.server.ts";
import { createSupplyTableAssignmentReader } from "./supply-table-assignment-reader.server.ts";
import { createSupabaseServerClient, type SupabaseServerConfig } from "./supabase.server.ts";
import { createSeatCancellationHttpHandlers } from "./seat-cancellation.http.server.ts";

type Environment = Readonly<Record<string, string | undefined>>;
function required(name: string, value: string | undefined): string {
  const normalized = value?.trim(); if (!normalized) throw new Error(`${name}_unavailable`); return normalized;
}

export function createSeatCancellationRuntime(environment: Environment = env) {
  const config: SupabaseServerConfig = {
    url: required("SUPABASE_URL", environment.SUPABASE_URL),
    publishableKey: required("SUPABASE_PUBLISHABLE_KEY", environment.SUPABASE_PUBLISHABLE_KEY ?? environment.SUPABASE_ANON_KEY),
    secretKey: required("SUPABASE_SECRET_KEY", environment.SUPABASE_SECRET_KEY ?? environment.SUPABASE_SERVICE_ROLE_KEY),
  };
  const supabase = createSupabaseServerClient(config);
  const resolvePrincipal = createVerifiedPrincipalResolver(supabase, createSupplyTableAssignmentReader(config));
  return createSeatCancellationService({ resolvePrincipal, repository: createSeatCancellationRepository(config) });
}

export function createSeatCancellationHttpRuntime(environment: Environment = env) {
  const appOrigin = required("APP_ORIGIN", environment.APP_ORIGIN);
  return createSeatCancellationHttpHandlers(() => createSeatCancellationRuntime(environment), appOrigin);
}
