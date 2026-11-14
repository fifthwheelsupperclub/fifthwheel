import { createFileRoute } from "@tanstack/react-router";
import { runOps } from "../../../server/ops.server.ts";

export const Route = createFileRoute("/api/admin/staff-assignments/host")({ server: { handlers: { POST: async ({ request }) => runOps("hostAssignment", request) } } });
