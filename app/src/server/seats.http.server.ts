/** Same-origin cookie-authenticated GET boundaries for W07.3 member Seat reads (list, detail, calendar). */

import { randomUUID } from "node:crypto";
import type { MemberSeatErrorCode, MemberSeatResponse } from "../seats.contract.ts";
import type { SeatReadResult, SeatService } from "./seats.contract.server.ts";
import { getAccessTokenForPrincipal } from "./session.cookies.server.ts";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const noStore = { "cache-control": "private, no-store", "referrer-policy": "no-referrer", vary: "Cookie" };
const statuses: Record<MemberSeatErrorCode, number> = {
  unauthenticated: 401, forbidden: 403, not_found: 404, invalid_input: 400, conflict: 409, temporarily_unavailable: 503,
};

function failure(code: MemberSeatErrorCode, safeMessage: string, correlationId: string): Response {
  const body: MemberSeatResponse<never> = { ok: false, correlationId, error: { code, safeMessage, retryable: code === "temporarily_unavailable", correlationId } };
  return Response.json(body, { status: statuses[code], headers: noStore });
}
function json<T>(result: SeatReadResult<T>, correlationId: string): Response {
  if (!result.ok) return failure(result.error.code, result.error.safeMessage, correlationId);
  const body: MemberSeatResponse<T> = { ok: true, data: result.value, correlationId };
  return Response.json(body, { headers: noStore });
}

export function createSeatHttpHandlers(createService: () => SeatService) {
  const unavailable = (id: string) => failure("temporarily_unavailable", "Seat information is temporarily unavailable.", id);
  return Object.freeze({
    async list(request: Request): Promise<Response> {
      const id = randomUUID(); const url = new URL(request.url); const seen = new Map<string, string>();
      for (const [k, v] of url.searchParams) { if (!["cursor", "limit"].includes(k) || seen.has(k)) return failure("invalid_input", "Check the Seat list page.", id); seen.set(k, v); }
      const cursor = seen.get("cursor"); const limit = seen.get("limit") ?? "20";
      if ((cursor && (cursor.length > 512 || !/^[A-Za-z0-9_-]+$/.test(cursor))) || !/^(?:[1-9]\d?|50)$/.test(limit)) return failure("invalid_input", "Check the Seat list page.", id);
      try { return json(await createService().list({ accessToken: getAccessTokenForPrincipal(request), cursor: cursor ?? null, limit: Number(limit) }), id); }
      catch { return unavailable(id); }
    },
    async read(request: Request, seatId: string): Promise<Response> {
      const id = randomUUID();
      if (!uuid.test(seatId)) return failure("invalid_input", "Use a valid Seat link.", id);
      try { return json(await createService().read({ accessToken: getAccessTokenForPrincipal(request), seatId }), id); }
      catch { return unavailable(id); }
    },
    async calendar(request: Request, seatId: string): Promise<Response> {
      const id = randomUUID();
      if (!uuid.test(seatId)) return failure("invalid_input", "Use a valid Seat link.", id);
      try {
        const result = await createService().calendar({ accessToken: getAccessTokenForPrincipal(request), seatId });
        if (!result.ok) return failure(result.error.code, result.error.safeMessage, id);
        return new Response(result.value, { headers: { ...noStore, "content-type": "text/calendar; charset=utf-8", "content-disposition": 'attachment; filename="fifth-wheel-seat.ics"' } });
      } catch { return unavailable(id); }
    },
  });
}
