import assert from "node:assert/strict";
import test from "node:test";
import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  buildClearSessionCookieHeaders,
  buildSessionCookieHeaders,
  getAccessTokenForPrincipal,
  parseSessionCookies,
} from "./session.cookies.server.ts";

const accessToken = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJtZW1iZXIifQ.signature_value-123";
const refreshToken = "opaque-refresh-token_1234567890";

test("sets separate HttpOnly Lax cookies, Secure only for HTTPS, with root scope and no Domain", () => {
  const local = buildSessionCookieHeaders({ accessToken, refreshToken }, "http://127.0.0.1:8085/auth/callback?next=%2Fhome");
  assert.equal(local.length, 2);
  assert.match(local[0], new RegExp(`^${ACCESS_TOKEN_COOKIE}=${accessToken.replaceAll(".", "\\.")};`));
  assert.match(local[1], new RegExp(`^${REFRESH_TOKEN_COOKIE}=${refreshToken};`));
  for (const cookie of local) {
    assert.match(cookie, /Path=\//);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);
    assert.doesNotMatch(cookie, /; Secure(?:;|$)/);
    assert.doesNotMatch(cookie, /Domain=/i);
  }

  const secure = buildSessionCookieHeaders({ accessToken, refreshToken }, "https://app.example.test/auth/callback");
  for (const cookie of secure) assert.match(cookie, /; Secure(?:;|$)/);
});

test("clears both cookies with matching scope and HTTPS flag when applicable", () => {
  const clear = buildClearSessionCookieHeaders("https://app.example.test/sign-out");
  assert.equal(clear.length, 2);
  for (const cookie of clear) {
    assert.match(cookie, /Max-Age=0/);
    assert.match(cookie, /Expires=Thu, 01 Jan 1970 00:00:00 GMT/);
    assert.match(cookie, /Path=\//);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);
    assert.match(cookie, /; Secure(?:;|$)/);
    assert.doesNotMatch(cookie, /Domain=/i);
  }
});

test("parses only valid session tokens and ignores unrelated cookies", () => {
  const parsed = parseSessionCookies(`theme=night; ${ACCESS_TOKEN_COOKIE}=${accessToken}; other=value; ${REFRESH_TOKEN_COOKIE}=${refreshToken}`);
  assert.deepEqual(parsed, { accessToken, refreshToken });
  assert.deepEqual(parseSessionCookies("theme=night"), {});
  assert.deepEqual(parseSessionCookies(null), {});
});

test("accepts the 12-character legacy Supabase refresh token and rejects shorter values", () => {
  const legacyRefreshToken = "abcdefghijkl";
  const cookies = buildSessionCookieHeaders({ accessToken, refreshToken: legacyRefreshToken }, "http://127.0.0.1:8085");
  assert.match(cookies[1], new RegExp(`^${REFRESH_TOKEN_COOKIE}=${legacyRefreshToken};`));
  assert.deepEqual(parseSessionCookies(`${ACCESS_TOKEN_COOKIE}=${accessToken}; ${REFRESH_TOKEN_COOKIE}=${legacyRefreshToken}`), {
    accessToken,
    refreshToken: legacyRefreshToken,
  });
  assert.throws(() => buildSessionCookieHeaders({ accessToken, refreshToken: legacyRefreshToken.slice(1) }, "http://127.0.0.1:8085"));
  assert.equal(parseSessionCookies(`${REFRESH_TOKEN_COOKIE}=${legacyRefreshToken.slice(1)}`), null);
});

test("fails closed on malformed pairs, duplicate session cookies and invalid or oversized tokens", () => {
  const invalidHeaders = [
    `${ACCESS_TOKEN_COOKIE}=${accessToken}; ${ACCESS_TOKEN_COOKIE}=${accessToken}`,
    `${REFRESH_TOKEN_COOKIE}=${refreshToken}; ${REFRESH_TOKEN_COOKIE}=${refreshToken}`,
    `${ACCESS_TOKEN_COOKIE}=not-a-jwt`,
    `${ACCESS_TOKEN_COOKIE}=a.b.c%20`,
    `${REFRESH_TOKEN_COOKIE}=short`,
    `${ACCESS_TOKEN_COOKIE}=${"a".repeat(9_000)}.b.c`,
    `${REFRESH_TOKEN_COOKIE}=${"r".repeat(4_097)}`,
    `${ACCESS_TOKEN_COOKIE}=${accessToken}; broken-pair`,
    `${ACCESS_TOKEN_COOKIE}=${accessToken}; invalid name=value`,
    `too-large=${"x".repeat(16_385)}`,
  ];
  for (const header of invalidHeaders) assert.equal(parseSessionCookies(header), null, header.slice(0, 100));
});

test("principal helper returns only the access token and rejects malformed session cookies", () => {
  const request = new Request("http://127.0.0.1:8085/member", {
    headers: { cookie: `${ACCESS_TOKEN_COOKIE}=${accessToken}; ${REFRESH_TOKEN_COOKIE}=${refreshToken}` },
  });
  assert.equal(getAccessTokenForPrincipal(request), accessToken);

  const duplicate = new Request("http://127.0.0.1:8085/member", {
    headers: { cookie: `${ACCESS_TOKEN_COOKIE}=${accessToken}; ${ACCESS_TOKEN_COOKIE}=${accessToken}` },
  });
  assert.equal(getAccessTokenForPrincipal(duplicate), null);
  assert.equal(getAccessTokenForPrincipal(new Request("http://127.0.0.1:8085/member")), null);
});

test("refuses public plain HTTP cookie origins and malformed URLs", () => {
  for (const requestUrl of [
    "http://app.example.test/auth/callback",
    "https://user:pass@app.example.test/auth/callback",
    "file:///tmp/callback",
    "not a URL",
  ]) {
    assert.throws(() => buildSessionCookieHeaders({ accessToken, refreshToken }, requestUrl));
    assert.throws(() => buildClearSessionCookieHeaders(requestUrl));
  }
});
