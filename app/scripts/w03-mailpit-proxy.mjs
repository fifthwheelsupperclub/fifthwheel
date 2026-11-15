#!/usr/bin/env node

// Run-scoped loopback-only Mailpit fault fixture for the W03 browser test.
// It forwards to the isolated local Mailpit; after a run-scoped invitation is
// accepted by Mailpit, it deliberately drops the response as an HTTP 503 so
// the app records an unknown outcome and must reconcile without resending.

import { createServer } from "node:http";

const host = "127.0.0.1";
const port = 57428;
const upstream = "http://127.0.0.1:57424";
const targetEmail = (process.env.W03_MEMBER_EMAIL ?? "").trim().toLowerCase();
const validTestEmail = /^[a-z0-9._+-]+@example\.test$/;
const maxBodyBytes = 1_048_576;
let forwardedInvitationCount = 0;
let droppedInvitationResponses = 0;
let forwardedSearchCount = 0;
let targetedInvitationAttempts = 0;
let syntheticFailedAttempts = 0;

if (!validTestEmail.test(targetEmail)) {
  process.stderr.write("W03 Mailpit proxy requires a run-scoped .test invitation recipient\n");
  process.exit(2);
}

function sendJson(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", connection: "close" });
  response.end(JSON.stringify(body));
}

async function readRequestBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBodyBytes) throw new Error("body_too_large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function allowedPath(request) {
  if (request.method === "POST" && request.url === "/api/v1/send") return true;
  if (request.method === "GET" && /^\/api\/v1\/search(?:\?.*)?$/.test(request.url ?? "")) return true;
  if (request.method === "GET" && /^\/api\/v1\/message\/[A-Za-z0-9_-]{1,128}$/.test(request.url ?? "")) return true;
  return false;
}

async function proxyRequest(request, response) {
  if (request.method === "GET" && request.url === "/__health") {
    return sendJson(response, 200, {
      ok: true,
      target: "local-mailpit",
      forwardedInvitationCount,
      droppedInvitationResponses,
      forwardedSearchCount,
      targetedInvitationAttempts,
      syntheticFailedAttempts,
    });
  }
  if (!allowedPath(request)) return sendJson(response, 404, { error: "not_found" });

  let body;
  let injectUnknown = false;
  let injectFailure = false;
  if (request.method === "GET" && request.url?.startsWith("/api/v1/search?")) forwardedSearchCount += 1;
  if (request.method === "POST") {
    try { body = await readRequestBody(request); }
    catch { return sendJson(response, 413, { error: "request_too_large" }); }
    let payload;
    try { payload = JSON.parse(body.toString("utf8")); }
    catch { return sendJson(response, 400, { error: "invalid_json" }); }
    const recipients = Array.isArray(payload?.To) ? payload.To : [];
    const exactTarget = recipients.length === 1
      && typeof recipients[0]?.Email === "string"
      && recipients[0].Email.trim().toLowerCase() === targetEmail;
    const isTargetInvitation = payload?.Subject === "Your Fifth Wheel app invitation" && exactTarget;
    if (isTargetInvitation) {
      targetedInvitationAttempts += 1;
      injectFailure = targetedInvitationAttempts === 1;
      injectUnknown = targetedInvitationAttempts === 2;
      if (injectFailure) syntheticFailedAttempts += 1;
      else forwardedInvitationCount += 1;
    }
  }

  if (injectFailure) {
    // Definitive local rejection before dispatch: no Mailpit message is stored.
    return sendJson(response, 400, { error: "local_delivery_rejected" });
  }

  const upstreamUrl = new URL(request.url ?? "/", upstream);
  const headers = {};
  const contentType = request.headers["content-type"];
  if (typeof contentType === "string") headers["content-type"] = contentType;
  headers.accept = "application/json";

  let upstreamResponse;
  try {
    upstreamResponse = await fetch(upstreamUrl, {
      method: request.method,
      ...(body ? { body } : {}),
      headers,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    return sendJson(response, 502, { error: "local_upstream_unavailable" });
  }

  if (injectUnknown && upstreamResponse.ok) {
    // The actual email is now in real local Mailpit, but the app cannot know
    // that until its exact Message-ID and recipient are reconciled.
    droppedInvitationResponses += 1;
    return sendJson(response, 503, { error: "local_delivery_response_lost" });
  }

  const responseBody = Buffer.from(await upstreamResponse.arrayBuffer());
  const responseHeaders = { "cache-control": "no-store", connection: "close" };
  const upstreamContentType = upstreamResponse.headers.get("content-type");
  if (upstreamContentType) responseHeaders["content-type"] = upstreamContentType;
  response.writeHead(upstreamResponse.status, responseHeaders);
  response.end(responseBody);
}

const server = createServer((request, response) => {
  void proxyRequest(request, response).catch(() => {
    if (!response.headersSent) sendJson(response, 502, { error: "local_proxy_error" });
    else response.destroy();
  });
});

server.on("error", (error) => {
  process.stderr.write(error?.code === "EADDRINUSE"
    ? "W03 Mailpit proxy port 57428 is already occupied\n"
    : "W03 Mailpit proxy failed to bind\n");
  process.exit(1);
});

server.listen(port, host, () => {
  process.stdout.write("W03 Mailpit proxy listening on 127.0.0.1:57428\n");
});

process.on("SIGTERM", () => server.close(() => process.exit(0)));
process.on("SIGINT", () => server.close(() => process.exit(0)));
