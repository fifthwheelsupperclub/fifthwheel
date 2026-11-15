import { createFileRoute } from "@tanstack/react-router";
import { randomUUID } from "node:crypto";
import { env } from "node:process";
import type { SupplySyncErrorCode } from "../../../../supply.contract.ts";
import { assertExactOrigin } from "../../../../server/origin.server.ts";
import { getAccessTokenForPrincipal } from "../../../../server/session.cookies.server.ts";
import { createSupplyRuntime } from "../../../../server/supply-runtime.server.ts";

const noStore = { "cache-control": "private, no-store", vary: "Cookie" };

function errorStatus(code: SupplySyncErrorCode): number {
  switch (code) {
    case "unauthenticated": return 401;
    case "forbidden": return 403;
    case "invalid_input": return 400;
    case "conflict": return 409;
    case "temporarily_unavailable": return 503;
  }
}

function errorResponse(code: SupplySyncErrorCode, message: string, retryable: boolean, correlationId = randomUUID()): Response {
  return Response.json({ ok: false, error: { code, message, retryable, correlationId } }, { status: errorStatus(code), headers: noStore });
}

function serviceFailureCode(code: string): SupplySyncErrorCode {
  switch (code) {
    case "unauthenticated": return "unauthenticated";
    case "forbidden": return "forbidden";
    case "validation_failed": return "invalid_input";
    default: return "temporarily_unavailable";
  }
}

async function getSummary(request: Request): Promise<Response> {
  const correlationId = randomUUID();
  try {
    const { service } = createSupplyRuntime();
    const result = await service.readSummary({ accessToken: getAccessTokenForPrincipal(request) });
    if (!result.ok) {
      const code = serviceFailureCode(result.error.code);
      return errorResponse(code, result.error.safeMessage, code === "temporarily_unavailable", correlationId);
    }
    return Response.json({ ok: true, data: result.value, correlationId }, { status: 200, headers: noStore });
  } catch {
    return errorResponse("temporarily_unavailable", "Supply status is temporarily unavailable.", true, correlationId);
  }
}

async function postSync(request: Request): Promise<Response> {
  const correlationId = randomUUID();
  const origin = assertExactOrigin(request, env.APP_ORIGIN);
  if (!origin.allowed) return errorResponse("forbidden", "This request origin is not allowed.", false, correlationId);

  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") return errorResponse("invalid_input", "Supply sync requires a JSON request.", false, correlationId);

  let bytes: Uint8Array;
  try {
    const reader = request.body?.getReader();
    if (!reader) return errorResponse("invalid_input", "Supply sync needs a request body.", false, correlationId);
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > 2048) {
        await reader.cancel();
        return errorResponse("invalid_input", "Supply sync request is too large.", false, correlationId);
      }
      chunks.push(part.value);
    }
    bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  } catch { return errorResponse("invalid_input", "Supply sync needs a valid JSON request.", false, correlationId); }
  let body: unknown;
  try { body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { return errorResponse("invalid_input", "Supply sync needs a valid JSON request.", false, correlationId); }
  if (typeof body !== "object" || body === null || Array.isArray(body) || Object.keys(body).length !== 1 || !("operationId" in body) || typeof body.operationId !== "string") {
    return errorResponse("invalid_input", "Supply sync requires only an operation identifier.", false, correlationId);
  }

  try {
    const { service } = createSupplyRuntime();
    const result = await service.synchronize({ accessToken: getAccessTokenForPrincipal(request), operationId: body.operationId });
    if (!result.ok) {
      const code = serviceFailureCode(result.error.code);
      return errorResponse(code, result.error.safeMessage, code === "temporarily_unavailable", correlationId);
    }
    return Response.json({ ok: true, data: result.value, correlationId }, { status: 200, headers: noStore });
  } catch {
    return errorResponse("temporarily_unavailable", "Supply sync is temporarily unavailable.", true, correlationId);
  }
}

export const Route = createFileRoute("/api/admin/supply/sync")({
  server: {
    handlers: {
      GET: async ({ request }) => getSummary(request),
      POST: async ({ request }) => postSync(request),
    },
  },
});
