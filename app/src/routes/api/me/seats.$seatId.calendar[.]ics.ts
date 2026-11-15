import { randomUUID } from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";
import { createSeatHttpRuntime } from "../../../server/seats-runtime.server.ts";

export const Route = createFileRoute("/api/me/seats/$seatId/calendar.ics")({ server: { handlers: {
  GET: async ({ request, params }) => {
    try { return await createSeatHttpRuntime().calendar(request, params.seatId); }
    catch { const correlationId = randomUUID(); return Response.json({ ok: false, correlationId, error: { code: "temporarily_unavailable", safeMessage: "Seat information is temporarily unavailable.", retryable: true, correlationId } }, { status: 503, headers: { "cache-control": "private, no-store" } }); }
  },
} } });
