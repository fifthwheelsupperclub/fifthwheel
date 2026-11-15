import { createFileRoute } from "@tanstack/react-router";
import { runOps } from "../../../server/ops.server.ts";

export const Route = createFileRoute("/api/admin/staff-assignments/contact")({ server: { handlers: { POST: async ({ request }) => runOps("staffContact", request) } } });
