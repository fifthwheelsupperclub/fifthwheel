// Usage: node scripts/waitlist-import-sql.mjs export.json > import.sql   (review import.sql, then apply it yourself to the NEW project)
// Reads a file only. Prints SQL on stdout and a quarantine summary (row numbers and reasons, never personal data) on stderr.
import { readFileSync } from "node:fs";
import { buildWaitlistImport } from "../src/server/waitlist-import.server.ts";

const file = process.argv[2];
if (!file) { console.error("usage: node scripts/waitlist-import-sql.mjs export.json > import.sql"); process.exit(2); }
const report = buildWaitlistImport(JSON.parse(readFileSync(file, "utf8")));
process.stdout.write(report.sql);
console.error(`accepted ${report.accepted}, quarantined ${report.quarantined.length}`);
for (const q of report.quarantined) console.error(`  row ${q.index}: ${q.reason}`);
process.exitCode = report.quarantined.length > 0 ? 3 : 0;
