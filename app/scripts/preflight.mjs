// Usage: set the production variables in the shell (or `node --env-file=<file> scripts/preflight.mjs`) and run this. Offline; prints names and rules only.
import { checkProductionEnv } from "../src/server/preflight.server.ts";

const result = checkProductionEnv(process.env);
for (const p of result.problems) console.log(`FAIL  ${p}`);
for (const w of result.warnings) console.log(`WARN  ${w}`);
console.log(result.ok ? "preflight: configuration is internally consistent (reachability, DNS and provider dashboards are not checked)" : `preflight: ${result.problems.length} problem(s)`);
process.exitCode = result.ok ? 0 : 1;
