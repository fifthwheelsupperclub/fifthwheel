import assert from "node:assert/strict";
import test from "node:test";
import {
  createSupabaseAuthLinkProvider,
  SupabaseAuthLinkError,
} from "./auth.link.supabase.server.ts";

const authUserId = "3d7d1b79-b06e-43c4-85f4-9b222d7cecc7";
const email = "member@example.test";
const config = {
  url: "http://127.0.0.1:56421",
  publishableKey: "local-publishable-key",
  secretKey: "local-server-secret-key",
  siteUrl: "http://127.0.0.1:8085",
  allowedCallbackUrls: ["http://127.0.0.1:8085/auth/callback"],
} as const;
const actionLink = "http://127.0.0.1:56421/auth/v1/verify?token_hash=0123456789abcdef0123456789abcdef&type=invite&redirect_to=http%3A%2F%2F127.0.0.1%3A8085%2Fauth%2Fcallback";
const hashedToken = "0123456789abcdef0123456789abcdef";
const appCallbackLink = `${config.allowedCallbackUrls[0]}?token_hash=${hashedToken}&type=invite`;

function generatedLinkResponse(overrides: Record<string, unknown> = {}): Response {
  return new Response(JSON.stringify({
    id: authUserId,
    email,
    action_link: actionLink,
    verification_type: "invite",
    redirect_to: config.allowedCallbackUrls[0],
    hashed_token: hashedToken,
    ...overrides,
  }), { status: 200, headers: { "content-type": "application/json" } });
}

function verifyResponse(overrides: Record<string, unknown> = {}): Response {
  return new Response(JSON.stringify({
    access_token: "access-token-value-long-enough",
    refresh_token: "refresh-token-value-long-enough",
    token_type: "bearer",
    user: {
      id: authUserId,
      email,
      email_confirmed_at: "2026-11-12T12:00:00.000Z",
      user_metadata: { role: "admin" },
    },
    ...overrides,
  }), { status: 200, headers: { "content-type": "application/json" } });
}

function assertProviderError(error: unknown, code: SupabaseAuthLinkError["code"]): asserts error is SupabaseAuthLinkError {
  assert.ok(error instanceof SupabaseAuthLinkError);
  assert.equal(error.code, code);
  assert.equal(error.message, code);
}

test("creates a validated invite link using only server-secret admin headers", async () => {
  let requestUrl: URL | undefined;
  let requestInit: RequestInit | undefined;
  const provider = createSupabaseAuthLinkProvider(config, async (input, init) => {
    requestUrl = new URL(String(input));
    requestInit = init;
    return generatedLinkResponse();
  });

  const result = await provider.createMagicLink({
    emailNormalized: email,
    redirectTo: config.allowedCallbackUrls[0],
    kind: "invite",
  });
  assert.deepEqual(result, { actionLink: appCallbackLink, authUserId });
  assert.equal(result.actionLink.startsWith("http://127.0.0.1:8085/auth/callback?"), true);
  assert.equal(result.actionLink.includes("56421"), false);
  assert.equal(new URL(result.actionLink).searchParams.get("token_hash"), hashedToken);
  assert.equal(new URL(result.actionLink).searchParams.get("type"), "invite");
  assert.equal(requestUrl?.href, "http://127.0.0.1:56421/auth/v1/admin/generate_link");
  assert.equal(requestUrl?.search, "");
  assert.equal(requestInit?.method, "POST");
  assert.equal(requestInit?.cache, "no-store");
  assert.equal(requestInit?.redirect, "error");
  const headers = new Headers(requestInit?.headers);
  assert.equal(headers.get("apikey"), config.secretKey);
  assert.equal(headers.get("authorization"), `Bearer ${config.secretKey}`);
  const body = JSON.parse(String(requestInit?.body)) as Record<string, unknown>;
  assert.deepEqual(body, { type: "invite", email, redirect_to: config.allowedCallbackUrls[0] });
});

test("creates a magiclink with exact allowed callback and normalized recipient", async () => {
  let requestBody: Record<string, unknown> | undefined;
  const magicLink = actionLink.replace("type=invite", "type=magiclink");
  const provider = createSupabaseAuthLinkProvider(config, async (_input, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return generatedLinkResponse({
      email: email.toUpperCase(),
      action_link: magicLink,
      verification_type: "magiclink",
    });
  });
  const result = await provider.createMagicLink({
    emailNormalized: email,
    redirectTo: config.allowedCallbackUrls[0],
    kind: "magiclink",
  });
  assert.equal(result.actionLink, `${config.allowedCallbackUrls[0]}?token_hash=${hashedToken}&type=magiclink`);
  assert.notEqual(result.actionLink, magicLink);
  assert.deepEqual(requestBody, { type: "magiclink", email, redirect_to: config.allowedCallbackUrls[0] });
});

