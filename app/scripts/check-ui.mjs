// UI consistency checks (docs/UX-DESIGN-REFACTOR-PLAN.md T-33). Run: node scripts/check-ui.mjs [--update-baseline]
// Hard rules fail the run. "Ratchet" rules compare against scripts/ui-baseline.json: the count may go down, never up.
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const src = join(root, "src");
const walk = (dir) => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
const files = walk(src).filter((f) => !f.includes("/server/") && !f.endsWith(".gen.ts") && !f.endsWith(".test.ts"));
const css = files.filter((f) => f.endsWith(".css"));
const tsx = files.filter((f) => f.endsWith(".tsx"));
const rel = (f) => relative(root, f);
const read = (f) => readFileSync(f, "utf8");
const failures = [];
const counts = {};

// --- Hard rules ---------------------------------------------------------------------------------------------
for (const f of css) read(f).split("\n").forEach((line, i) => {
  for (const m of line.matchAll(/font-size:\s*([0-9.]+)px/g)) if (Number(m[1]) < 12) failures.push(`${rel(f)}:${i + 1} font-size ${m[1]}px is below the 12px floor`);
});
for (const f of [...tsx, ...files.filter((x) => x.endsWith(".ts"))]) read(f).split("\n").forEach((line, i) => {
  if (/window\.(confirm|alert|prompt)\(/.test(line)) failures.push(`${rel(f)}:${i + 1} use ConfirmDialog, not a browser dialog`);
});
const dateAllow = new Set(["src/format/datetime.ts", "src/components/admin-supply-weekly-clone.tsx"]); // weekly clone computes week math, not display
for (const f of tsx) { if (dateAllow.has(rel(f))) continue; read(f).split("\n").forEach((line, i) => {
  if (/Intl\.DateTimeFormat|toLocale(Date|Time)?String/.test(line)) failures.push(`${rel(f)}:${i + 1} format dates with src/format/datetime.ts`);
}); }
for (const f of tsx) { const r = rel(f); read(f).split("\n").forEach((line, i) => {
  if (/className="product-topbar"/.test(line) && r !== "src/components/app-shell.tsx" && !r.includes("PublicTable") && !/table-invitation-workspaces|member-tables-workspace/.test(r)) failures.push(`${r}:${i + 1} top bars belong to AppShell`);
}); }
for (const f of tsx) { const r = rel(f); if (/app-shell|auth-layout|routes\/(__root|index|sign-in|preview)|auth\/callback/.test(r)) continue;
  read(f).split("\n").forEach((line, i) => { if (/<main[ >]/.test(line) && !/public-table-page/.test(line)) failures.push(`${r}:${i + 1} AppShell owns the only <main>`); }); }

// --- Ratchets -----------------------------------------------------------------------------------------------
counts.rawHexOutsideTokens = css.filter((f) => !f.endsWith("styles/tokens.css")).reduce((n, f) => n + (read(f).match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).length, 0);
counts.importantDeclarations = css.reduce((n, f) => n + (read(f).match(/!important/g) ?? []).length, 0);
const guest = tsx.filter((f) => /member-|profile-workspace|tonight-workspace|routes\/(member|sign-in|my-seats|requests|tables|invitations)|auth\/callback|table-invitation-workspaces/.test(rel(f)));
const banned = /\b(app invitation|admission|admitted|obligation|snapshot|idempotency)\b|Email provider accepted/i;
counts.guestBannedTerms = guest.reduce((n, f) => n + read(f).split("\n").filter((l) => banned.test(l) && !/^\s*(\/\/|\*)/.test(l) && !/className|import /.test(l.split('"')[0] ?? "") ).length, 0);

const baselinePath = join(root, "scripts/ui-baseline.json");
if (process.argv.includes("--update-baseline") || !existsSync(baselinePath)) { writeFileSync(baselinePath, JSON.stringify(counts, null, 2) + "\n"); console.log("baseline written:", counts); }
else {
  const base = JSON.parse(read(baselinePath));
  for (const [k, v] of Object.entries(counts)) {
    if (v > (base[k] ?? 0)) failures.push(`${k} rose from ${base[k]} to ${v} (it may only go down; run with --update-baseline after a real reduction)`);
    else if (v < (base[k] ?? 0)) console.log(`note: ${k} fell from ${base[k]} to ${v}. Run --update-baseline to lock it in.`);
  }
}
if (failures.length) { console.error(failures.join("\n")); console.error(`\n${failures.length} UI check failure(s).`); process.exit(1); }
console.log("UI checks passed.", counts);
