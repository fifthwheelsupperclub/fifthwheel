/** Local/production composition for guarded weekly supply clone operations. */

import { env } from "node:process";
import { createVerifiedPrincipalResolver } from "./principal.server.ts";
import { createSupabaseServerClient, type SupabaseServerConfig } from "./supabase.server.ts";
import { createWeeklyCloneRepository } from "./supply.weekly-clone.repository.server.ts";
import { createWeeklyCloneService } from "./supply.weekly-clone.service.server.ts";
import { createWeeklyCloneFixtureProvider, disabledWeeklyCloneProvider } from "./supply.weekly-clone.provider.server.ts";
import { fixtureModeAllowed } from "./supply-runtime.server.ts";

function required(name: string, value: string | undefined): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${name}_unavailable`);
  return normalized;
}

export function createWeeklyCloneRuntime(environment: Readonly<Record<string, string | undefined>> = env) {
  const config: SupabaseServerConfig = {
    url: required("SUPABASE_URL", environment.SUPABASE_URL),
    publishableKey: required("SUPABASE_PUBLISHABLE_KEY", environment.SUPABASE_PUBLISHABLE_KEY ?? environment.SUPABASE_ANON_KEY),
    secretKey: required("SUPABASE_SECRET_KEY", environment.SUPABASE_SECRET_KEY ?? environment.SUPABASE_SERVICE_ROLE_KEY),
  };
  const fixtureEnabled = fixtureModeAllowed(environment);
  const supabase = createSupabaseServerClient(config);
  const provider = fixtureEnabled
    ? createWeeklyCloneFixtureProvider(config, required("SUPPLY_FIXTURE_RUN_ID", environment.SUPPLY_FIXTURE_RUN_ID))
    : disabledWeeklyCloneProvider;
  const repository = createWeeklyCloneRepository(config);
  const resolvePrincipal = createVerifiedPrincipalResolver(supabase);
  return Object.freeze({
    provider,
    service: createWeeklyCloneService({ repository, provider, resolvePrincipal, mutationsEnabled: fixtureEnabled }),
  });
}
