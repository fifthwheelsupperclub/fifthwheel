import assert from "node:assert/strict";
import test from "node:test";
import { createSupabaseProfileStorage, ProfileStorageError } from "./profile.storage.supabase.server.ts";

const config = {
  url: "http://127.0.0.1:57421",
  publishableKey: "test-publishable",
  secretKey: "server-only-secret",
};

test("W04-UPLOAD-01: storage uploads use the server secret, private bucket, and no-upsert POST", async () => {
  const captured: { value: { url: URL; init: RequestInit } | null } = { value: null };
  const storage = createSupabaseProfileStorage(config, {
    fetcher: async (input, init) => {
      captured.value = { url: new URL(String(input)), init: init ?? {} };
      return new Response(JSON.stringify({ Key: "identity-evidence/quarantine/g/f" }), { status: 200 });
    },
  });
  await storage.upload("quarantine/20000000-0000-4000-8000-000000000001/30000000-0000-4000-8000-000000000001", new Uint8Array([1, 2]), "image/jpeg");
  const request = captured.value!;
  assert.equal(request.url.pathname, "/storage/v1/object/identity-evidence/quarantine/20000000-0000-4000-8000-000000000001/30000000-0000-4000-8000-000000000001");
  assert.equal(request.init.method, "POST");
  assert.equal(new Headers(request.init.headers).get("authorization"), "Bearer server-only-secret");
  assert.equal(new Headers(request.init.headers).get("x-upsert"), "false");
  assert.equal(new Headers(request.init.headers).get("content-type"), "image/jpeg");
});

test("W04-REVIEW-01: private signed read URL preserves Storage API prefix and is capped at five minutes", async () => {
  let seenUrl = "";
  const storage = createSupabaseProfileStorage(config, {
    fetcher: async (input) => {
      seenUrl = String(input);
      return new Response(JSON.stringify({ signedURL: "/object/sign/identity-evidence/normalized/g/f?token=opaque" }), { status: 200 });
    },
    now: () => new Date("2026-11-12T17:00:00.000Z"),
  });
  const signed = await storage.createReadUrl("normalized/g/f", 300);
  assert.equal(seenUrl, "http://127.0.0.1:57421/storage/v1/object/sign/identity-evidence/normalized/g/f");
  assert.equal(signed.url, "http://127.0.0.1:57421/storage/v1/object/sign/identity-evidence/normalized/g/f?token=opaque");
  assert.equal(signed.expiresAt, "2026-11-12T17:05:00.000Z");
  await assert.rejects(() => storage.createReadUrl("normalized/g/f", 301), ProfileStorageError);
});

test("W04-UPLOAD-02: remove uses exact server-generated keys and never upserts", async () => {
  const captured: { value: { url: URL; init: RequestInit } | null } = { value: null };
  const storage = createSupabaseProfileStorage(config, {
    fetcher: async (input, init) => {
      captured.value = { url: new URL(String(input)), init: init ?? {} };
      return new Response("[]", { status: 200 });
    },
  });
  await storage.remove(["quarantine/g/f", "normalized/g/f"]);
  const request = captured.value!;
  assert.equal(request.url.pathname, "/storage/v1/object/identity-evidence");
  assert.equal(request.init.method, "DELETE");
  assert.deepEqual(JSON.parse(String(request.init.body)), { prefixes: ["quarantine/g/f", "normalized/g/f"] });
  await assert.rejects(() => storage.remove(["../other-bucket/file"]), ProfileStorageError);
});

test("storage adapter rejects oversized data, untrusted bucket config, and invalid response shapes", async () => {
  const storage = createSupabaseProfileStorage(config, { fetcher: async () => new Response("{}", { status: 200 }) });
  await assert.rejects(() => storage.upload("quarantine/g/f", new Uint8Array(8 * 1024 * 1024 + 1), "image/jpeg"), ProfileStorageError);
  assert.throws(() => createSupabaseProfileStorage(config, { bucket: "public-assets" }), ProfileStorageError);
  await assert.rejects(() => storage.createReadUrl("normalized/g/f", 300), ProfileStorageError);
});

test("download reads only allowed bounded image content through authenticated private Storage API", async () => {
  const captured: { value: { url: URL; init: RequestInit } | null } = { value: null };
  const storage = createSupabaseProfileStorage(config, {
    fetcher: async (input, init) => {
      captured.value = { url: new URL(String(input)), init: init ?? {} };
      return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "image/png" } });
    },
  });
  const downloaded = await storage.download("quarantine/g/f");
  const request = captured.value!;
  assert.equal(request.url.pathname, "/storage/v1/object/authenticated/identity-evidence/quarantine/g/f");
  assert.equal(new Headers(request.init.headers).get("authorization"), "Bearer server-only-secret");
  assert.equal(downloaded.contentType, "image/png");
  assert.equal(downloaded.bytes.byteLength, 3);
});
