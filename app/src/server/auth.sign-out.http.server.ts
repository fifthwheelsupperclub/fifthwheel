/** Current-device sign-out: revoke its Supabase session, then clear app cookies. */

import { assertExactOrigin } from "./origin.server.ts";
import { buildClearSessionCookieHeaders, getAccessTokenForPrincipal } from "./session.cookies.server.ts";

export type SignOutConfig = Readonly<{ supabaseUrl: string; publishableKey: string; appOrigin: string }>;

function safeAuthUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    const localHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
    if ((url.protocol !== "https:" && !(url.protocol === "http:" && localHosts.has(url.hostname)))
      || url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
    return url;
  } catch { return null; }
}

export function createSignOutPostHandler(config: SignOutConfig, fetcher: typeof fetch = globalThis.fetch) {
  return async (request: Request): Promise<Response> => {
    const origin = assertExactOrigin(request, config.appOrigin);
    const headers = new Headers({ "cache-control": "no-store", vary: "Cookie, Origin" });
    if (!origin.allowed) return Response.json({ error: { code: "origin_rejected", message: "This request could not be accepted." } }, { status: 403, headers });
    if (request.method !== "POST") return Response.json({ error: { code: "method_not_allowed", message: "Use POST to sign out." } }, { status: 405, headers });

    let clearCookies: readonly [string, string];
    try { clearCookies = buildClearSessionCookieHeaders(config.appOrigin); }
    catch { return Response.json({ error: { code: "temporarily_unavailable", message: "Sign-out is temporarily unavailable." } }, { status: 503, headers }); }

    const accessToken = getAccessTokenForPrincipal(request);
    if (!accessToken) {
      for (const cookie of clearCookies) headers.append("set-cookie", cookie);
      return Response.json({ signedOut: true, sessionRevocation: "not-needed" }, { status: 200, headers });
    }

    const authUrl = safeAuthUrl(config.supabaseUrl);
    if (!authUrl || typeof config.publishableKey !== "string" || !config.publishableKey.trim()) {
      for (const cookie of clearCookies) headers.append("set-cookie", cookie);
      return Response.json({ signedOut: true, sessionRevocation: "unknown" }, { status: 503, headers });
    }

    let response: Response;
    try {
      const endpoint = new URL("/auth/v1/logout?scope=local", authUrl);
      response = await fetcher(endpoint, {
        method: "POST",
        headers: {
          apikey: config.publishableKey.trim(),
          authorization: `Bearer ${accessToken}`,
          accept: "application/json",
        },
        cache: "no-store",
        redirect: "error",
      });
    } catch {
      for (const cookie of clearCookies) headers.append("set-cookie", cookie);
      return Response.json({ signedOut: true, sessionRevocation: "unknown" }, { status: 503, headers });
    }

    for (const cookie of clearCookies) headers.append("set-cookie", cookie);
    if (response.ok || response.status === 401 || response.status === 403 || response.status === 404) {
      // Supabase revokes the local refresh session; issued access JWTs still
      // remain valid until expiry, and the app cookies are cleared in response.
      return Response.json({ signedOut: true, sessionRevocation: "confirmed" }, { status: 200, headers });
    }
    return Response.json({ signedOut: true, sessionRevocation: "unknown" }, { status: 503, headers });
  };
}
