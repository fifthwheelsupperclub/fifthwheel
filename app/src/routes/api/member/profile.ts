import { createFileRoute } from "@tanstack/react-router";
import { profileHttpHandlers } from "../../../server/profile.http.runtime.server.ts";

export const Route = createFileRoute("/api/member/profile")({
  server: { handlers: {
    GET: async ({ request }) => profileHttpHandlers.memberGet(request),
    PUT: async ({ request }) => profileHttpHandlers.memberSave(request),
  } },
});
