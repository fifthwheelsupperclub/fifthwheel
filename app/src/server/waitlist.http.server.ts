/** Server-only HTTP boundary for the public marketing waitlist endpoint. */

import { createHmac, randomBytes } from "node:crypto";
import type { ServiceResult, WaitlistSubmitResponse } from "./admission.contracts.server.ts";
import type { WaitlistService } from "./waitlist.service.server.ts";

const maxBodyCharacters = 16_384;
const allowedRequestHeaders = new Set(["accept", "content-type"]);

export type WaitlistRateLimitDecision = Readonly<{
  allowed: boolean;
  retryAfterSeconds?: number;
}>;

export interface WaitlistRateLimiter {
  consume(request: Request): WaitlistRateLimitDecision | Promise<WaitlistRateLimitDecision>;
}

export type WaitlistPostHandlerOptions = Readonly<{
  /** Canonical marketing page origin, e.g. https://fifthwheel.community. */
  allowedOrigin?: string;
  mode?: "development" | "test" | "production";
  limiter?: WaitlistRateLimiter;
}>;

export type BoundedWaitlistRateLimiterOptions = Readonly<{
  secret?: string;
  maxRequests?: number;
  windowMs?: number;
  maxKeys?: number;
  now?: () => number;
  /** Optional trusted server-side peer identity; never pass a client header here. */
  getTrustedClientAddress?: (request: Request) => string | null;
}>;

function jsonResponse(status: number, value: unknown, headers: HeadersInit = {}): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("content-type", "application/json; charset=utf-8");
  responseHeaders.set("cache-control", "no-store");
  return new Response(JSON.stringify(value), { status, headers: responseHeaders });
}

function localHost(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]";
}

function canonicalAllowedOrigin(value: string | undefined): string | null {
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (
    url.origin !== value
    || !["http:", "https:"].includes(url.protocol)
    || (url.protocol === "http:" && !localHost(url.hostname))
    || url.username !== ""
    || url.password !== ""
    || url.pathname !== "/"
    || url.search !== ""
    || url.hash !== ""
  ) return null;
  return value;
}

function originAllowed(request: Request, configuredOrigin: string | null): boolean {
  const origin = request.headers.get("origin");
  if (origin === null) return true;
  if (configuredOrigin === null) return false;
  try {
    const parsed = new URL(origin);
    return parsed.origin === configuredOrigin && origin === configuredOrigin;
  } catch {
    return false;
  }
}

function corsHeaders(origin: string | null): Headers {
  const headers = new Headers({ vary: "Origin" });
  if (origin !== null) headers.set("access-control-allow-origin", origin);
  return headers;
}

function preflightHeaders(origin: string): Headers {
  return new Headers({
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "accept, content-type",
    "access-control-max-age": "600",
    vary: "Origin, Access-Control-Request-Method, Access-Control-Request-Headers",
  });
}

function validPreflightHeaders(request: Request): boolean {
  if (request.headers.get("access-control-request-method") !== "POST") return false;
  const requestedHeaders = (request.headers.get("access-control-request-headers") ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return requestedHeaders.every((header) => allowedRequestHeaders.has(header));
}

function opaqueKey(secret: string, value: string): string {
  return createHmac("sha256", secret).update(value).digest("hex");
}

/**
 * Bounded, process-local limiter for local previews only. It stores opaque
 * HMAC digests, never raw address values. Production must inject a durable
 * shared limiter; the route otherwise fails closed.
 */
export function createBoundedWaitlistRateLimiter(
  options: BoundedWaitlistRateLimiterOptions = {},
): WaitlistRateLimiter {
  const secret = options.secret ?? randomBytes(32).toString("hex");
  const maxRequests = options.maxRequests ?? 8;
  const windowMs = options.windowMs ?? 10 * 60 * 1000;
  const maxKeys = options.maxKeys ?? 500;
  const now = options.now ?? Date.now;
  const getTrustedClientAddress = options.getTrustedClientAddress;
  if (!secret || !Number.isSafeInteger(maxRequests) || maxRequests < 1
    || !Number.isSafeInteger(windowMs) || windowMs < 1
    || !Number.isSafeInteger(maxKeys) || maxKeys < 1) {
    throw new Error("waitlist_rate_limiter_configuration_invalid");
  }

  const buckets = new Map<string, { startedAt: number; count: number; lastSeenAt: number }>();
  return Object.freeze({
    consume(request: Request): WaitlistRateLimitDecision {
      const timestamp = now();
      for (const [key, bucket] of buckets) {
        if (timestamp - bucket.startedAt >= windowMs) buckets.delete(key);
      }
      // The Fetch Request API does not expose the socket peer. Unless the
      // server adapter supplies a trusted address callback, share one local
      // bucket instead of trusting spoofable X-Forwarded-For/X-Real-IP values.
      const trustedAddress = getTrustedClientAddress?.(request);
      const clientAddress = (trustedAddress && trustedAddress.trim() ? trustedAddress.trim() : "local-shared-bucket").slice(0, 200);
      const key = opaqueKey(secret, clientAddress);
      let bucket = buckets.get(key);
      if (!bucket || timestamp - bucket.startedAt >= windowMs) {
        if (buckets.size >= maxKeys) {
          let oldestKey: string | null = null;
          let oldestSeen = Number.POSITIVE_INFINITY;
          for (const [candidateKey, candidate] of buckets) {
            if (candidate.lastSeenAt < oldestSeen) {
              oldestKey = candidateKey;
              oldestSeen = candidate.lastSeenAt;
            }
          }
          if (oldestKey !== null) buckets.delete(oldestKey);
        }
        bucket = { startedAt: timestamp, count: 0, lastSeenAt: timestamp };
        buckets.set(key, bucket);
      }
      bucket.lastSeenAt = timestamp;
      if (bucket.count >= maxRequests) {
        return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((windowMs - (timestamp - bucket.startedAt)) / 1000)) };
      }
      bucket.count += 1;
      return { allowed: true };
    },
  });
}

