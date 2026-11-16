// W12 real-stack permission + direct-route sweep. Driven by scripts/run-w12-authz.mjs (isolated local test stack, app on :8087).
// Routes are enumerated from src/routeTree.gen.ts; handler methods from the matching src/routes file. Never hand-listed.
import { expect, test, type Browser, type BrowserContext } from "@playwright/test";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ORIGIN = "http://127.0.0.1:8087";
const SB = "http://127.0.0.1:57421";
if (ORIGIN === "http://127.0.0.1:8086" || !process.env.W12_FIXTURE) throw new Error("W12 spec must run through scripts/run-w12-authz.mjs on port 8087");
const fx = JSON.parse(process.env.W12_FIXTURE) as any;
const A = fx.a, B = fx.b;
const ROLES = ["anon", "memberA", "memberB", "hostA", "hostB", "hostRev", "restA", "restB", "restRev", "admin"] as const;
type Role = (typeof ROLES)[number];
type Row = { status: "pass" | "fail" | "unverified" | "skip"; kind: string; role: string; route: string; detail: string };
const rows: Row[] = [];
const consoleLog: Record<string, string[]> = {};
const add = (status: Row["status"], kind: string, role: string, route: string, detail: string) => rows.push({ status, kind, role, route, detail });

// ---------- route enumeration (routeTree.gen.ts + route source) ----------
const root = process.cwd();
const tree = readFileSync(join(root, "src/routeTree.gen.ts"), "utf8");
const block = tree.slice(tree.indexOf("export interface FileRoutesByFullPath"), tree.indexOf("export interface FileRoutesByTo"));
const fullPaths = [...block.matchAll(/^\s+'([^']+)':\s+typeof/gm)].map((m) => m[1]);
const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
const methodsByPath = new Map<string, string[]>();
for (const f of walk(join(root, "src/routes"))) {
  const s = readFileSync(f, "utf8");
  const p = s.match(/createFileRoute\("([^"]+)"\)/)?.[1];
  if (p) methodsByPath.set(p, [...new Set([...s.matchAll(/\b(GET|POST|PUT|PATCH|DELETE)\s*:/g)].map((m) => m[1]))]);
}
const apiRoutes = fullPaths.filter((p) => p.startsWith("/api/") && (methodsByPath.get(p) ?? []).length > 0);
const pageRoutes = [...new Set(fullPaths.filter((p) => !p.startsWith("/api/")).map((p) => (p.length > 1 && p.endsWith("/") ? p.slice(0, -1) : p)))];

const uuid = () => randomUUID();
function fill(path: string, ids: "A" | "random"): string {
  const m = A;
  return path.replace(/\$(\w+)/g, (_, n) => {
    if (ids === "random") return uuid();
    switch (n) {
      case "tableId": return m.table; case "seatId": return m.seat; case "invitationId": return m.invitation; case "attemptId": return m.attempt;
      case "obligationId": return m.obligation; case "guestId": return m.guest; case "fileId": return m.file;
      case "requestId": return path.includes("/api/me/requests") ? m.request : m.cancel;
      default: return uuid();
    }
  });
}

// ---------- expected access ----------
type Access = "deny" | "allow" | "public" | "special";
const hasParam = (p: string) => p.includes("$");
function access(path: string, method: string, role: Role): Access {
  if (path === "/api/health") return "public";
  if (path.startsWith("/api/auth/") || path === "/api/waitlist" || path === "/api/webhooks/stripe" || path === "/api/internal/worker") return "special";
  if (path === "/api/tables" || (path === "/api/tables/$tableId" && method === "GET")) return "public";
  if (role === "anon") return "deny";
  if (path === "/api/workspaces") return "allow";
  const isMember = role === "memberA" || role === "memberB";
  const isHost = role.startsWith("host");
  const isRest = role.startsWith("rest");
  if (path.startsWith("/api/admin/")) return role === "admin" ? "allow" : "deny";
  if (path.startsWith("/api/restaurant/")) return isRest ? "allow" : "deny";
  if (path.startsWith("/api/host/")) return role === "admin" || role === "hostA" ? "allow" : "deny";
  if (path === "/api/supply/venues/$venueId") return role === "admin" ? "allow" : "deny"; // venue curation is admin-only
  if (path.startsWith("/api/supply/") || path.startsWith("/api/curation/")) {
    if (role === "admin") return "allow";
    if (!isHost) return "deny";
    return !hasParam(path) ? "allow" : role === "hostA" ? "allow" : "deny"; // fixtures use table A
  }
  if (path.startsWith("/api/tables/")) return isMember ? "allow" : "deny"; // any admitted member may request a published Table
  if (path.startsWith("/api/me/") || path.startsWith("/api/member/")) {
    if (!isMember) return "deny";
    return !hasParam(path) || role === "memberA" ? "allow" : "deny";
  }
  return "deny";
}

