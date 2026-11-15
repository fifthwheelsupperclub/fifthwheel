import { createFileRoute } from "@tanstack/react-router";
import { handleWorkerRequest } from "../../../server/worker.server.ts";

export const Route = createFileRoute("/api/internal/worker")({
  server: { handlers: { POST: async ({ request }) => handleWorkerRequest(request) } },
});
