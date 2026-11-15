import { createFileRoute } from "@tanstack/react-router";
import { runOps } from "../../../server/ops.server.ts";

export const Route = createFileRoute("/api/admin/member-accounts/delete")({ server: { handlers: { POST: async ({ request }) => runOps("deleteMemberAccount", request) } } });
