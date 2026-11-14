import { createFileRoute } from "@tanstack/react-router";
import { profileHttpHandlers } from "../../../server/profile.http.runtime.server.ts";

export const Route = createFileRoute("/api/member/profile/files")({
  server: { handlers: { POST: async ({ request }) => profileHttpHandlers.uploadIntent(request) } },
});
