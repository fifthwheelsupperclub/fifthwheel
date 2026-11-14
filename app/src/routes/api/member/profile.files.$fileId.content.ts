import { createFileRoute } from "@tanstack/react-router";
import { profileHttpHandlers } from "../../../server/profile.http.runtime.server.ts";

export const Route = createFileRoute("/api/member/profile/files/$fileId/content")({
  server: { handlers: { PUT: async ({ request, params }) => profileHttpHandlers.uploadContent(request, params) } },
});
