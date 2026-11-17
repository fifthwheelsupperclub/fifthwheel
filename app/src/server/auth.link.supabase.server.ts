/**
 * Server-only Supabase Auth link adapter. Keep action links, token hashes,
 * sessions, and secret keys out of browser modules and logs.
 */

import type { AuthLinkProvider, MagicLinkKind } from "./admission.contracts.server.ts";

export type SupabaseAuthLinkConfig = Readonly<{
  url: string;
  publishableKey: string;
  secretKey: string;
  siteUrl: string;
  allowedCallbackUrls: readonly string[];
}>;

export type SupabaseAuthLinkErrorCode =
  | "configuration_invalid"
  | "input_invalid"
  | "provider_rejected"
  | "provider_outcome_unknown"
  | "provider_data_invalid";

export class SupabaseAuthLinkError extends Error {
  readonly code: SupabaseAuthLinkErrorCode;

  constructor(code: SupabaseAuthLinkErrorCode) {
    super(code);
    this.name = "SupabaseAuthLinkError";
    this.code = code;
  }
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const mailboxLocalPart = "[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*";
const mailboxDomainLabel = "[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?";
const emailPattern = new RegExp(`^${mailboxLocalPart}@${mailboxDomainLabel}(?:\\.${mailboxDomainLabel})+$`);
const tokenHashPattern = /^[A-Za-z0-9_-]{16,512}$/;
const supportedKinds = new Set<MagicLinkKind>(["magiclink", "invite"]);
const localHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizedEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length <= 320 && emailPattern.test(email) ? email : null;
}

// https for any host (hosted Supabase and the production app origin); plain http only for loopback (the local stack).
function parseServiceUrl(value: string): URL | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (
    (url.protocol !== "https:" && !(url.protocol === "http:" && localHosts.has(url.hostname)))
    || url.username !== ""
    || url.password !== ""
    || url.search !== ""
    || url.hash !== ""
  ) return null;
  return url;
}

function validateConfig(config: SupabaseAuthLinkConfig): Readonly<{ authUrl: URL; callbackUrl: string }> {
  const authUrl = parseServiceUrl(config.url);
  const siteUrl = parseServiceUrl(config.siteUrl);
  if (
    !authUrl
    || authUrl.pathname !== "/"
    || !siteUrl
    || siteUrl.pathname !== "/"
    || typeof config.publishableKey !== "string"
    || config.publishableKey.trim().length === 0
    || typeof config.secretKey !== "string"
    || config.secretKey.trim().length === 0
    || config.publishableKey.trim() === config.secretKey.trim()
  ) throw new SupabaseAuthLinkError("configuration_invalid");

  const callbackUrl = new URL("/auth/callback", siteUrl).href;
  if (
    !Array.isArray(config.allowedCallbackUrls)
    || config.allowedCallbackUrls.length !== 1
    || config.allowedCallbackUrls[0] !== callbackUrl
  ) throw new SupabaseAuthLinkError("configuration_invalid");

  return { authUrl, callbackUrl };
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json() as unknown;
  } catch {
    throw new SupabaseAuthLinkError("provider_data_invalid");
  }
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value));
}

function validateActionLink(
  value: unknown,
  authUrl: URL,
  callbackUrl: string,
  kind: MagicLinkKind,
): value is string {
  if (typeof value !== "string" || value.length > 4096) return false;
  let link: URL;
  try {
    link = new URL(value);
  } catch {
    return false;
  }
  return link.origin === authUrl.origin
    && link.pathname === "/auth/v1/verify"
    && link.username === ""
    && link.password === ""
    && link.hash === ""
    && link.searchParams.get("type") === kind
    && (link.searchParams.has("token") || link.searchParams.has("token_hash"))
    && (link.searchParams.get("token") ?? link.searchParams.get("token_hash") ?? "").length >= 16
    && link.searchParams.get("redirect_to") === callbackUrl;
}

function isKind(value: unknown): value is MagicLinkKind {
  return typeof value === "string" && supportedKinds.has(value as MagicLinkKind);
}

function safeReturnPath(value: string | undefined, callbackUrl: string): string | null {
  if (value === undefined) return null;
  if (value.length > 2048 || !value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(value)) {
    throw new SupabaseAuthLinkError("input_invalid");
  }
  const parsed = new URL(value, callbackUrl);
  if (parsed.origin !== new URL(callbackUrl).origin) throw new SupabaseAuthLinkError("input_invalid");
  return `${parsed.pathname}${parsed.search}`;
}

/**
 * The callback is deliberately local-only. Production Auth links must be
 * introduced through a separately reviewed provider/config adapter.
 */