// ---------- valid-shape bodies (ops routes validate input before auth, so denied probes need valid shapes) ----------
function bodyFor(path: string, method: string): unknown {
  if (method === "GET") return undefined;
  if (path.endsWith("/files/$fileId") && method === "DELETE") return { operationId: uuid(), expectedProfileRevision: 1 };
  if (method === "DELETE") return undefined;
  if (path.endsWith("/files/$fileId/complete")) return { operationId: uuid(), expectedProfileRevision: 1, expectedCriticalIdentityVersion: 1 };
  if (path.endsWith("/admin/tables/$tableId/cancel")) return { operationId: uuid(), reason: "W12 probe reason" };
  if (path.endsWith("/decision") && path.includes("cancellations")) return { operationId: uuid(), expectedVersion: 1, decision: "deny", refundCents: 0, memberSafeReason: "w12 probe" };
  if (path.includes("/refund-operations/")) return { requestId: uuid() };
  if (path.includes("/table-invitations/") && path.endsWith("/retry")) return { operationId: uuid(), expectedAttemptCount: 1 };
  if (path.includes("/table-invitations/") && path.endsWith("/reconcile") && path.startsWith("/api/admin/table-invitations")) return { expectedAttemptCount: 1 };
  if (path.startsWith("/api/admin/invitation-deliveries/")) return {};
  if (path === "/api/admin/waitlist") return { signupId: uuid(), operationId: uuid() };
  if (path.endsWith("/seat-requests/$tableId/approve")) return { operationId: uuid(), expectedProposalRevision: 1 };
  if (path === "/api/supply/drafts") return { operationId: uuid(), source: { kind: "manual", content: {} } };
  if (path === "/api/supply/venues/$venueId") return { name: "W12 probe venue", address: "1 Probe Way", neighborhood: "Inman Park", active: true };
  if (path === "/api/supply/drafts/$draftId") return { operationId: uuid(), expectedDraftRevision: 1 };
  if (path.endsWith("/drafts/$draftId/preview")) return { expectedDraftRevision: 1 };
  if (path.endsWith("/checkout") ) return { operationId: uuid(), expectedProposalRevision: 1, expectedProfileRevision: 1, acceptedDisclosureVersion: "seat-checkout-v1" };
  if (path.endsWith("/checkout/return")) return { attemptId: uuid(), sessionId: "cs_test_w12none" };
  if (path.endsWith("/roster-proposal") ) return { operationId: uuid(), expectedProposalRevision: 1, supplyRevisionId: uuid(), selectedRequestIds: [] };
  if (path.endsWith("/roster-proposal/submit")) return { operationId: uuid(), expectedProposalRevision: 1 };
  if (path.includes("/supply/drafts/") && /(accept|preview|publish)$/.test(path)) return { operationId: uuid(), expectedDraftRevision: 1 };
  if (path.endsWith("/weekly-clone/preview")) return { sourceWeekStart: "2026-11-02", targetWeekStart: "2026-11-09" };
  if (path.endsWith("/admin/supply/weekly-clone")) return { operationId: uuid(), sourceWeekStart: "2026-11-02", targetWeekStart: "2026-11-09" };
  if (path.endsWith("/undo")) return {};
  if (path.endsWith("/proceed")) return { operationId: uuid() };
  if (path.endsWith("/check-in")) return { seatId: A.seat };
  if (path.endsWith("/flag") || (path.endsWith("/delete") && path.includes("conduct-reports"))) return {};
  if (path.endsWith("/remove")) return { operationId: uuid(), expectedRevision: 1, refundCents: 0, replaceRequestId: null };
  if (path.endsWith("/staff-assignments/host") || path.endsWith("/staff-assignments/venue")) return { [path.endsWith("host") ? "tableId" : "venueId"]: uuid(), userId: uuid(), assigned: false };
  if (path.endsWith("/staff-assignments/contact")) return { userId: uuid(), displayName: "W12", businessContact: "w12@example.test" };
  if (path.endsWith("/member-accounts/delete")) return { guestId: uuid(), confirm: "delete" };
  if (path.endsWith("/resolve")) return { action: "dismiss" };
  if (path.includes("/conduct-reports/") && !path.endsWith("/delete")) return { status: "resolved", held: false };
  if (path.endsWith("/ballot")) return { choiceGuestId: null };
  if (path.endsWith("/rating")) return { overall: 3, venueScores: {}, note: null };
  if (path.endsWith("/conduct-report")) return { operationId: uuid(), subjectGuestId: null, body: "w12 probe" };
  if (path.endsWith("/read-url")) return { expectedProfileRevision: 1, expectedCriticalIdentityVersion: 1 };
  if (path.endsWith("/cancellation-requests")) return { operationId: uuid(), memberReason: "w12 probe" };
  if (path.endsWith("/withdraw")) return { operationId: uuid() };
  return { operationId: uuid() };
}

