import { createFileRoute } from "@tanstack/react-router";
import { runOps } from "../../../server/ops.server.ts";

export const Route = createFileRoute("/api/admin/staff-assignments/venue")({ server: { handlers: { POST: async ({ request }) => runOps("venueMembership", request) } } });
