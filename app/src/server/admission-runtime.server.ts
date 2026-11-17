/** Shared, server-only local admission/auth composition. */

import { env } from "node:process";
import { createAdmissionRepository } from "./admission.repository.server.ts";
import { createResendEmail } from "./email.resend.server.ts";
import { createMailpitMagicLinkEmailProvider } from "./admission.email.mailpit.server.ts";
import { createSupabaseAuthLinkProvider } from "./auth.link.supabase.server.ts";
import { createMemberLinkRepository } from "./member-link.repository.server.ts";
import { createVerifiedPrincipalResolver } from "./principal.server.ts";
import { createSupabaseServerClient, type SupabaseServerConfig } from "./supabase.server.ts";

function required(name: string, value: string | undefined): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${name}_unavailable`);
  return normalized;
}

export function createAdmissionRuntime() {
  const config: SupabaseServerConfig = {
    url: required("SUPABASE_URL", env.SUPABASE_URL),
    publishableKey: required("SUPABASE_PUBLISHABLE_KEY", env.SUPABASE_PUBLISHABLE_KEY ?? env.SUPABASE_ANON_KEY),
    secretKey: required("SUPABASE_SECRET_KEY", env.SUPABASE_SECRET_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY),
  };
  const appOrigin = required("APP_ORIGIN", env.APP_ORIGIN);
  const callback = new URL("/auth/callback", appOrigin).href;
  const authProvider = createSupabaseAuthLinkProvider({
    url: config.url,
    publishableKey: config.publishableKey,
    secretKey: config.secretKey,
    siteUrl: appOrigin,
    allowedCallbackUrls: [callback],
  });
  const fromName = env.MAIL_FROM_NAME?.trim();
  const resend = env.RESEND_API_KEY?.trim()
    ? createResendEmail({ apiKey: env.RESEND_API_KEY.trim(), fromEmail: required("MAIL_FROM_EMAIL", env.MAIL_FROM_EMAIL), ...(fromName ? { fromName } : {}), appOrigin })
    : null;
  const mailpitConfig = resend ? null : {
    baseUrl: required("MAILPIT_URL", env.MAILPIT_URL),
    fromEmail: required("MAIL_FROM_EMAIL", env.MAIL_FROM_EMAIL),
    ...(fromName ? { fromName } : {}),
  };
  const supabase = createSupabaseServerClient(config);
  const admissionRepository = createAdmissionRepository(config);
  return Object.freeze({
    config,
    appOrigin,
    callback,
    authProvider,
    supabase,
    admissionRepository,
    magicLinkEmailProvider: resend ? resend.magicLink : createMailpitMagicLinkEmailProvider(mailpitConfig!),
    memberLinkRepository: createMemberLinkRepository(config),
    resolvePrincipal: createVerifiedPrincipalResolver(supabase),
  });
}
