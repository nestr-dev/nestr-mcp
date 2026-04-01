/**
 * Backward-compatibility re-exports from the OAuthStore abstraction.
 *
 * All types and the store singleton are canonical in store.ts.
 * This file provides synchronous-looking wrappers that delegate to the
 * initialized store for callers that haven't migrated yet.
 *
 * TODO: Remove this file once all callers import from store.ts directly.
 */

import { timingSafeEqual } from "node:crypto";
import { getStore } from "./store.js";

// Re-export types so existing `import { type X } from "./storage.js"` still works
export type {
  RegisteredClient,
  PendingAuthWithPKCE,
  StoredOAuthSession,
  PkceForCodeData,
} from "./store.js";

/**
 * Constant-time string comparison to prevent timing attacks on secrets.
 * Standalone utility — not part of the store interface.
 */
export function constantTimeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Validate redirect URI against a registered client's allowed URIs.
 * Accepts the client object directly to avoid an extra async lookup.
 */
export function validateRedirectUri(
  client: { redirect_uris: string[] },
  redirectUri: string
): boolean {
  return client.redirect_uris.some((uri) => {
    if (uri === redirectUri) return true;

    try {
      const registered = new URL(uri);
      const requested = new URL(redirectUri);
      const isLocal = (hostname: string) =>
        hostname === "localhost" || hostname === "127.0.0.1";

      if (
        isLocal(registered.hostname) &&
        isLocal(requested.hostname) &&
        registered.protocol === "http:" &&
        requested.protocol === "http:" &&
        registered.pathname === requested.pathname
      ) {
        return true;
      }
    } catch {
      // Invalid URLs, skip
    }
    return false;
  });
}

// ============ Async store delegates ============
// These are used by callers that haven't migrated to the store interface yet.

export async function registerClient(...args: Parameters<ReturnType<typeof getStore>["registerClient"]>) {
  return getStore().registerClient(...args);
}

export async function getClient(...args: Parameters<ReturnType<typeof getStore>["getClient"]>) {
  return getStore().getClient(...args);
}

export async function getClientCount() {
  return getStore().getClientCount();
}

export async function clientExists(...args: Parameters<ReturnType<typeof getStore>["clientExists"]>) {
  return getStore().clientExists(...args);
}

export async function storePendingAuth(...args: Parameters<ReturnType<typeof getStore>["storePendingAuth"]>) {
  return getStore().storePendingAuth(...args);
}

export async function consumePendingAuth(...args: Parameters<ReturnType<typeof getStore>["consumePendingAuth"]>) {
  return getStore().consumePendingAuth(...args);
}

export async function storePkceForCode(...args: Parameters<ReturnType<typeof getStore>["storePkceForCode"]>) {
  return getStore().storePkceForCode(...args);
}

export async function consumePkceForCode(...args: Parameters<ReturnType<typeof getStore>["consumePkceForCode"]>) {
  return getStore().consumePkceForCode(...args);
}

export async function storeSession(...args: Parameters<ReturnType<typeof getStore>["storeSession"]>) {
  return getStore().storeSession(...args);
}

export async function getSession(...args: Parameters<ReturnType<typeof getStore>["getSession"]>) {
  return getStore().getSession(...args);
}

export async function updateSession(...args: Parameters<ReturnType<typeof getStore>["updateSession"]>) {
  return getStore().updateSession(...args);
}

export async function removeSession(...args: Parameters<ReturnType<typeof getStore>["removeSession"]>) {
  return getStore().removeSession(...args);
}
