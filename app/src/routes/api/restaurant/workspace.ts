import { createFileRoute } from "@tanstack/react-router";
import { runOps } from "../../../server/ops.server.ts";

export const Route = createFileRoute("/api/restaurant/workspace")({ server: { handlers: { GET: async ({ request }) => runOps("restaurantWorkspace", request) } } });
