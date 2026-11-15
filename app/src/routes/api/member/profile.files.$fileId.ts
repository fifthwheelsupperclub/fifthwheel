import { createFileRoute } from "@tanstack/react-router";
import { profileHttpHandlers } from "../../../server/profile.http.runtime.server.ts";

export const Route = createFileRoute("/api/member/profile/files/$fileId")({
  server: { handlers: { DELETE: async ({ request, params }) => profileHttpHandlers.uploadDelete(request, params) } },
});
