import { createFileRoute } from "@tanstack/react-router";
import { runOps } from "../../../server/ops.server.ts";

export const Route = createFileRoute("/api/me/tables/$tableId/rating")({ server: { handlers: { POST: async ({ request, params }) => runOps("rating", request, params) } } });
