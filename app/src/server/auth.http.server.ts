/** Server-only HTTP adapters for request-link and explicit callback verification. */

import type { AuthService } from "./auth.service.server.ts";
import { assertExactOrigin } from "./origin.server.ts";
import { buildSessionCookieHeaders, getAccessTokenForPrincipal } from "./session.cookies.server.ts";

const maxBodyBytes = 8_192;

async function readBody(request: Request): Promise<unknown | null> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return null;
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBodyBytes) return null;
  try { return JSON.parse(text) as unknown; } catch { return null; }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorResponse(status: number, code: string, message: string, headers: HeadersInit = {}): Response {
  return Response.json({ error: { code, message } }, { status, headers: { "cache-control": "no-store", ...Object.fromEntries(new Headers(headers).entries()) } });
}

function statusFor(code: string): number {
  if (code === "validation_failed") return 400;
  if (code === "unauthenticated") return 401;
  if (code === "forbidden") return 403;
  if (code === "not_found") return 404;
  if (code === "rate_limited") return 429;
  if (code === "conflict") return 409;
  if (code === "invalid_link") return 400;
  return 503;
}

export function createAuthHttpHandlers(service: AuthService, appOrigin: string) {
  async function requestLink(request: Request): Promise<Response> {
    const origin = assertExactOrigin(request, appOrigin);
    if (!origin.allowed) return errorResponse(403, "origin_rejected", "This request could not be accepted.");
    const body = await readBody(request);
    if (!isRecord(body) || typeof body.email !== "string") return errorResponse(400, "validation_failed", "Enter a valid email address.");
    try {
      const result = await service.requestLink({ email: body.email, safeReturnTo: typeof body.safeReturnTo === "string" ? body.safeReturnTo : undefined });
      if (!result.ok) return errorResponse(statusFor(result.error.code), result.error.code, result.error.safeMessage);
      return Response.json(result.value, { status: 200, headers: { "cache-control": "no-store" } });
    } catch {
      return errorResponse(503, "temporarily_unavailable", "Your sign-in link could not be requested. Try again.");
    }
  }

  async function verifyLink(request: Request): Promise<Response> {
    const origin = assertExactOrigin(request, appOrigin);
    if (!origin.allowed) return errorResponse(403, "origin_rejected", "This request could not be accepted.");
    const body = await readBody(request);
    if (!isRecord(body) || typeof body.tokenHash !== "string" || typeof body.kind !== "string") {
      return errorResponse(400, "invalid_link", "This sign-in link is invalid or has expired.");
    }
    const kind = body.kind;
    if (kind !== "invite" && kind !== "magiclink") return errorResponse(400, "invalid_link", "This sign-in link is invalid or has expired.");
    try {
      const result = await service.verifyLink({
        tokenHash: body.tokenHash,
        kind,
        safeReturnTo: typeof body.safeReturnTo === "string" ? body.safeReturnTo : undefined,
        existingAccessToken: getAccessTokenForPrincipal(request),
      });
      if (!result.ok) return errorResponse(statusFor(result.error.code), result.error.code, result.error.safeMessage);
      // Cookie scope/security derives from trusted deployment config, never Host
      // or forwarded headers. Production must set HTTPS APP_ORIGIN.
      const cookies = buildSessionCookieHeaders(result.value.session, appOrigin);
      const headers = new Headers({ "cache-control": "no-store", location: result.value.nextPath });
      for (const cookie of cookies) headers.append("set-cookie", cookie);
      return Response.json({ nextPath: result.value.nextPath }, { status: 200, headers });
    } catch {
      return errorResponse(503, "temporarily_unavailable", "Sign-in could not be completed. Request a new link and try again.");
    }
  }

  return Object.freeze({ requestLink, verifyLink });
}
