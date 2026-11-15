import { createFileRoute } from "@tanstack/react-router";
import { runOps } from "../../../server/ops.server.ts";

export const Route = createFileRoute("/api/me/tables/$tableId/ballot")({ server: { handlers: { POST: async ({ request, params }) => runOps("ballot", request, params) } } });
