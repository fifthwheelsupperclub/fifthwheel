import { randomUUID } from "node:crypto";
import { createRosterHttpRuntime } from "./roster-runtime.server.ts";

const noStore = { "cache-control": "private, no-store", vary: "Cookie, Origin" };

export async function runRosterRouteHandler(run: (handlers: ReturnType<typeof createRosterHttpRuntime>) => Promise<Response>): Promise<Response> {
  try { return await run(createRosterHttpRuntime()); }
  catch {
    return Response.json({ ok: false, error: { code: "temporarily_unavailable", message: "Roster curation is temporarily unavailable.", retryable: true, correlationId: randomUUID() } }, {
      status: 503, headers: noStore,
    });
  }
}
