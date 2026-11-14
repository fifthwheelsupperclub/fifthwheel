/** W07.5 server-only composition. The worker is not exported through HTTP. */

import { randomUUID, timingSafeEqual } from "node:crypto";
import { env } from "node:process";
import { createVerifiedPrincipalResolver } from "./principal.server.ts";
import { createRefundRepository } from "./refunds.repository.server.ts";
import { createRefundService } from "./refunds.service.server.ts";
import { createStripeRefundProvider } from "./stripe.refunds.server.ts";
import { createSupplyTableAssignmentReader } from "./supply-table-assignment-reader.server.ts";
import type { SupabaseServerConfig } from "./supabase.server.ts";
import { createSupabaseServerClient } from "./supabase.server.ts";
import { createRefundHttpHandlers } from "./refunds.http.server.ts";
import { RefundProviderSafeError } from "./refunds.service.server.ts";

type Environment = Readonly<Record<string, string | undefined>>;
const text = (value: string | undefined): string => value?.trim() ?? "";
function required(name: string, value: string | undefined): string { const normalized = text(value); if (!normalized) throw new Error(`${name}_unavailable`); return normalized; }
function base(environment: Environment) {
  const config: SupabaseServerConfig = {
    url: required("SUPABASE_URL", environment.SUPABASE_URL),
    publishableKey: required("SUPABASE_PUBLISHABLE_KEY", environment.SUPABASE_PUBLISHABLE_KEY ?? environment.SUPABASE_ANON_KEY),
    secretKey: required("SUPABASE_SECRET_KEY", environment.SUPABASE_SECRET_KEY ?? environment.SUPABASE_SERVICE_ROLE_KEY),
  };
  const repo = createRefundRepository(config);
  const rawMode = text(environment.STRIPE_MODE);
  const mode: "test" | "live" = rawMode === "live" ? "live" : "test";
  const secret = text(environment.STRIPE_SECRET_KEY);
  const modeValid = rawMode === "test" || rawMode === "live";
  const secretReady = modeValid && secret.startsWith(mode === "test" ? "sk_test_" : "sk_live_");
  const fulfillmentReady = text(environment.CHECKOUT_FULFILLMENT_READY) === "true";
  const workerReady = text(environment.REFUND_WORKER_READY) === "true";
  const providerAvailable = secretReady && fulfillmentReady && workerReady;
  const provider = providerAvailable ? createStripeRefundProvider({ secretKey: secret, mode }) : Object.freeze({
    async createRefund(): Promise<never> { throw new RefundProviderSafeError("provider_unavailable", false); },
    async retrieveRefund(): Promise<never> { throw new RefundProviderSafeError("provider_unavailable", false); },
  });
  const supabase = createSupabaseServerClient(config);
  const resolvePrincipal = createVerifiedPrincipalResolver(supabase, createSupplyTableAssignmentReader(config));
  return { repo, provider, providerAvailable, resolvePrincipal };
}

export function createRefundRuntime(environment: Environment = env) {
  const deps = base(environment);
  return createRefundService({ resolvePrincipal: deps.resolvePrincipal, repository: deps.repo,
    provider: deps.provider, providerAvailable: deps.providerAvailable });
}

export function createRefundHttpRuntime(environment: Environment = env) {
  const appOrigin = required("APP_ORIGIN", environment.APP_ORIGIN);
  return createRefundHttpHandlers(() => createRefundRuntime(environment), appOrigin);
}

/** Trusted scheduler/CLI composition. Caller must present the configured worker secret; no HTTP route uses this. */
export function createRefundWorkerRuntime(presentedSecret: string, environment: Environment = env) {
  const expected = required("REFUND_WORKER_SECRET", environment.REFUND_WORKER_SECRET);
  const actualBytes = Buffer.from(presentedSecret, "utf8"), expectedBytes = Buffer.from(expected, "utf8");
  if (actualBytes.length !== expectedBytes.length || actualBytes.length < 32 || !timingSafeEqual(actualBytes, expectedBytes)) throw new Error("refund_worker_unauthorized");
  const deps = base(environment);
  const service = createRefundService({ resolvePrincipal: deps.resolvePrincipal, repository: deps.repo,
    provider: deps.provider, providerAvailable: deps.providerAvailable });
  const workerId = text(environment.REFUND_WORKER_ID);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(workerId)) throw new Error("refund_worker_id_invalid");
  return Object.freeze({ async runOnce(limit = 10) { return service.runWorkerOnce({ workerId, limit }); } });
}
