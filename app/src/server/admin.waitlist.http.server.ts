/** HTTP boundary for the protected admin waitlist search route. */

import type { AdmissionService, AdminWaitlistSearchInput } from "./admission.service.server.ts";
import type { ServiceError } from "./admission.contracts.server.ts";
import { getAccessTokenForPrincipal } from "./session.cookies.server.ts";
import { assertExactOrigin } from "./origin.server.ts";

type WaitlistSearchService = Pick<AdmissionService, "searchWaitlist">;
type ServiceFactory = () => WaitlistSearchService;
type ParsedSearch = Omit<AdminWaitlistSearchInput, "accessToken">;
type WaitlistInviteService = Pick<AdmissionService, "admitWaitlistMember">;
type InviteServiceFactory = () => WaitlistInviteService;

const acceptedQueryKeys = new Set(["query", "neighborhood", "cursor", "limit"]);
const neighborhoods = new Set(["Inman Park", "Chamblee", "Virginia Highlands"]);

type ParseResult = Readonly<{ ok: true; value: ParsedSearch }> | Readonly<{ ok: false }>;

function parseSearch(url: URL): ParseResult {
  for (const key of url.searchParams.keys()) {
    if (!acceptedQueryKeys.has(key) || url.searchParams.getAll(key).length !== 1) return { ok: false };
  }

  const queryValue = url.searchParams.get("query") ?? undefined;
  const neighborhoodValue = url.searchParams.get("neighborhood") ?? undefined;
  const cursor = url.searchParams.get("cursor") ?? undefined;
  const limitValue = url.searchParams.get("limit") ?? "25";

  if (
    (queryValue !== undefined && (queryValue.length > 120 || /[\u0000-\u001f\u007f]/.test(queryValue)))
    || (neighborhoodValue !== undefined && neighborhoodValue !== "" && !neighborhoods.has(neighborhoodValue))
    || (cursor !== undefined && (cursor.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(cursor)))
    || !/^(?:[1-9]\d?|100)$/.test(limitValue)
  ) return { ok: false };

  return {
    ok: true,
    value: {
      ...(queryValue !== undefined ? { query: queryValue } : {}),
      ...(neighborhoodValue !== undefined ? { neighborhood: neighborhoodValue } : {}),
      ...(cursor !== undefined ? { cursor } : {}),
      limit: Number(limitValue),
    },
  };
}

function response(
  body: unknown,
  status: number,
  extraHeaders: HeadersInit = {},
): Response {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      vary: "Cookie",
      ...Object.fromEntries(new Headers(extraHeaders).entries()),
    },
  });
}

function statusForError(error: ServiceError): number {
  switch (error.code) {
    case "unauthenticated": return 401;
    case "forbidden": return 403;
    case "validation_failed": return 400;
    case "not_found": return 404;
    case "rate_limited": return 429;
    case "conflict": return 409;
    case "invalid_link": return 400;
    case "provider_rejected": return 502;
    case "provider_outcome_unknown": return 503;
    case "temporarily_unavailable": return 503;
  }
}

/** Build an injectable GET handler; the production route passes the real server service factory. */
export function createAdminWaitlistGetHandler(createService: ServiceFactory) {
  return async (request: Request): Promise<Response> => {
    const accessToken = getAccessTokenForPrincipal(request);
    // A bearer header is intentionally not a session source for this cookie-authenticated API.
    if (!accessToken) return response({ error: { code: "unauthenticated", message: "Sign in to continue." } }, 401);

    let parsed: ParseResult;
    try {
      parsed = parseSearch(new URL(request.url));
    } catch {
      return response({ error: { code: "validation_failed", message: "Check the waitlist filters and try again." } }, 400);
    }
    if (!parsed.ok) {
      return response({ error: { code: "validation_failed", message: "Check the waitlist filters and try again." } }, 400);
    }

    try {
      const result = await createService().searchWaitlist({ ...parsed.value, accessToken });
      if (!result.ok) {
        return response({ error: { code: result.error.code, message: result.error.safeMessage } }, statusForError(result.error));
      }
      return response(result.value, 200);
    } catch {
      return response({ error: { code: "temporarily_unavailable", message: "Waitlist search is temporarily unavailable." } }, 503);
    }
  };
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const maxInviteBodyLength = 2_048;

function inviteErrorStatus(error: ServiceError): number {
  switch (error.code) {
    case "unauthenticated": return 401;
    case "forbidden": return 403;
    case "validation_failed": return 400;
    case "not_found": return 404;
    case "conflict": return 409;
    case "rate_limited": return 429;
    case "invalid_link": return 400;
    case "provider_rejected": return 502;
    case "provider_outcome_unknown": return 503;
    case "temporarily_unavailable": return 503;
  }
}

/** Explicit admin confirmation queues app access; queueing is not proof an email was sent. */
export function createAdminWaitlistInvitePostHandler(
  createService: InviteServiceFactory,
  expectedAppOrigin: string | undefined,
) {
  return async (request: Request): Promise<Response> => {
    const headers = { "cache-control": "no-store", vary: "Cookie, Origin" };
    const originDecision = assertExactOrigin(request, expectedAppOrigin);
    if (!originDecision.allowed) {
      return response({ error: { code: "forbidden", message: "This request origin is not allowed." } }, 403, headers);
    }
    if (request.method !== "POST") {
      return response({ error: { code: "method_not_allowed", message: "Use POST to confirm an invitation." } }, 405, headers);
    }
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) {
      return response({ error: { code: "invalid_request", message: "Submit the invitation as JSON." } }, 415, headers);
    }

    const accessToken = getAccessTokenForPrincipal(request);
    if (!accessToken) return response({ error: { code: "unauthenticated", message: "Sign in to continue." } }, 401, headers);

    let bodyText: string;
    try {
      bodyText = await request.text();
    } catch {
      return response({ error: { code: "validation_failed", message: "Check the invitation details and try again." } }, 400, headers);
    }
    if (bodyText.length > maxInviteBodyLength) {
      return response({ error: { code: "validation_failed", message: "Check the invitation details and try again." } }, 400, headers);
    }
    let body: unknown;
    try {
      body = JSON.parse(bodyText) as unknown;
    } catch {
      return response({ error: { code: "validation_failed", message: "Check the invitation details and try again." } }, 400, headers);
    }
    if (
      typeof body !== "object"
      || body === null
      || Array.isArray(body)
      || Object.keys(body).length !== 2
      || !uuidPattern.test(String((body as Record<string, unknown>).signupId ?? ""))
      || !uuidPattern.test(String((body as Record<string, unknown>).operationId ?? ""))
    ) {
      return response({ error: { code: "validation_failed", message: "Check the invitation details and try again." } }, 400);
    }

    try {
      const result = await createService().admitWaitlistMember({
        accessToken,
        signupId: (body as { signupId: string }).signupId,
        operationId: (body as { operationId: string }).operationId,
      });
      if (!result.ok) {
        return response({ ok: false, error: { code: result.error.code, safeMessage: result.error.safeMessage } }, inviteErrorStatus(result.error), headers);
      }
      return Response.json({ ok: true, value: result.value }, { status: 202, headers });
    } catch {
      return response({ error: { code: "temporarily_unavailable", message: "The invitation could not be queued." } }, 503, headers);
    }
  };
}
