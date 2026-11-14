/** Server-only composition for W04 profile services. */

import { env } from "node:process";
import { randomUUID } from "node:crypto";
import { createVerifiedPrincipalResolver } from "./principal.server.ts";
import { createProfileRepository } from "./profile.repository.server.ts";
import { createSupabaseProfileStorage } from "./profile.storage.supabase.server.ts";
import { createProfileService } from "./profile.service.server.ts";
import { createSharpImageNormalizer } from "./image-normalizer.server.ts";
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
  const appOrigin = required("APP_ORIGIN", env.APP_ORIGIN);
  const supabase = createSupabaseServerClient(config);
  return createProfileService({
    resolvePrincipal: createVerifiedPrincipalResolver(supabase),
    repository: createProfileRepository(config),
    storage: createSupabaseProfileStorage(config),
    normalizer: createSharpImageNormalizer(),
    createId: () => randomUUID(),
    now: () => new Date(),
    appOrigin,
  });
}
