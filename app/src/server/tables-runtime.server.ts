/** Server-only composition root for the W06 guest Table and request endpoints. */

import { env } from "node:process";
import { createVerifiedPrincipalResolver } from "./principal.server.ts";
import { createSupabaseServerClient, type SupabaseServerConfig } from "./supabase.server.ts";
import { createTablesRepository } from "./tables.repository.server.ts";
import { createTablesService } from "./tables.service.server.ts";

function required(name: string, value: string | undefined): string {
  const normalized = value?.trim(); if (!normalized) throw new Error(`${name}_unavailable`); return normalized;
}

export function createTablesRuntime(environment: Readonly<Record<string, string | undefined>> = env) {
  const config: SupabaseServerConfig = {
    url: required("SUPABASE_URL", environment.SUPABASE_URL),
    publishableKey: required("SUPABASE_PUBLISHABLE_KEY", environment.SUPABASE_PUBLISHABLE_KEY ?? environment.SUPABASE_ANON_KEY),
    secretKey: required("SUPABASE_SECRET_KEY", environment.SUPABASE_SECRET_KEY ?? environment.SUPABASE_SERVICE_ROLE_KEY),
  };
  const supabase = createSupabaseServerClient(config);
  return createTablesService({ resolvePrincipal: createVerifiedPrincipalResolver(supabase), repository: createTablesRepository(config) });
}
