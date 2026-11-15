import { createFileRoute } from "@tanstack/react-router";
import { runOps } from "../../../server/ops.server.ts";

export const Route = createFileRoute("/api/admin/tables/$tableId/proceed")({ server: { handlers: { POST: async ({ request, params }) => runOps("proceed", request, params) } } });
