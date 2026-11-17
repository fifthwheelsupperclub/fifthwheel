/** Composition for the supply management service. Supabase is the source of truth for supply. */

import { env } from "node:process";
import { createVerifiedPrincipalResolver } from "./principal.server.ts";
import { createSupabaseServerClient, type SupabaseServerConfig } from "./supabase.server.ts";
import { createSupplyAssignmentReader } from "./supply.assignment.reader.server.ts";
import { createSupplyManagementRepository } from "./supply.management.repository.server.ts";
import { createSupplyManagementService } from "./supply.management.service.server.ts";

function required(name: string, value: string | undefined): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${name}_unavailable`);
  return normalized;
}

export function createSupplyRuntime() {
  const config: SupabaseServerConfig = {
    url: required("SUPABASE_URL", env.SUPABASE_URL),
    publishableKey: required("SUPABASE_PUBLISHABLE_KEY", env.SUPABASE_PUBLISHABLE_KEY ?? env.SUPABASE_ANON_KEY),
    secretKey: required("SUPABASE_SECRET_KEY", env.SUPABASE_SECRET_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY),
  };
  const resolvePrincipal = createVerifiedPrincipalResolver(createSupabaseServerClient(config), createSupplyAssignmentReader(config));
  return Object.freeze({
    managementService: createSupplyManagementService({ resolvePrincipal, repository: createSupplyManagementRepository(config) }),
  });
}