test("rejects plain-http remote hosts, credentialed, path-bearing and broadened callback configuration", () => {
  const badConfigs = [
    { ...config, url: "http://supabase.example.test:56421" },
    { ...config, url: "http://user:pass@127.0.0.1:56421" },
    { ...config, url: "http://127.0.0.1:56421/nested" },
    { ...config, siteUrl: "http://app.example.test" },
    { ...config, allowedCallbackUrls: ["http://127.0.0.1:8085/auth/callback", "http://127.0.0.1:8085/elsewhere"] },
    { ...config, allowedCallbackUrls: ["http://127.0.0.1:8085/auth/callback/"] },
    { ...config, secretKey: config.publishableKey },
  ];
  for (const candidate of badConfigs) {
    assert.throws(
      () => createSupabaseAuthLinkProvider(candidate, async () => new Response()),
      (error: unknown) => error instanceof SupabaseAuthLinkError && error.code === "configuration_invalid",
    );
  }
});

test("rejects unsafe generation input before making an Auth request", async () => {
  let calls = 0;
  const provider = createSupabaseAuthLinkProvider(config, async () => {
    calls += 1;
    return generatedLinkResponse();
  });
  const badInputs = [
    { emailNormalized: "Member@example.test", redirectTo: config.allowedCallbackUrls[0], kind: "invite" },
    { emailNormalized: email, redirectTo: "http://127.0.0.1:8085/other", kind: "invite" },
    { emailNormalized: email, redirectTo: config.allowedCallbackUrls[0], kind: "recovery" },
    { emailNormalized: "one,two@example.test", redirectTo: config.allowedCallbackUrls[0], kind: "invite" },
  ];
  for (const value of badInputs) {
    await assert.rejects(
      () => provider.createMagicLink(value as Parameters<typeof provider.createMagicLink>[0]),
      (error: unknown) => error instanceof SupabaseAuthLinkError && error.code === "input_invalid",
    );
  }
  assert.equal(calls, 0);
});

test("rejects generated links with wrong recipient, id, kind, callback or origin", async () => {
  const invalidResponses = [
    generatedLinkResponse({ email: "other@example.test" }),
    generatedLinkResponse({ id: "not-a-uuid" }),
    generatedLinkResponse({ verification_type: "magiclink" }),
    generatedLinkResponse({ redirect_to: "http://127.0.0.1:8085/elsewhere" }),
    generatedLinkResponse({ action_link: actionLink.replace("127.0.0.1:56421", "auth.example.test") }),
    generatedLinkResponse({ action_link: actionLink.replace("/auth/v1/verify", "/evil") }),
    generatedLinkResponse({ action_link: actionLink.replace("redirect_to=http%3A%2F%2F127.0.0.1%3A8085%2Fauth%2Fcallback", "redirect_to=https%3A%2F%2Fevil.example") }),
    generatedLinkResponse({ hashed_token: "short" }),
    generatedLinkResponse({ action_link: "not a url" }),
  ];
  for (const response of invalidResponses) {
    const provider = createSupabaseAuthLinkProvider(config, async () => response);
    await assert.rejects(
      () => provider.createMagicLink({ emailNormalized: email, redirectTo: config.allowedCallbackUrls[0], kind: "invite" }),
      (error: unknown) => error instanceof SupabaseAuthLinkError && error.code === "provider_data_invalid",
    );
  }
});

test("exchanges only supported token hashes and exposes validated identity and session", async () => {
  let requestUrl: URL | undefined;
  let requestInit: RequestInit | undefined;
  const provider = createSupabaseAuthLinkProvider(config, async (input, init) => {
    requestUrl = new URL(String(input));
    requestInit = init;
    return verifyResponse();
  });
  const result = await provider.verifyCallback({ tokenHash: "0123456789abcdef0123456789abcdef", kind: "magiclink" });
  assert.deepEqual(result, {
    identity: { authUserId, emailNormalized: email, emailVerified: true },
    session: { accessToken: "access-token-value-long-enough", refreshToken: "refresh-token-value-long-enough" },
  });
  assert.equal(requestUrl?.href, "http://127.0.0.1:56421/auth/v1/verify");
  assert.equal(requestInit?.method, "POST");
  const headers = new Headers(requestInit?.headers);
  assert.equal(headers.get("apikey"), config.publishableKey);
  assert.equal(headers.get("authorization"), null);
  assert.equal(headers.get("apikey")?.includes(config.secretKey), false);
  assert.deepEqual(JSON.parse(String(requestInit?.body)), {
    token_hash: "0123456789abcdef0123456789abcdef",
    type: "magiclink",
  });
});

