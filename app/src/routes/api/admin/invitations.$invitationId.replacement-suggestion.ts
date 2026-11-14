import { createFileRoute } from "@tanstack/react-router";
import { runOps } from "../../../server/ops.server.ts";

export const Route = createFileRoute("/api/admin/invitations/$invitationId/replacement-suggestion")({ server: { handlers: { GET: async ({ request, params }) => runOps("replacementSuggestion", request, params) } } });
