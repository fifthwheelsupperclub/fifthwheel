/** Route composition for admin-only weekly clone APIs. */

import { env } from "node:process";
import { createWeeklyCloneHttpHandlers } from "./supply.weekly-clone.http.server.ts";
import { createWeeklyCloneRuntime } from "./supply-weekly-clone-runtime.server.ts";

export function weeklyCloneHandlers() {
  return createWeeklyCloneHttpHandlers(() => createWeeklyCloneRuntime().service, env.APP_ORIGIN);
}
