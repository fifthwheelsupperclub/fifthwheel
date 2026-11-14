import { createFileRoute } from "@tanstack/react-router";
import { runOps } from "../../../server/ops.server.ts";

export const Route = createFileRoute("/api/host/tables/$tableId/check-in")({ server: { handlers: { POST: async ({ request, params }) => runOps("checkIn", request, params) } } });