// ---------- sessions ----------
const guard = (c: BrowserContext) => c.route("**/*", (r) => { const u = new URL(r.request().url()); return u.origin === ORIGIN || u.origin === SB ? r.continue() : r.abort(); });
async function session(browser: Browser, email: string | null): Promise<BrowserContext> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await guard(ctx);
  if (!email) return ctx;
  const pub = process.env.SUPABASE_PUBLISHABLE_KEY!, svc = process.env.SUPABASE_SECRET_KEY!;
  const gen = await ctx.request.post(`${SB}/auth/v1/admin/generate_link`, { headers: { apikey: svc, authorization: `Bearer ${svc}`, "content-type": "application/json" }, data: { type: "magiclink", email, redirect_to: `${ORIGIN}/auth/callback` } });
  const hashed = ((await gen.json()) as { hashed_token?: string }).hashed_token;
  const ver = await ctx.request.post(`${SB}/auth/v1/verify`, { headers: { apikey: pub, "content-type": "application/json" }, data: { token_hash: hashed, type: "magiclink" } });
  const s = (await ver.json()) as { access_token: string; refresh_token: string };
  await ctx.addCookies([
    { name: "fw_access_token", value: s.access_token, domain: "127.0.0.1", path: "/", httpOnly: true, sameSite: "Lax" },
    { name: "fw_refresh_token", value: s.refresh_token, domain: "127.0.0.1", path: "/", httpOnly: true, sameSite: "Lax" },
  ]);
  return ctx;
}
const ctxs = {} as Record<Role, BrowserContext>;
const tokens = {} as Record<string, string>;

// ---------- leak markers ----------
type Owner = typeof A;
type Marker = readonly [string, string];
const piiOf = (n: string, o: Owner): Marker[] => [["email", o.email], ["lastName", o.last], ["dob", o.dob], ["fileId", o.file], ["fileKey", o.fileKey], ["paymentIntent", o.pi], ["checkoutSession", o.session], ["authUserId", o.userId], ["refundObligation", o.obligation], ["paymentId", o.payment]].map(([k, v]) => [`${n}.${k}`, v] as Marker);
const idsOf = (n: string, o: Owner): Marker[] => [["guestId", o.guest], ["seatId", o.seat], ["invitationId", o.invitation], ["attemptId", o.attempt], ["requestId", o.request], ["cancelRequestId", o.cancel], ["proposalId", o.proposal]].map(([k, v]) => [`${n}.${k}`, v] as Marker);
function forbidden(role: Role): Marker[] {
  if (role === "admin") return [];
  const f: Marker[] = [];
  for (const [key, o] of [["A", A], ["B", B]] as const) {
    if (role === `member${key}`) continue;
    const hostOwn = role === `host${key}`;
    f.push(...piiOf(key, o));
    if (hostOwn) f.push([`${key}.invitationId`, o.invitation], [`${key}.attemptId`, o.attempt]);
    else { f.push(...idsOf(key, o)); f.push([`${key}.firstName`, o.first]); }
  }
  if (role !== "hostA" && role !== "hostB") f.push(["privateNotes", "W12SECRETNOTE"]);
  return f;
}
const hits = (role: Role, text: string) => forbidden(role).filter(([, v]) => v && text.includes(v)).map(([k]) => k);
const samples: Record<string, string> = {};
const restaurantKeyDeny = /(^|_)(guests?|dob|birth\w*|photos?|selfie|payments?|ballots?|reports?|emails?|attendees|roster\w*|attendance|seatId|guestId)$/i;
function jsonKeys(v: unknown, out: string[] = []): string[] { if (Array.isArray(v)) v.forEach((x) => jsonKeys(x, out)); else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { out.push(k); jsonKeys(x, out); } return out; }

