/** Server-only composition for the member profile service. */

import { env } from "node:process";
import { randomUUID } from "node:crypto";
import { createVerifiedPrincipalResolver } from "./principal.server.ts";
import { createProfileRepository } from "./profile.repository.server.ts";
import { createProfileService } from "./profile.service.server.ts";
import { createSupabaseServerClient, type SupabaseServerConfig } from "./supabase.server.ts";

function required(name: string, value: string | undefined): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${name}_unavailable`);
  return normalized;
}

export function createProfileRuntime() {
  const config: SupabaseServerConfig = {
    url: required("SUPABASE_URL", env.SUPABASE_URL),
    publishableKey: required("SUPABASE_PUBLISHABLE_KEY", env.SUPABASE_PUBLISHABLE_KEY ?? env.SUPABASE_ANON_KEY),
    secretKey: required("SUPABASE_SECRET_KEY", env.SUPABASE_SECRET_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY),
  };
  const supabase = createSupabaseServerClient(config);
  return createProfileService({
    resolvePrincipal: createVerifiedPrincipalResolver(supabase),
    repository: createProfileRepository(config),
    createId: () => randomUUID(),
    now: () => new Date(),
  });
}
