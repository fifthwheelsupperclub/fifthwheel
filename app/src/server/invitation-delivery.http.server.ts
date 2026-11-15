/** Server-only HTTP wrapper for the explicit admin send action. */

import type { InvitationDeliveryService } from "./invitation-delivery.service.server.ts";
import { assertExactOrigin } from "./origin.server.ts";
import { getAccessTokenForPrincipal } from "./session.cookies.server.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createAdminInvitationSendHandler(service: InvitationDeliveryService, appOrigin: string) {
  return async (request: Request, deliveryId: string): Promise<Response> => {
    const origin = assertExactOrigin(request, appOrigin);
    if (!origin.allowed) return Response.json({ error: { code: "origin_rejected", message: "This request could not be accepted." } }, { status: 403, headers: { "cache-control": "no-store" } });
    const token = getAccessTokenForPrincipal(request);
    if (!token) return Response.json({ error: { code: "unauthenticated", message: "Sign in to continue." } }, { status: 401, headers: { "cache-control": "no-store", vary: "Cookie" } });
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return Response.json({ error: { code: "validation_failed", message: "The send request is invalid." } }, { status: 400, headers: { "cache-control": "no-store" } });
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > 4096) return Response.json({ error: { code: "validation_failed", message: "The send request is invalid." } }, { status: 400, headers: { "cache-control": "no-store" } });
    let body: unknown;
    try { body = JSON.parse(raw) as unknown; } catch { body = null; }
    if (!isRecord(body) || Object.keys(body).some((key) => key !== "operationId") || (body.operationId !== undefined && typeof body.operationId !== "string")) {
      return Response.json({ error: { code: "validation_failed", message: "The send request is invalid." } }, { status: 400, headers: { "cache-control": "no-store" } });
    }
    try {
      const result = await service.send({ accessToken: token, deliveryId, operationId: body.operationId as string | undefined });
      if (!result.ok) {
        const statuses: Record<string, number> = { unauthenticated: 401, forbidden: 403, not_found: 404, validation_failed: 400, conflict: 409, provider_outcome_unknown: 503 };
        const status = statuses[result.error.code] ?? 503;
        return Response.json({ error: result.error }, { status, headers: { "cache-control": "no-store", vary: "Cookie" } });
      }
      return Response.json(result.value, { status: 200, headers: { "cache-control": "no-store", vary: "Cookie" } });
    } catch {
      return Response.json({ error: { code: "temporarily_unavailable", message: "The invitation could not be sent. Try again later." } }, { status: 503, headers: { "cache-control": "no-store", vary: "Cookie" } });
    }
  };
}

/** Reconciliation inspects Mailpit state only; it never dispatches another email. */
export function createAdminInvitationReconcileHandler(service: InvitationDeliveryService, appOrigin: string) {
  return async (request: Request, deliveryId: string): Promise<Response> => {
    const origin = assertExactOrigin(request, appOrigin);
    const headers = { "cache-control": "no-store", vary: "Cookie, Origin" };
    if (!origin.allowed) return Response.json({ error: { code: "origin_rejected", message: "This request could not be accepted." } }, { status: 403, headers });
    const token = getAccessTokenForPrincipal(request);
    if (!token) return Response.json({ error: { code: "unauthenticated", message: "Sign in to continue." } }, { status: 401, headers });
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return Response.json({ error: { code: "validation_failed", message: "The status request is invalid." } }, { status: 400, headers });
    const raw = await request.text();
    if (raw.length > 1024) return Response.json({ error: { code: "validation_failed", message: "The status request is invalid." } }, { status: 400, headers });
    let body: unknown;
    try { body = JSON.parse(raw) as unknown; } catch { body = null; }
    if (!isRecord(body) || Object.keys(body).length !== 0) return Response.json({ error: { code: "validation_failed", message: "The status request is invalid." } }, { status: 400, headers });
    try {
      const result = await service.reconcile({ accessToken: token, deliveryId });
      if (!result.ok) {
        const statuses: Record<string, number> = { unauthenticated: 401, forbidden: 403, not_found: 404, validation_failed: 400, conflict: 409, provider_outcome_unknown: 503 };
        return Response.json({ error: result.error }, { status: statuses[result.error.code] ?? 503, headers });
      }
      return Response.json(result.value, { status: 200, headers });
    } catch {
      return Response.json({ error: { code: "temporarily_unavailable", message: "The invitation status could not be reconciled." } }, { status: 503, headers });
    }
  };
}