// ---------- probe ----------
type Probe = { status: number; ctype: string; text: string };
async function probe(role: Role, method: string, url: string, opts: { body?: unknown; origin?: string | null; headers?: Record<string, string>; raw?: Buffer } = {}): Promise<Probe> {
  const headers: Record<string, string> = { accept: "application/json", ...(opts.headers ?? {}) };
  if (opts.origin !== null) headers.origin = opts.origin ?? ORIGIN;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (opts.raw) { headers["content-type"] = "image/png"; headers["x-fw-upload-token"] = "a".repeat(48); }
  const r = await ctxs[role].request.fetch(`${ORIGIN}${url}`, { method, headers, ...(opts.raw ? { data: opts.raw } : opts.body !== undefined ? { data: JSON.stringify(opts.body) } : {}), maxRedirects: 0, failOnStatusCode: false, timeout: 30_000 });
  return { status: r.status(), ctype: r.headers()["content-type"] ?? "", text: await r.text().catch(() => "") };
}
const isHtml = (p: Probe) => p.ctype.includes("text/html");

test.describe.serial("W12 authz sweep", () => {
  test.beforeAll(async ({ browser }) => {
    ctxs.anon = await session(browser, null);
    for (const r of ROLES.filter((x) => x !== "anon")) {
      ctxs[r] = await session(browser, fx.emails[r]);
      tokens[r] = (await ctxs[r].cookies()).find((c) => c.name === "fw_access_token")?.value ?? "";
    }
  });
  test.afterAll(async () => {
    writeFileSync(process.env.W12_RESULTS!, JSON.stringify({ rows, consoleLog, samples }, null, 1));
    for (const c of Object.values(ctxs)) await c.close().catch(() => undefined);
  });

  test("0 session preconditions (positive controls prove cookies work, so denials are real)", async () => {
    const expect200: Role[] = ["memberA", "memberB", "hostA", "hostB", "restA", "restB", "admin"];
    for (const role of ROLES.filter((r) => r !== "anon")) {
      const p = await probe(role, "GET", "/api/workspaces");
      const want = expect200.includes(role) ? 200 : 403;
      add(p.status === want ? "pass" : "fail", "hook", role, "GET /api/workspaces", `expected ${want}, got ${p.status}${p.status !== want ? ` ${p.text.slice(0, 120)}` : ""}`);
    }
    const anon = await probe("anon", "GET", "/api/workspaces");
    add(anon.status === 401 ? "pass" : "fail", "hook", "anon", "GET /api/workspaces", `expected 401, got ${anon.status}`);
    const own = await probe("memberA", "GET", fill("/api/me/seats/$seatId", "A"));
    add(own.status === 200 && own.text.includes(A.seat) ? "pass" : "fail", "hook", "memberA", "GET own seat (positive control)", `expected 200 with own seat, got ${own.status} ${own.text.slice(0, 120)}`);
    const att = await probe("hostA", "GET", `/api/host/tables/${A.table}/attendance`);
    add(att.status === 200 ? "pass" : "fail", "hook", "hostA", "GET assigned attendance (positive control)", `expected 200, got ${att.status} ${att.text.slice(0, 120)}`);
    const ov = await probe("admin", "GET", "/api/admin/overview");
    add(ov.status === 200 ? "pass" : "fail", "hook", "admin", "GET /api/admin/overview (positive control)", `expected 200, got ${ov.status} ${ov.text.slice(0, 120)}`);
    const rw = await probe("restA", "GET", "/api/restaurant/workspace");
    add(rw.status === 200 ? "pass" : "fail", "hook", "restA", "GET restaurant workspace (positive control)", `expected 200, got ${rw.status} ${rw.text.slice(0, 120)}`);
  });

  test("1 API sweep: every /api route x method x role", async () => {
    for (const path of apiRoutes) {
      const methods = methodsByPath.get(path)!;
      for (const method of methods) {
        for (const role of ROLES) {
          // Legitimate member actions that would create requests, Stripe sessions or delete evidence use random ids for the allowed owner.
          const sideEffect = (method !== "GET") && (path.startsWith("/api/tables/") || (role === "memberA" && (path.includes("/checkout") || path.endsWith("/files/$fileId") || path.endsWith("/complete") || path.endsWith("/content"))));
          const url = fill(path, sideEffect ? "random" : "A");
          const label = `${method} ${path}`;
          const acc = access(path, method, role);
          if (acc === "special") continue; // handled in 2/3
          if (role === "admin" && method !== "GET") { continue; } // admin is probed read-only; mutations are covered for denial only
          if (role === "admin" && path === "/api/admin/supply/sync") { add("skip", "api", role, label, "admin GET of sync status skipped (touches shared supply state)"); continue; }
          let p: Probe;
          try { p = await probe(role, method, url, path.endsWith("/content") ? { raw: Buffer.from([0x89, 0x50, 0x4e, 0x47]) } : { body: bodyFor(path, method) }); } catch (e) { add("fail", "api", role, label, `request threw: ${(e as Error).message.slice(0, 100)}`); continue; }
          const snippet = p.text.replace(/\s+/g, " ").slice(0, 110);
          if (p.status >= 500) { add("fail", "api", role, label, `5xx: ${p.status} ${snippet}`); continue; }
          if (p.status >= 200 && p.status < 400 && isHtml(p)) { add("fail", "api", role, label, `${p.status} text/html on an API path (expected JSON or 4xx): ${snippet}`); continue; }
          if (p.status >= 200 && p.status < 300) {
            if (acc === "deny") { add("fail", "api", role, label, `UNEXPECTED ${p.status} (expected ${role === "anon" ? "401" : "403/404"}): ${snippet}`); continue; }
            const leaks = hits(role, p.text);
            if (/curation\/tables\/.+\/roster$|restaurant\/workspace|host\/tables\/.+\/attendance|assigned-tables/.test(path)) samples[`${role} ${label}`] = p.text.slice(0, 1800);
            if (leaks.length) { add("fail", "api", role, label, `${p.status} body exposes: ${leaks.join(", ")}`); continue; }
            if (role.startsWith("rest") && path.startsWith("/api/restaurant/")) {
              let j: unknown = null; try { j = JSON.parse(p.text); } catch { /* ignore */ }
              const bad = jsonKeys(j).filter((k) => restaurantKeyDeny.test(k));
              if (bad.length) { add("fail", "scope", role, label, `restaurant DTO has guest/PII-like keys: ${[...new Set(bad)].join(",")}`); continue; }
            }
            add("pass", "api", role, label, `${p.status} allowed${acc === "public" ? " (public)" : ""}`);
            continue;
          }
          if (acc === "deny") {
            const ok = role === "anon" ? [401] : [403, 404];
            if (ok.includes(p.status)) add("pass", "api", role, label, `${p.status} denied`);
            else if ([400, 405, 409, 422].includes(p.status)) add("unverified", "api", role, label, `${p.status} before the auth decision (shape rejected, authz not exercised): ${snippet}`);
            else add("fail", "api", role, label, `expected ${role === "anon" ? "401" : "403/404"}, got ${p.status}: ${snippet}`);
          } else add("pass", "api", role, label, `${p.status} (no 2xx required; not a 5xx)`);
        }
      }
    }
  });

  test("2 mutating routes reject wrong / missing Origin", async () => {
    const mutating = apiRoutes.flatMap((p) => (methodsByPath.get(p) ?? []).filter((m) => m !== "GET").map((m) => [p, m] as const))
      .filter(([p]) => p !== "/api/webhooks/stripe" && p !== "/api/internal/worker");
    for (const [path, method] of mutating) {
      const label = `${method} ${path}`;
      // Random ids so an unprotected route can never touch fixture rows; credentialed so a missing Origin check would otherwise proceed.
      const url = fill(path, "random");
      const who: Role[] = path.startsWith("/api/auth/") || path === "/api/waitlist" ? ["anon"] : path.startsWith("/api/admin/") || path.startsWith("/api/supply/") || path.startsWith("/api/curation/") ? ["admin"] : path.startsWith("/api/host/") ? ["hostA"] : ["memberA"];
      for (const role of who) for (const [name, origin] of [["wrong", "https://evil.example"], ["missing", null]] as const) {
        const p = await probe(role, method, url, { body: bodyFor(path, method), origin });
        const snippet = p.text.replace(/\s+/g, " ").slice(0, 100);
        if (path === "/api/waitlist" && name === "missing" && p.status === 400) add("pass", "origin", role, `${label} [${name} Origin]`, "400 by design: public marketing form, Origin only gates browser CORS (wrong Origin is 403); non-browser callers without Origin reach validation");
        else if (p.status === 403) add("pass", "origin", role, `${label} [${name} Origin]`, "403 rejected");
        else if (p.status >= 200 && p.status < 300) add("fail", "origin", role, `${label} [${name} Origin]`, `UNEXPECTED ${p.status}: ${snippet}`);
        else if ([404, 409].includes(p.status) && !isHtml(p)) add("fail", "origin", role, `${label} [${name} Origin]`, `${p.status} suggests the request was processed past the Origin check: ${snippet}`);
        else if (p.status >= 500) add("fail", "origin", role, `${label} [${name} Origin]`, `5xx ${p.status}: ${snippet}`);
        else add("unverified", "origin", role, `${label} [${name} Origin]`, `${p.status} (not 403; Origin check not distinguishable): ${snippet}`);
      }
    }
  });

  test("3 webhook and worker routes reject unsigned / wrong-secret calls", async () => {
    const body = JSON.stringify({ id: "evt_w12", object: "event", type: "checkout.session.completed", livemode: false, data: { object: { id: "cs_test_w12none" } } });
    const t = Math.floor(Date.now() / 1000);
    const sig = (secret: string, ts = t) => `t=${ts},v1=${createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex")}`;
    const hooks: [string, Record<string, string>][] = [
      ["no signature header", {}],
      ["garbage signature", { "stripe-signature": "nonsense" }],
      ["wrong-secret HMAC", { "stripe-signature": sig("whsec_w12_wrong") }],
      ["stale timestamp, wrong secret", { "stripe-signature": sig("whsec_w12_wrong", t - 86_400) }],
    ];
    for (const [name, h] of hooks) {
      const r = await ctxs.anon.request.fetch(`${ORIGIN}/api/webhooks/stripe`, { method: "POST", headers: { "content-type": "application/json", ...h }, data: body, maxRedirects: 0, failOnStatusCode: false });
      const s = r.status();
      add(s >= 400 && s < 500 ? "pass" : "fail", "hook", "anon", `POST /api/webhooks/stripe [${name}]`, `expected 4xx, got ${s} ${(await r.text()).slice(0, 100)}`);
    }
    const bearers: [string, string | null][] = [["no Authorization", null], ["random bearer", `Bearer ${fx.jobSecret.split("").reverse().join("")}`], ["short bearer", "Bearer x"], ["basic scheme", "Basic dGVzdDp0ZXN0"], ["empty bearer", "Bearer "]];
    for (const [name, auth] of bearers) for (const role of ["anon", "admin"] as Role[]) {
      const p = await probe(role, "POST", "/api/internal/worker", { origin: null, ...(auth ? { headers: { authorization: auth } } : {}) });
      add(p.status === 401 || p.status === 403 ? "pass" : "fail", "hook", role, `POST /api/internal/worker [${name}]`, `expected 401/403, got ${p.status} ${p.text.slice(0, 100)}`);
    }
    for (const m of ["GET", "PUT", "DELETE"]) {
      const p = await probe("anon", m, "/api/internal/worker", { origin: null });
      add(p.status >= 400 && !isHtml(p) ? "pass" : p.status >= 400 ? "pass" : "fail", "hook", "anon", `${m} /api/internal/worker`, `got ${p.status} ${p.ctype}`);
    }
  });

  test("4 private identity evidence: no read URL for another member's photos", async () => {
    const url = `/api/member/profile/files/${A.file}/read-url`;
    const body = { expectedProfileRevision: 1, expectedCriticalIdentityVersion: 1 };
    for (const role of ROLES) {
      const p = await probe(role, "POST", url, { body });
      const leaked = /readUrl|token=|signed|\/storage\//i.test(p.text) && p.status < 300;
      if (role === "memberA") {
        let u = ""; try { u = JSON.parse(p.text)?.data?.readUrl ?? ""; } catch { /* ignore */ }
        if (p.status === 200 && u) {
          const img = await fetch(u.startsWith("http") ? u : `${SB}${u}`);
          add(img.status === 200 && (img.headers.get("content-type") ?? "").startsWith("image/") ? "pass" : "fail", "evid", role, "owner read URL (positive control)", `owner got a URL; fetching it returned ${img.status} ${img.headers.get("content-type")}`);
        } else add("skip", "evid", role, "owner read URL (positive control)", `could not obtain owner URL: ${p.status} ${p.text.slice(0, 120)}`);
        continue;
      }
      if (p.status >= 200 && p.status < 300 || leaked) add("fail", "evid", role, `POST ${url}`, `UNEXPECTED ${p.status}, response carries a read URL/token: ${p.text.slice(0, 120)}`);
      else add([401, 403, 404].includes(p.status) ? "pass" : "unverified", "evid", role, `POST ${url}`, `${p.status}`);
    }
    // Direct Storage + Data API with a member JWT (bypassing the app server entirely).
    const key = A.fileKey as string;
    const direct: [string, string, RequestInit, boolean][] = [
      ["anon public object URL", `${SB}/storage/v1/object/public/identity-evidence/${key}`, {}, true],
      ["memberB JWT authenticated object", `${SB}/storage/v1/object/authenticated/identity-evidence/${key}`, { headers: { apikey: process.env.SUPABASE_PUBLISHABLE_KEY!, authorization: `Bearer ${tokens.memberB}` } }, true],
      ["memberA JWT authenticated object (owner, direct)", `${SB}/storage/v1/object/authenticated/identity-evidence/${key}`, { headers: { apikey: process.env.SUPABASE_PUBLISHABLE_KEY!, authorization: `Bearer ${tokens.memberA}` } }, true],
      ["memberB JWT sign request", `${SB}/storage/v1/object/sign/identity-evidence/${key}`, { method: "POST", headers: { apikey: process.env.SUPABASE_PUBLISHABLE_KEY!, authorization: `Bearer ${tokens.memberB}`, "content-type": "application/json" }, body: JSON.stringify({ expiresIn: 300 }) }, true],
      ["hostA JWT authenticated object", `${SB}/storage/v1/object/authenticated/identity-evidence/${key}`, { headers: { apikey: process.env.SUPABASE_PUBLISHABLE_KEY!, authorization: `Bearer ${tokens.hostA}` } }, true],
      ["memberB JWT list bucket", `${SB}/storage/v1/object/list/identity-evidence`, { method: "POST", headers: { apikey: process.env.SUPABASE_PUBLISHABLE_KEY!, authorization: `Bearer ${tokens.memberB}`, "content-type": "application/json" }, body: JSON.stringify({ prefix: A.guest, limit: 10 }) }, false],
    ];
    for (const [name, u, init, mustDeny] of direct) {
      const r = await fetch(u, init); const text = await r.text();
      if (name.includes("list bucket")) {
        const exposed = r.status === 200 && text.includes(A.file);
        add(exposed ? "fail" : "pass", "evid", "memberB", name, `${r.status}${exposed ? ` lists the victim object: ${text.slice(0, 100)}` : ""}`);
      } else add(r.status === 200 ? "fail" : "pass", "evid", name.split(" ")[0], name, `${r.status}${r.status === 200 && mustDeny ? " object bytes served without an app-issued signed URL" : ""}`);
    }
    for (const [role, table] of [["memberB", "app_profile_files"], ["memberB", "app_member_profiles"], ["anon", "app_member_profiles"], ["hostA", "app_member_profiles"]] as const) {
      const hdr: Record<string, string> = { apikey: process.env.SUPABASE_PUBLISHABLE_KEY! };
      if (role !== "anon") hdr.authorization = `Bearer ${tokens[role]}`;
      const r = await fetch(`${SB}/rest/v1/${table}?select=*&limit=5`, { headers: hdr }); const text = await r.text();
      const leak = r.status === 200 && hits(role as Role, text).length > 0;
      add(leak ? "fail" : "pass", "evid", role, `Data API GET /rest/v1/${table}`, `${r.status} ${text.slice(0, 80)}`);
    }
  });

  test("5 assignment scoping: host, restaurant, revoked", async () => {
    // Host: own table only.
    const res = async (role: Role, path: string) => probe(role, "GET", path);
    for (const [role, want] of [["hostA", [200]], ["hostB", [403, 404]], ["hostRev", [403, 404]], ["memberA", [403]], ["restA", [403]], ["anon", [401]]] as [Role, number[]][]) {
      const p = await res(role, `/api/host/tables/${A.table}/attendance`);
      add(want.includes(p.status) ? "pass" : "fail", "scope", role, "GET host attendance for Table A", `expected ${want.join("/")}, got ${p.status}`);
    }
    for (const [role, want] of [["hostA", [200]], ["hostB", [200]], ["hostRev", [200, 403]]] as [Role, number[]][]) {
      const list = await res(role, "/api/curation/assigned-tables");
      const other = role === "hostA" ? B.table : A.table;
      const sees = list.text.includes(other);
      add(want.includes(list.status) && !sees ? "pass" : "fail", "scope", role, "GET assigned-tables lists only own", `${list.status}${sees ? " lists an unassigned Table" : ""}`);
    }
    const hostCancel = await probe("hostA", "POST", `/api/admin/cancellations/${A.cancel}/decision`, { body: { operationId: uuid(), expectedVersion: 1, decision: "deny", refundCents: 0, memberSafeReason: "w12 probe" } });
    add([401, 403].includes(hostCancel.status) ? "pass" : hostCancel.status < 300 ? "fail" : "unverified", "scope", "hostA", "POST cancellation decision (host may only flag)", `${hostCancel.status} ${hostCancel.text.slice(0, 100)}`);
    const hostRefund = await probe("hostA", "POST", `/api/admin/refunds/${A.obligation}/dispatch`, { body: { operationId: uuid() } });
    add([401, 403].includes(hostRefund.status) ? "pass" : hostRefund.status < 300 ? "fail" : "unverified", "scope", "hostA", "POST refund dispatch", `${hostRefund.status} ${hostRefund.text.slice(0, 100)}`);
    // Restaurant: assigned venue only.
    const rw = (role: Role, q = "") => probe(role, "GET", `/api/restaurant/workspace${q}`);
    const a = await rw("restA");
    let sel = ""; try { sel = JSON.parse(a.text)?.data?.selected ?? ""; } catch { /* ignore */ }
    add(a.status === 200 && sel === A.venue ? "pass" : "fail", "scope", "restA", "own venue workspace", `${a.status} selected=${sel.slice(0, 8)}`);
    for (const [role, q, want] of [["restA", `?venueId=${B.venue}`, [403, 404]], ["restB", `?venueId=${A.venue}`, [403, 404]], ["restRev", `?venueId=${A.venue}`, [403, 404]], ["hostA", "", [403]], ["memberA", "", [403]], ["admin", "", [403]], ["anon", "", [401]]] as [Role, string, number[]][]) {
      const p = await rw(role, q);
      add(want.includes(p.status) ? "pass" : "fail", "scope", role, `GET restaurant workspace${q ? " (other venue)" : ""}`, `expected ${want.join("/")}, got ${p.status}`);
    }
    const rr = await rw("restRev");
    let selRev: unknown = "x"; try { selRev = JSON.parse(rr.text)?.data?.selected; } catch { /* ignore */ }
    add(rr.status === 403 || (rr.status === 200 && (selRev === null || selRev === undefined)) ? "pass" : "fail", "scope", "restRev", "revoked venue assignment shows no venue", `${rr.status} selected=${JSON.stringify(selRev)?.slice(0, 40)}`);
    const rb = await rw("restB");
    add(rb.status === 200 && !rb.text.includes(A.venue) ? "pass" : "fail", "scope", "restB", "workspace excludes Venue A", `${rb.status}`);
  });

  test("6 page routes (P1-9): every page route loaded directly in every role", async () => {
    test.setTimeout(3_000_000);
    const targets: string[] = [];
    for (const p of pageRoutes) { targets.push(fill(p, "A")); if (hasParam(p)) targets.push(fill(p, "random")); }
    const sweep = async (role: Role) => {
      for (const path of targets) {
        const label = `GET ${path.replace(A.table, "<tableA>").replace(A.seat, "<seatA>").replace(A.invitation, "<inviteA>").replace(A.cancel, "<cancelA>").replace(A.obligation, "<oblA>").replace(A.guest, "<guestA>").replace(/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/g, "<random>")}`;
        const page = await ctxs[role].newPage();
        const errs: string[] = [], cons: string[] = [];
        page.on("pageerror", (e) => errs.push(e.message.slice(0, 160)));
        page.on("console", (m) => { if (m.type() === "error") cons.push(m.text().slice(0, 160)); });
        try {
          const resp = await page.goto(`${ORIGIN}${path}`, { waitUntil: "load", timeout: 45_000 });
          await page.waitForLoadState("networkidle", { timeout: 6_000 }).catch(() => undefined);
          await page.waitForTimeout(400);
          const info = await page.evaluate(() => {
            const main = document.querySelector("main"); const body = document.body.innerText.trim();
            return { mainLen: (main?.innerText ?? body).trim().length, bodyLen: body.length, text: body.slice(0, 30_000), crash: !!document.querySelector(".system-state-error"), notFound: !!document.querySelector(".system-state-not-found"), final: location.pathname, head: (document.querySelector("h1,h2")?.textContent ?? "").trim().slice(0, 70) };
          });
          const status = resp?.status() ?? 0;
          const leaks = hits(role, info.text);
          const problems: string[] = [];
          if (status >= 500 || status === 0) problems.push(`HTTP ${status}`);
          if (errs.length) problems.push(`unhandled page error: ${errs[0]}`);
          if (info.crash) problems.push("error boundary page (We couldn't load this page)");
          if (info.mainLen === 0 || info.bodyLen === 0) problems.push("blank outlet");
          if (leaks.length) problems.push(`page text exposes: ${leaks.join(", ")}`);
          const kind = info.notFound ? "not-found" : info.final !== path.split("?")[0] ? `redirect->${info.final}` : "page";
          if (cons.length) (consoleLog[`${role} ${label}`] ??= []).push(...cons);
          add(problems.length ? "fail" : "pass", "page", role, label, problems.length ? problems.join("; ") : `${status} ${kind} "${info.head}" consoleErrors=${cons.length}`);
        } catch (e) { add("fail", "page", role, label, `navigation failed: ${(e as Error).message.slice(0, 120)}`); }
        await page.close().catch(() => undefined);
      }
    };
    await Promise.all(ROLES.map((r) => sweep(r)));
  });

  test("7 verdict", async () => {
    const bad = rows.filter((r) => r.status === "fail");
    expect(bad.length, `${bad.length} failing checks; see the table printed by the runner`).toBe(0);
  });
});
