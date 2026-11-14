import { createFileRoute } from "@tanstack/react-router";
import { runOps } from "../../../server/ops.server.ts";

export const Route = createFileRoute("/api/me/tables/$tableId/recap")({ server: { handlers: { GET: async ({ request, params }) => runOps("recap", request, params) } } });