function rateLimitResponse(headers: Headers, retryAfterSeconds: number): Response {
  headers.set("retry-after", String(Math.max(1, Math.ceil(retryAfterSeconds))));
  return jsonResponse(429, {
    error: { code: "rate_limited", safeMessage: "Please wait a little before submitting again." },
  }, headers);
}

/** Create a handler with injected service, CORS origin, and local/shared limiter. */
export function createWaitlistPostHandler(
  createService: () => WaitlistService,
  options: WaitlistPostHandlerOptions = {},
) {
  const configuredOrigin = canonicalAllowedOrigin(options.allowedOrigin);
  const invalidOriginConfig = options.allowedOrigin !== undefined && configuredOrigin === null;
  const mode = options.mode ?? "development";
  const limiter = options.limiter ?? (mode === "production" ? undefined : createBoundedWaitlistRateLimiter());

  return async function postWaitlist(request: Request): Promise<Response> {
    if (invalidOriginConfig) {
      return jsonResponse(503, { error: { code: "temporarily_unavailable", safeMessage: "The form endpoint is not configured." } });
    }
    if (!originAllowed(request, configuredOrigin)) {
      return jsonResponse(403, { error: { code: "forbidden", safeMessage: "This form origin is not allowed." } }, { vary: "Origin" });
    }
    const requestOrigin = request.headers.get("origin");
    const headers = corsHeaders(requestOrigin === configuredOrigin ? configuredOrigin : null);

    if (request.method === "OPTIONS") {
      if (requestOrigin !== configuredOrigin || configuredOrigin === null || !validPreflightHeaders(request)) {
        return jsonResponse(403, { error: { code: "forbidden", safeMessage: "This form origin is not allowed." } }, headers);
      }
      headers.set("access-control-allow-origin", configuredOrigin);
      const resultHeaders = preflightHeaders(configuredOrigin);
      return new Response(null, { status: 204, headers: resultHeaders });
    }
    if (request.method !== "POST") {
      return jsonResponse(405, { error: { code: "method_not_allowed", safeMessage: "Use POST to submit this form." } }, headers);
    }
    if (!limiter) {
      return jsonResponse(503, { error: { code: "temporarily_unavailable", safeMessage: "The form endpoint is not configured." } }, headers);
    }
    let limit: WaitlistRateLimitDecision;
    try {
      limit = await limiter.consume(request);
    } catch {
      return jsonResponse(503, { error: { code: "temporarily_unavailable", safeMessage: "We couldn’t receive the form right now. Try again shortly." } }, headers);
    }
    if (!limit.allowed) return rateLimitResponse(headers, limit.retryAfterSeconds ?? 60);
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) {
      return jsonResponse(415, { error: { code: "invalid_content_type", safeMessage: "Submit the form as JSON." } }, headers);
    }

    let rawBody: string;
    try {
      rawBody = await request.text();
    } catch {
      return jsonResponse(400, { error: { code: "invalid_request", safeMessage: "Submit a valid waitlist form." } }, headers);
    }
    if (rawBody.length > maxBodyCharacters) {
      return jsonResponse(413, { error: { code: "request_too_large", safeMessage: "The form is too large to submit." } }, headers);
    }

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody) as unknown;
    } catch {
      return jsonResponse(400, { error: { code: "invalid_request", safeMessage: "Submit a valid waitlist form." } }, headers);
    }

    let result: ServiceResult<WaitlistSubmitResponse>;
    try {
      result = await createService().submit(payload);
    } catch {
      return jsonResponse(503, { error: { code: "temporarily_unavailable", safeMessage: "We couldn’t receive the form right now. Try again shortly." } }, headers);
    }
    if (result.ok) return jsonResponse(200, result.value, headers);
    const status = result.error.code === "validation_failed" ? 400 : 503;
    return jsonResponse(status, { error: result.error }, headers);
  };
}
