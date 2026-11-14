import { createFileRoute } from "@tanstack/react-router";
import { runOps } from "../../../server/ops.server.ts";

export const Route = createFileRoute("/api/admin/invitations/$invitationId/remove")({ server: { handlers: { POST: async ({ request, params }) => runOps("removeAndReplace", request, params) } } });