export function createSupabaseAuthLinkProvider(
  config: SupabaseAuthLinkConfig,
  fetcher: typeof fetch = globalThis.fetch,
): AuthLinkProvider {
  const { authUrl, callbackUrl } = validateConfig(config);

  return Object.freeze({
    async createMagicLink(input: Parameters<AuthLinkProvider["createMagicLink"]>[0]): Promise<Readonly<{ actionLink: string; authUserId: string }>> {
      const email = normalizedEmail(input.emailNormalized);
      if (!email || email !== input.emailNormalized || !isKind(input.kind) || input.redirectTo !== callbackUrl) {
        throw new SupabaseAuthLinkError("input_invalid");
      }

      const endpoint = new URL("/auth/v1/admin/generate_link", authUrl);
      let response: Response;
      try {
        response = await fetcher(endpoint, {
          method: "POST",
          headers: {
            apikey: config.secretKey,
            authorization: `Bearer ${config.secretKey}`,
            "content-type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify({ type: input.kind, email, redirect_to: callbackUrl }),
          cache: "no-store",
          redirect: "error",
        });
      } catch {
        throw new SupabaseAuthLinkError("provider_outcome_unknown");
      }
      if (!response.ok) {
        throw new SupabaseAuthLinkError(response.status >= 500 ? "provider_outcome_unknown" : "provider_rejected");
      }

      const payload = await readJson(response);
      if (!isRecord(payload)) throw new SupabaseAuthLinkError("provider_data_invalid");
      const userId = payload.id;
      const responseEmail = normalizedEmail(payload.email);
      const hashedToken = payload.hashed_token;
      if (
        typeof userId !== "string"
        || !uuidPattern.test(userId)
        || responseEmail !== email
        || payload.verification_type !== input.kind
        || payload.redirect_to !== callbackUrl
        || !validateActionLink(payload.action_link, authUrl, callbackUrl, input.kind)
        || typeof hashedToken !== "string"
        || !tokenHashPattern.test(hashedToken)
      ) throw new SupabaseAuthLinkError("provider_data_invalid");

      // The generated Auth action_link performs a browser GET that redirects
      // with URL-fragment tokens. Our server-side callback needs a token hash
      // in a same-origin URL so it can explicitly POST it to Auth `/verify`.
      const appCallback = new URL(callbackUrl);
      appCallback.searchParams.set("token_hash", hashedToken);
      appCallback.searchParams.set("type", input.kind);
      const nextPath = safeReturnPath(input.safeReturnTo, callbackUrl);
      if (nextPath) appCallback.searchParams.set("safeReturnTo", nextPath);
      return { actionLink: appCallback.href, authUserId: userId };
    },

    async verifyCallback(input: Parameters<AuthLinkProvider["verifyCallback"]>[0]): Promise<Readonly<{
      identity: Readonly<{ authUserId: string; emailNormalized: string; emailVerified: boolean }>;
      session: Readonly<{ accessToken: string; refreshToken: string }>;
    }>> {
      if (
        !isKind(input.kind)
        || typeof input.tokenHash !== "string"
        || !tokenHashPattern.test(input.tokenHash)
      ) throw new SupabaseAuthLinkError("input_invalid");

      let response: Response;
      try {
        response = await fetcher(new URL("/auth/v1/verify", authUrl), {
          method: "POST",
          headers: {
            apikey: config.publishableKey,
            "content-type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify({ token_hash: input.tokenHash, type: input.kind }),
          cache: "no-store",
          redirect: "error",
        });
      } catch {
        throw new SupabaseAuthLinkError("provider_outcome_unknown");
      }
      if (!response.ok) {
        throw new SupabaseAuthLinkError(response.status >= 500 ? "provider_outcome_unknown" : "provider_rejected");
      }

      let payload: unknown;
      try {
        payload = await readJson(response);
      } catch {
        throw new SupabaseAuthLinkError("provider_data_invalid");
      }
      if (!isRecord(payload) || !isRecord(payload.user)) {
        throw new SupabaseAuthLinkError("provider_data_invalid");
      }
      const user = payload.user;
      const email = normalizedEmail(user.email);
      const emailVerified = isIsoTimestamp(user.email_confirmed_at) || isIsoTimestamp(user.confirmed_at);
      if (
        typeof user.id !== "string"
        || !uuidPattern.test(user.id)
        || !email
        || !emailVerified
        || typeof payload.access_token !== "string"
        || payload.access_token.length < 16
        || payload.access_token.length > 16_384
        || typeof payload.refresh_token !== "string"
        || payload.refresh_token.length < 12
        || payload.refresh_token.length > 16_384
      ) throw new SupabaseAuthLinkError("provider_data_invalid");

      return {
        identity: { authUserId: user.id as string, emailNormalized: email as string, emailVerified: true },
        session: { accessToken: payload.access_token as string, refreshToken: payload.refresh_token as string },
      };
    },
  });
}
