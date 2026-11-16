/** Offline production configuration check. Reports variable NAMES and rules only; it never prints a value. */

export type PreflightResult = Readonly<{ ok: boolean; problems: readonly string[]; warnings: readonly string[] }>;
type Environment = Readonly<Record<string, string | undefined>>;

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const email = /^[^\s@<>",;]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,}$/;

function origin(value: string | undefined): "ok" | "missing" | "not_https" | "not_an_origin" {
  const v = value?.trim();
  if (!v) return "missing";
  try { const u = new URL(v); if (u.protocol !== "https:") return "not_https"; return u.origin === v && !u.username && !u.password ? "ok" : "not_an_origin"; } catch { return "not_an_origin"; }
}

export function checkProductionEnv(env: Environment): PreflightResult {
  const problems: string[] = [], warnings: string[] = [];
  const has = (name: string) => Boolean(env[name]?.trim());
  const need = (name: string) => { if (!has(name)) problems.push(`${name}: required but not set`); return has(name); };
  const bad = (name: string, rule: string) => problems.push(`${name}: ${rule}`);

  if (env.NODE_ENV !== "production") bad("NODE_ENV", "must be production");
  for (const name of ["APP_ORIGIN", "MARKETING_ORIGIN"]) {
    const r = origin(env[name]);
    if (r === "missing") problems.push(`${name}: required but not set`);
    else if (r === "not_https") bad(name, "must be an https origin");
    else if (r === "not_an_origin") bad(name, "must be exactly an origin: no path, query, credentials or trailing slash");
  }
  if (need("SUPABASE_URL")) {
    try { const u = new URL(env.SUPABASE_URL as string); if (u.protocol !== "https:" || ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname)) bad("SUPABASE_URL", "must be a hosted https project, not a local stack"); }
    catch { bad("SUPABASE_URL", "is not a valid URL"); }
  }
  const publishable = env.SUPABASE_PUBLISHABLE_KEY ?? env.SUPABASE_ANON_KEY, secret = env.SUPABASE_SECRET_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY;
  if (!publishable?.trim()) problems.push("SUPABASE_PUBLISHABLE_KEY: required but not set");
  if (!secret?.trim()) problems.push("SUPABASE_SECRET_KEY: required but not set");
  if (publishable && secret && publishable === secret) bad("SUPABASE_SECRET_KEY", "must differ from the publishable key");

  if (has("MAILPIT_URL")) bad("MAILPIT_URL", "must not be set in production (local capture only)");
  if (need("RESEND_API_KEY") && !/^re_[A-Za-z0-9_]{8,}$/.test(env.RESEND_API_KEY as string)) bad("RESEND_API_KEY", "does not look like a Resend key (re_…)");
  if (need("MAIL_FROM_EMAIL") && !email.test(env.MAIL_FROM_EMAIL as string)) bad("MAIL_FROM_EMAIL", "is not a valid address");

  const mode = env.STRIPE_MODE;
  if (mode !== "live" && mode !== "test") bad("STRIPE_MODE", "must be live or test");
  const sk = env.STRIPE_SECRET_KEY?.trim() ?? "", pk = env.STRIPE_PUBLISHABLE_KEY?.trim() ?? "", vpk = env.VITE_STRIPE_PUBLISHABLE_KEY?.trim() ?? "";
  const prefix = mode === "live" ? "live" : "test";
  if (!sk) problems.push("STRIPE_SECRET_KEY: required but not set"); else if (!sk.startsWith(`sk_${prefix}_`)) bad("STRIPE_SECRET_KEY", `must start with sk_${prefix}_ to match STRIPE_MODE`);
  if (!pk) problems.push("STRIPE_PUBLISHABLE_KEY: required but not set"); else if (!pk.startsWith(`pk_${prefix}_`)) bad("STRIPE_PUBLISHABLE_KEY", `must start with pk_${prefix}_ to match STRIPE_MODE`);
  if (!vpk) problems.push("VITE_STRIPE_PUBLISHABLE_KEY: required but not set (it is baked into the client at build time)"); else if (vpk !== pk) bad("VITE_STRIPE_PUBLISHABLE_KEY", "must equal STRIPE_PUBLISHABLE_KEY");
  if (need("STRIPE_WEBHOOK_SECRET") && !/^whsec_/.test(env.STRIPE_WEBHOOK_SECRET as string)) bad("STRIPE_WEBHOOK_SECRET", "must start with whsec_");

  for (const name of ["JOB_SECRET", "REFUND_WORKER_SECRET"]) if (need(name) && (env[name] as string).trim().length < 32) bad(name, "must be at least 32 characters");
  if (need("REFUND_WORKER_ID") && !uuid.test(env.REFUND_WORKER_ID as string)) bad("REFUND_WORKER_ID", "must be a UUID");

  for (const flag of ["CHECKOUT_FULFILLMENT_READY", "REFUND_WORKER_READY"]) {
    const v = env[flag];
    if (v !== "true" && v !== "false") bad(flag, "must be exactly true or false");
  }
  if (env.CHECKOUT_FULFILLMENT_READY === "true") warnings.push("CHECKOUT_FULFILLMENT_READY=true: guests can pay. Confirm the signed webhook endpoint and a dry run first.");
  if (env.REFUND_WORKER_READY === "true" && env.CHECKOUT_FULFILLMENT_READY !== "true") warnings.push("REFUND_WORKER_READY=true while checkout is off: only existing obligations can be refunded.");
  if (mode === "test" && env.CHECKOUT_FULFILLMENT_READY === "true") warnings.push("STRIPE_MODE=test with checkout ready: this is a staging configuration, not a launch one.");
  return { ok: problems.length === 0, problems, warnings };
}
