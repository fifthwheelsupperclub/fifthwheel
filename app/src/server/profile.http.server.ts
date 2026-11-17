/** Same-origin HTTP boundary for the member profile service. */

import { getAccessTokenForPrincipal } from "./session.cookies.server.ts";
import { assertExactOrigin } from "./origin.server.ts";
import type { ProfileServicePort, ProfileServiceResult } from "./profile.contract.server.ts";
import type { MemberProfileSaveRequest } from "../profile.contract.ts";

type HttpDependencies = Readonly<{ service: () => ProfileServicePort; appOrigin: string | undefined }>;
type Handler = (request: Request) => Promise<Response>;

function jsonResponse(body: unknown, status: number, extra: Record<string, string> = {}): Response {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "private, no-store",
      "referrer-policy": "no-referrer",
      "vary": "Cookie",
      ...extra,
    },
  });
}

function statusFor<T>(result: ProfileServiceResult<T>): number {
  if (result.ok) return 200;
  switch (result.code) {
    case "unauthenticated": return 401;
    case "forbidden": return 403;
    case "not_found": return 404;
    case "invalid_input": return 400;
    case "conflict": return 409;
    case "temporarily_unavailable": return 503;
  }
}

function unavailable(): Response {
  return jsonResponse({
    ok: false,
    code: "temporarily_unavailable",
    message: "This profile service is temporarily unavailable. Try again shortly.",
    retryable: true,
    correlationId: crypto.randomUUID(),
  }, 503);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  const length = request.headers.get("content-length");
  if (length && (!/^\d{1,6}$/.test(length) || Number(length) > 65536)) return null;
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 65536) {
        await reader.cancel("json_body_too_large").catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    return isRecord(value) ? value : null;
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}

function originError(request: Request, expectedOrigin: string | undefined): Response | null {
  const result = assertExactOrigin(request, expectedOrigin);
  if (result.allowed) return null;
  return jsonResponse({
    ok: false,
    code: "forbidden",
    message: "This request origin is not allowed.",
    retryable: false,
    correlationId: crypto.randomUUID(),
  }, 403);
}

function createHandler(dependencies: HttpDependencies, method: (service: ProfileServicePort, request: Request, payload: Record<string, unknown> | null) => Promise<ProfileServiceResult<unknown>>, options: Readonly<{ mutating?: boolean }> = {}): Handler {
  return async (request) => {
    if (options.mutating) {
      const denied = originError(request, dependencies.appOrigin);
      if (denied) return denied;
    }
    const payload = request.method === "GET"
      ? null
      : request.headers.get("content-type")?.includes("application/json") ? await readJson(request) : null;
    try {
      const result = await method(dependencies.service(), request, payload);
      return jsonResponse(result, statusFor(result));
    } catch {
      return unavailable();
    }
  };
}

export function createProfileHttpHandlers(dependencies: HttpDependencies) {
  return Object.freeze({
    memberGet: createHandler(dependencies, async (service, request) => service.readMemberProfile(getAccessTokenForPrincipal(request))),
    memberSave: createHandler(dependencies, async (service, request, payload) =>
      payload ? service.saveMemberProfile(getAccessTokenForPrincipal(request), payload as unknown as MemberProfileSaveRequest)
        : { ok: false, code: "invalid_input", message: "Submit a valid profile.", retryable: false, correlationId: crypto.randomUUID() },
    { mutating: true }),
  });
}
