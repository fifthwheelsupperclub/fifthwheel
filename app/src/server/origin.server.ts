/** Exact request-origin checks for cookie-authenticated state changes. */

export type ExactOriginDecision =
  | Readonly<{ allowed: true; origin: string }>
  | Readonly<{ allowed: false; reason: "configuration_missing" | "configuration_invalid" | "origin_missing" | "origin_mismatch" }>;

function canonicalOrigin(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const local = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]";
  if (
    url.origin !== value
    || !["http:", "https:"].includes(url.protocol)
    || (url.protocol === "http:" && !local)
    || url.username !== ""
    || url.password !== ""
    || url.pathname !== "/"
    || url.search !== ""
    || url.hash !== ""
  ) return null;
  return value;
}

/**
 * Validate the browser-supplied Origin exactly. Do not infer origin from
 * forwarded headers; absence or bad APP_ORIGIN configuration fails closed.
 */
export function assertExactOrigin(request: Request, expectedOrigin: string | undefined): ExactOriginDecision {
  if (expectedOrigin === undefined || expectedOrigin.trim() === "") {
    return { allowed: false, reason: "configuration_missing" };
  }
  const configured = canonicalOrigin(expectedOrigin);
  if (configured === null) return { allowed: false, reason: "configuration_invalid" };
  const origin = request.headers.get("origin");
  if (origin === null) return { allowed: false, reason: "origin_missing" };
  if (canonicalOrigin(origin) !== configured) return { allowed: false, reason: "origin_mismatch" };
  return { allowed: true, origin: configured };
}
