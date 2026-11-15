/** Server-only HttpOnly cookie helpers for Supabase access/refresh sessions. */

export const ACCESS_TOKEN_COOKIE = "fw_access_token";
export const REFRESH_TOKEN_COOKIE = "fw_refresh_token";

export type SessionCookieTokens = Readonly<{
  accessToken: string;
  refreshToken: string;
}>;

export type ParsedSessionCookies = Readonly<{
  accessToken?: string;
  refreshToken?: string;
}>;

/*
 * SameSite=Lax is defense in depth, not the CSRF check. Every state-changing
 * cookie-authenticated route must compare the request Origin to the configured
 * app origin exactly (scheme, host, and port) before mutation; do not trust forwarded headers.
 */

const maxCookieHeaderLength = 16_384;
const maxAccessTokenLength = 8_192;
const maxRefreshTokenLength = 4_096;
const jwtPattern = /^[A-Za-z0-9_-]{1,4096}\.[A-Za-z0-9_-]{1,4096}\.[A-Za-z0-9_-]{1,4096}$/;
const refreshTokenPattern = /^[A-Za-z0-9._~-]{12,4096}$/;
const cookieNamePattern = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

function parseRequestUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError("invalid_cookie_origin");
  }
  if (
    url.username !== ""
    || url.password !== ""
    || (url.protocol !== "https:" && url.protocol !== "http:")
  ) {
    throw new TypeError("invalid_cookie_origin");
  }
  // A non-Secure cookie is permitted only for the explicit local HTTP app.
  // Never derive this from X-Forwarded-Proto or a client-controlled Origin header.
  if (url.protocol === "http:" && !new Set(["localhost", "127.0.0.1", "[::1]"]).has(url.hostname)) {
    throw new TypeError("insecure_cookie_origin");
  }
  return url;
}

function isValidAccessToken(value: string): boolean {
  return value.length <= maxAccessTokenLength && jwtPattern.test(value);
}

function isValidRefreshToken(value: string): boolean {
  return value.length <= maxRefreshTokenLength && refreshTokenPattern.test(value);
}

function cookieFlags(requestUrl: string): string {
  const origin = parseRequestUrl(requestUrl);
  return `Path=/; HttpOnly; SameSite=Lax${origin.protocol === "https:" ? "; Secure" : ""}`;
}

/** Returns two Set-Cookie values. Neither token is ever returned to browser code. */
export function buildSessionCookieHeaders(tokens: SessionCookieTokens, requestUrl: string): readonly [string, string] {
  if (!isValidAccessToken(tokens.accessToken) || !isValidRefreshToken(tokens.refreshToken)) {
    throw new TypeError("invalid_session_token");
  }
  const flags = cookieFlags(requestUrl);
  return Object.freeze([
    `${ACCESS_TOKEN_COOKIE}=${tokens.accessToken}; ${flags}`,
    `${REFRESH_TOKEN_COOKIE}=${tokens.refreshToken}; ${flags}`,
  ] as const);
}

/** Clear both cookies using the same scope and security flags used when setting them. */
export function buildClearSessionCookieHeaders(requestUrl: string): readonly [string, string] {
  const flags = cookieFlags(requestUrl);
  return Object.freeze([
    `${ACCESS_TOKEN_COOKIE}=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; ${flags}`,
    `${REFRESH_TOKEN_COOKIE}=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; ${flags}`,
  ] as const);
}

/**
 * Parses only the app's session cookies. Any malformed pair, duplicate session
 * cookie, or invalid session token fails closed as `null`; unrelated valid cookies
 * are ignored. Cookie values are not URL-decoded.
 */
export function parseSessionCookies(cookieHeader: string | null | undefined): ParsedSessionCookies | null {
  if (typeof cookieHeader !== "string" || cookieHeader.length === 0) return Object.freeze({});
  if (cookieHeader.length > maxCookieHeaderLength) return null;

  let accessToken: string | undefined;
  let refreshToken: string | undefined;
  for (const rawPart of cookieHeader.split(";")) {
    const part = rawPart.trim();
    if (part.length === 0) continue;
    const equalsIndex = part.indexOf("=");
    if (equalsIndex <= 0) return null;
    const name = part.slice(0, equalsIndex).trim();
    const value = part.slice(equalsIndex + 1).trim();
    if (!cookieNamePattern.test(name) || value.length === 0 || /[\s;,]/.test(value)) return null;

    if (name === ACCESS_TOKEN_COOKIE) {
      if (accessToken !== undefined || !isValidAccessToken(value)) return null;
      accessToken = value;
    } else if (name === REFRESH_TOKEN_COOKIE) {
      if (refreshToken !== undefined || !isValidRefreshToken(value)) return null;
      refreshToken = value;
    }
  }
  return Object.freeze({
    ...(accessToken ? { accessToken } : {}),
    ...(refreshToken ? { refreshToken } : {}),
  });
}

/** Only the access token crosses into the verified-principal resolver. */
export function getAccessTokenForPrincipal(request: Request): string | null {
  const parsed = parseSessionCookies(request.headers.get("cookie"));
  return parsed?.accessToken ?? null;
}
