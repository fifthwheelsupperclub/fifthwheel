import { createFileRoute } from "@tanstack/react-router";
import { runOps } from "../../../server/ops.server.ts";

export const Route = createFileRoute("/api/host/tables/$tableId/attendance")({ server: { handlers: { GET: async ({ request, params }) => runOps("attendance", request, params) } } });
