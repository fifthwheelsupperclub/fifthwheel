import { randomUUID } from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";
import { createSeatHttpRuntime } from "../../../server/seats-runtime.server.ts";

export const Route = createFileRoute("/api/me/seats")({ server: { handlers: {
  GET: async ({ request }) => {
    try { return await createSeatHttpRuntime().list(request); }
    catch { const correlationId = randomUUID(); return Response.json({ ok: false, correlationId, error: { code: "temporarily_unavailable", safeMessage: "Seat information is temporarily unavailable.", retryable: true, correlationId } }, { status: 503, headers: { "cache-control": "private, no-store" } }); }
  },
} } });
