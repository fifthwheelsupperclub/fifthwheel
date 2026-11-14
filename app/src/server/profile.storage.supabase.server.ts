/** Server-only Supabase Storage adapter for the private identity-evidence bucket. */

import type { ProfileStorage } from "./profile.contract.server.ts";
import type { SupabaseServerConfig } from "./supabase.server.ts";

export class ProfileStorageError extends Error {
  readonly code: "configuration_invalid" | "storage_unavailable" | "object_not_found" | "response_invalid";

  constructor(code: ProfileStorageError["code"]) {
    super(code);
    this.name = "ProfileStorageError";
    this.code = code;
  }
}

function validateConfig(config: SupabaseServerConfig, bucket: string): URL {
  let url: URL;
  try {
    url = new URL(config.url);
  } catch {
    throw new ProfileStorageError("configuration_invalid");
  }
  const isLocal = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    !["http:", "https:"].includes(url.protocol)
    || (url.protocol === "http:" && !isLocal)
    || url.username || url.password || url.pathname !== "/" || url.search || url.hash
    || bucket !== "identity-evidence"
    || !config.secretKey.trim()
  ) {
    throw new ProfileStorageError("configuration_invalid");
  }
  return url;
}

function pathSegments(key: string): string {
  const parts = key.split("/");
  if (!parts.length || parts.some((part) => !part || part === "." || part === ".." || part.length > 180)) {
    throw new ProfileStorageError("configuration_invalid");
  }
  return parts.map(encodeURIComponent).join("/");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function createSupabaseProfileStorage(
  config: SupabaseServerConfig,
  options: Readonly<{ fetcher?: typeof fetch; bucket?: string; now?: () => Date }> = {},
): ProfileStorage {
  const base = validateConfig(config, options.bucket ?? "identity-evidence");
  const fetcher = options.fetcher ?? globalThis.fetch;
  const now = options.now ?? (() => new Date());
  const bucket = "identity-evidence";

  async function request(path: string, init: RequestInit, unavailable: "storage_unavailable" | "object_not_found" = "storage_unavailable") {
    try {
      const response = await fetcher(new URL(path, base), {
        ...init,
        cache: "no-store",
        redirect: "error",
        headers: {
          apikey: config.secretKey,
          authorization: `Bearer ${config.secretKey}`,
          ...(init.headers ?? {}),
        },
      });
      if (!response.ok) {
        if (response.status === 404) throw new ProfileStorageError("object_not_found");
        throw new ProfileStorageError(unavailable);
      }
      return response;
    } catch (error) {
      if (error instanceof ProfileStorageError) throw error;
      throw new ProfileStorageError(unavailable);
    }
  }

  return Object.freeze({
    async upload(key, bytes, contentType) {
      if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1 || bytes.byteLength > 8 * 1024 * 1024
        || !["image/jpeg", "image/png", "image/webp"].includes(contentType)) {
        throw new ProfileStorageError("response_invalid");
      }
      await request(`/storage/v1/object/${bucket}/${pathSegments(key)}`, {
        method: "POST",
        headers: { "content-type": contentType, "x-upsert": "false" },
        body: bytes,
      });
    },

    async remove(keys) {
      const safeKeys = [...new Set(keys.filter((key) => typeof key === "string" && key.length > 0))];
      if (!safeKeys.length) return;
      if (safeKeys.length > 100 || safeKeys.some((key) => key.includes(".."))) {
        throw new ProfileStorageError("configuration_invalid");
      }
      await request(`/storage/v1/object/${bucket}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prefixes: safeKeys }),
      });
    },

    async createReadUrl(key, expiresInSeconds: number = 300) {
      if (!Number.isInteger(expiresInSeconds) || expiresInSeconds < 1 || expiresInSeconds > 300) {
        throw new ProfileStorageError("configuration_invalid");
      }
      const response = await request(`/storage/v1/object/sign/${bucket}/${pathSegments(key)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expiresIn: expiresInSeconds }),
      });
      const body = asRecord(await response.json().catch(() => null));
      if (typeof body?.signedURL !== "string" || !body.signedURL.startsWith("/object/sign/")) {
        throw new ProfileStorageError("response_invalid");
      }
      const url = new URL(`/storage/v1${body.signedURL}`, base).href;
      return { url, expiresAt: new Date(now().getTime() + expiresInSeconds * 1000).toISOString() };
    },

    async download(key) {
      const response = await request(`/storage/v1/object/authenticated/${bucket}/${pathSegments(key)}`, {
        method: "GET",
      }, "object_not_found");
      const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim();
      if (!contentType || !["image/jpeg", "image/png", "image/webp"].includes(contentType)) {
        throw new ProfileStorageError("response_invalid");
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength < 1 || bytes.byteLength > 8 * 1024 * 1024) {
        throw new ProfileStorageError("response_invalid");
      }
      return { bytes, contentType };
    },
  });
}
