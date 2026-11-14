import { env } from "node:process";
import { createProfileRuntime } from "./profile-runtime.server.ts";
import { createProfileHttpHandlers } from "./profile.http.server.ts";

export const profileHttpHandlers = createProfileHttpHandlers({
  service: createProfileRuntime,
  appOrigin: env.APP_ORIGIN,
});
