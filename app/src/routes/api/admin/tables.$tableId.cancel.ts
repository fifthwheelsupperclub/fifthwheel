import { createFileRoute } from "@tanstack/react-router";
import { createTableCancelHttpRuntime } from "../../../server/table-cancel.server.ts";

export const Route = createFileRoute("/api/admin/tables/$tableId/cancel")({ server: { handlers: {
  POST: async ({ request, params }) => {
    try { return await createTableCancelHttpRuntime()(request, params.tableId); }
    catch { return Response.json({ ok: false, error: { code: "temporarily_unavailable", safeMessage: "Table cancellation is temporarily unavailable. Try again shortly.", retryable: true } }, { status: 503, headers: { "cache-control": "private, no-store" } }); }
  },
} } });
