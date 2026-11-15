/** W07.1 server composition. Missing/unapproved disclosure disables begin safely. */

import { env } from "node:process";
import { createVerifiedPrincipalResolver } from "./principal.server.ts";
import { createCheckoutRepository } from "./checkout.repository.server.ts";
import { createCheckoutService } from "./checkout.service.server.ts";
import { createStripeEmbeddedCheckoutProvider } from "./stripe.checkout.server.ts";
import { createSupplyTableAssignmentReader } from "./supply-table-assignment-reader.server.ts";
import type { SupabaseServerConfig } from "./supabase.server.ts";
import { createSupabaseServerClient } from "./supabase.server.ts";
import { createCheckoutHttpHandlers } from "./checkout.http.server.ts";
import { createCheckoutWebhookService } from "./checkout-fulfillment.server.ts";
import { createCheckoutWebhookHttpHandler } from "./checkout-webhook.http.server.ts";

type Environment = Readonly<Record<string, string | undefined>>;
const text = (x: string | undefined): string => x?.trim() ?? "";
function required(name: string, value: string | undefined): string {
  const x = text(value); if (!x) throw new Error(`${name}_unavailable`); return x;
}
const CHECKOUT_DISCLOSURE = Object.freeze({ version: "seat-checkout-v1",
  text: "I understand I’ll be charged $25 for this Seat. The Seat is confirmed only after payment succeeds. If I cancel, an admin decides whether the refund is full, partial, or none.",
  requiresAcknowledgement: true });

export function createCheckoutRuntime(environment: Environment = env) {
  const config: SupabaseServerConfig = {
    url: required("SUPABASE_URL", environment.SUPABASE_URL),
    publishableKey: required("SUPABASE_PUBLISHABLE_KEY", environment.SUPABASE_PUBLISHABLE_KEY ?? environment.SUPABASE_ANON_KEY),
    secretKey: required("SUPABASE_SECRET_KEY", environment.SUPABASE_SECRET_KEY ?? environment.SUPABASE_SERVICE_ROLE_KEY),
  };
  const supabase = createSupabaseServerClient(config);
  const resolvePrincipal = createVerifiedPrincipalResolver(supabase, createSupplyTableAssignmentReader(config));
  const rawMode = text(environment.STRIPE_MODE);
  const mode: "test" | "live" = rawMode === "live" ? "live" : "test";
  const secretKey = text(environment.STRIPE_SECRET_KEY);
  const expectedSecretPrefix = mode === "test" ? "sk_test_" : "sk_live_";
  const expectedPublicPrefix = mode === "test" ? "pk_test_" : "pk_live_";
  const providerConfigured = (rawMode === "test" || rawMode === "live") && secretKey.startsWith(expectedSecretPrefix);
  const providerPublicConfigured = text(environment.STRIPE_PUBLISHABLE_KEY).startsWith(expectedPublicPrefix);
  const webhookSecret = text(environment.STRIPE_WEBHOOK_SECRET);
  const fulfillmentReady = providerConfigured && providerPublicConfigured && webhookSecret.startsWith("whsec_") && webhookSecret.length >= 24
    && text(environment.CHECKOUT_FULFILLMENT_READY) === "true";
  const provider = providerConfigured
    ? createStripeEmbeddedCheckoutProvider({ secretKey, mode })
    : Object.freeze({
        async createSession(): Promise<never> { throw new Error("provider_unavailable"); },
        async retrieveSession(): Promise<never> { throw new Error("provider_unavailable"); },
      });
  return createCheckoutService({
    resolvePrincipal,
    repository: createCheckoutRepository(config),
    provider,
    disclosure: CHECKOUT_DISCLOSURE,
    mode,
    providerConfigured,
    fulfillmentReady,
    publishableKey: fulfillmentReady ? text(environment.STRIPE_PUBLISHABLE_KEY) : null,
    appOrigin: required("APP_ORIGIN", environment.APP_ORIGIN),
  });
}

export function createCheckoutHttpRuntime(environment: Environment = env) {
  const appOrigin = required("APP_ORIGIN", environment.APP_ORIGIN);
  return createCheckoutHttpHandlers(() => createCheckoutRuntime(environment), appOrigin);
}

export function createCheckoutWebhookHttpRuntime(environment: Environment = env) {
  return createCheckoutWebhookHttpHandler(() => {
    const modeText = text(environment.STRIPE_MODE);
    const mode = modeText === "test" || modeText === "live" ? modeText : null;
    const secretKey = text(environment.STRIPE_SECRET_KEY);
    const webhookSecret = text(environment.STRIPE_WEBHOOK_SECRET);
    const publishableKey = text(environment.STRIPE_PUBLISHABLE_KEY);
    if (!mode || !secretKey.startsWith(mode === "test" ? "sk_test_" : "sk_live_")
      || !publishableKey.startsWith(mode === "test" ? "pk_test_" : "pk_live_")
      || !webhookSecret.startsWith("whsec_") || webhookSecret.length < 24
      || text(environment.CHECKOUT_FULFILLMENT_READY) !== "true") return null;
    const config: SupabaseServerConfig = {
      url: required("SUPABASE_URL", environment.SUPABASE_URL),
      publishableKey: required("SUPABASE_PUBLISHABLE_KEY", environment.SUPABASE_PUBLISHABLE_KEY ?? environment.SUPABASE_ANON_KEY),
      secretKey: required("SUPABASE_SECRET_KEY", environment.SUPABASE_SECRET_KEY ?? environment.SUPABASE_SERVICE_ROLE_KEY),
    };
    const provider = createStripeEmbeddedCheckoutProvider({ secretKey, mode });
    return createCheckoutWebhookService({ repository: createCheckoutRepository(config), provider, secret: webhookSecret, mode });
  });
}