test("rejects unsupported or malformed callback inputs before Auth request", async () => {
  let calls = 0;
  const provider = createSupabaseAuthLinkProvider(config, async () => {
    calls += 1;
    return verifyResponse();
  });
  const badInputs = [
    { tokenHash: "short", kind: "invite" },
    { tokenHash: "0123456789abcdef0123456789abcdef\n", kind: "invite" },
    { tokenHash: "0123456789abcdef0123456789abcdef", kind: "signup" },
  ];
  for (const value of badInputs) {
    await assert.rejects(
      () => provider.verifyCallback(value as Parameters<typeof provider.verifyCallback>[0]),
      (error: unknown) => error instanceof SupabaseAuthLinkError && error.code === "input_invalid",
    );
  }
  assert.equal(calls, 0);
});

test("requires verified email, valid user UUID and complete session in callback response", async () => {
  const invalidResponses = [
    verifyResponse({ user: { id: authUserId, email, email_confirmed_at: null } }),
    verifyResponse({ user: { id: "bad-id", email, email_confirmed_at: "2026-11-12T12:00:00Z" } }),
    verifyResponse({ user: { id: authUserId, email: "not-an-email", email_confirmed_at: "2026-11-12T12:00:00Z" } }),
    verifyResponse({ refresh_token: null }),
    verifyResponse({ refresh_token: "12345678901" }),
    verifyResponse({ access_token: "short" }),
    verifyResponse({ user: null }),
  ];
  for (const response of invalidResponses) {
    const provider = createSupabaseAuthLinkProvider(config, async () => response);
    await assert.rejects(
      () => provider.verifyCallback({ tokenHash: "0123456789abcdef0123456789abcdef", kind: "invite" }),
      (error: unknown) => error instanceof SupabaseAuthLinkError && error.code === "provider_data_invalid",
    );
  }
});

test("accepts Supabase legacy refresh tokens at 12 characters and rejects shorter values", async () => {
  const legacyRefreshToken = "123456789012";
  const provider = createSupabaseAuthLinkProvider(config, async () => verifyResponse({ refresh_token: legacyRefreshToken }));
  const verified = await provider.verifyCallback({ tokenHash: hashedToken, kind: "magiclink" });
  assert.equal(verified.session.refreshToken, legacyRefreshToken);

  const tooShort = createSupabaseAuthLinkProvider(config, async () => verifyResponse({ refresh_token: legacyRefreshToken.slice(1) }));
  await assert.rejects(
    () => tooShort.verifyCallback({ tokenHash: hashedToken, kind: "magiclink" }),
    (error: unknown) => error instanceof SupabaseAuthLinkError && error.code === "provider_data_invalid",
  );
});

test("maps provider rejection, uncertainty and malformed responses to safe errors", async () => {
  const rejected = createSupabaseAuthLinkProvider(config, async () => new Response("private provider text", { status: 400 }));
  await assert.rejects(
    () => rejected.createMagicLink({ emailNormalized: email, redirectTo: config.allowedCallbackUrls[0], kind: "invite" }),
    (error: unknown) => {
      assertProviderError(error, "provider_rejected");
      assert.equal(error.message.includes("private provider text"), false);
      return true;
    },
  );
  const uncertain = createSupabaseAuthLinkProvider(config, async () => { throw new Error("secret transport detail"); });
  await assert.rejects(
    () => uncertain.createMagicLink({ emailNormalized: email, redirectTo: config.allowedCallbackUrls[0], kind: "invite" }),
    (error: unknown) => {
      assertProviderError(error, "provider_outcome_unknown");
      assert.equal(error.message.includes("secret transport detail"), false);
      return true;
    },
  );
  const malformed = createSupabaseAuthLinkProvider(config, async () => new Response("not-json", { status: 200 }));
  await assert.rejects(
    () => malformed.verifyCallback({ tokenHash: "0123456789abcdef0123456789abcdef", kind: "invite" }),
    (error: unknown) => error instanceof SupabaseAuthLinkError && error.code === "provider_data_invalid",
  );
});

test("accepts a hosted https Supabase project and https app origin", async () => {
  const hosted = {
    url: "https://projectref.supabase.co", publishableKey: "sb_publishable_x", secretKey: "sb_secret_x",
    siteUrl: "https://app.example.test", allowedCallbackUrls: ["https://app.example.test/auth/callback"],
  } as const;
  const link = `${hosted.url}/auth/v1/verify?token_hash=${hashedToken}&type=magiclink&redirect_to=${encodeURIComponent(hosted.allowedCallbackUrls[0])}`;
  const provider = createSupabaseAuthLinkProvider(hosted, async () => generatedLinkResponse({
    action_link: link, verification_type: "magiclink", redirect_to: hosted.allowedCallbackUrls[0],
  }));
  const result = await provider.createMagicLink({ emailNormalized: email, redirectTo: hosted.allowedCallbackUrls[0], kind: "magiclink" });
  assert.equal(result.actionLink, `https://app.example.test/auth/callback?token_hash=${hashedToken}&type=magiclink`);
});
