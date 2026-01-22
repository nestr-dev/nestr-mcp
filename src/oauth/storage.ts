/**
 * Persistent Storage for OAuth Data
 *
 * Stores registered OAuth clients and pending auth requests to disk.
 * Uses a simple JSON file-based storage that persists across restarts.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

// Storage directory - use /data in production (mounted volume), fallback to local .data
const STORAGE_DIR = process.env.OAUTH_STORAGE_DIR ||
  (process.env.NODE_ENV === "production" ? "/data" : ".data");

const CLIENTS_FILE = join(STORAGE_DIR, "oauth-clients.json");
const PENDING_AUTH_FILE = join(STORAGE_DIR, "pending-auth.json");

/**
 * Registered OAuth Client (RFC 7591)
 */
export interface RegisteredClient {
  client_id: string;
  client_secret?: string;
  client_name?: string;
  redirect_uris: string[];
  grant_types: string[];
  response_types: string[];
  token_endpoint_auth_method: string;
  scope?: string;
  registered_at: number;
}

/**
 * Pending OAuth authorization with PKCE
 */
export interface PendingAuthWithPKCE {
  state: string;
  redirectUri: string;
  clientId: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
  createdAt: number;
  scope?: string;
  /** Identifier for the MCP client (e.g., "claude-code", "cursor") for token metadata */
  clientConsumer?: string;
}

// In-memory cache backed by disk
let clientsCache: Map<string, RegisteredClient> | null = null;
let pendingAuthCache: Map<string, PendingAuthWithPKCE> | null = null;

/**
 * Ensure storage directory exists
 */
function ensureStorageDir(): void {
  if (!existsSync(STORAGE_DIR)) {
    mkdirSync(STORAGE_DIR, { recursive: true });
  }
}

/**
 * Load registered clients from disk
 */
function loadClients(): Map<string, RegisteredClient> {
  if (clientsCache) return clientsCache;

  ensureStorageDir();
  clientsCache = new Map();

  if (existsSync(CLIENTS_FILE)) {
    try {
      const data = JSON.parse(readFileSync(CLIENTS_FILE, "utf-8"));
      for (const [id, client] of Object.entries(data)) {
        clientsCache.set(id, client as RegisteredClient);
      }
      console.log(`Loaded ${clientsCache.size} registered OAuth clients`);
    } catch (error) {
      console.error("Failed to load OAuth clients:", error);
    }
  }

  return clientsCache;
}

/**
 * Save registered clients to disk
 */
function saveClients(): void {
  if (!clientsCache) return;

  ensureStorageDir();
  const data: Record<string, RegisteredClient> = {};
  for (const [id, client] of clientsCache) {
    data[id] = client;
  }

  try {
    writeFileSync(CLIENTS_FILE, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error("Failed to save OAuth clients:", error);
  }
}

/**
 * Load pending auth requests from disk
 */
function loadPendingAuth(): Map<string, PendingAuthWithPKCE> {
  if (pendingAuthCache) return pendingAuthCache;

  ensureStorageDir();
  pendingAuthCache = new Map();

  if (existsSync(PENDING_AUTH_FILE)) {
    try {
      const data = JSON.parse(readFileSync(PENDING_AUTH_FILE, "utf-8"));
      const now = Date.now();
      const TTL = 5 * 60 * 1000; // 5 minutes

      for (const [state, pending] of Object.entries(data)) {
        const p = pending as PendingAuthWithPKCE;
        // Only load non-expired entries
        if (now - p.createdAt < TTL) {
          pendingAuthCache.set(state, p);
        }
      }
    } catch (error) {
      console.error("Failed to load pending auth:", error);
    }
  }

  return pendingAuthCache;
}

/**
 * Save pending auth requests to disk
 */
function savePendingAuth(): void {
  if (!pendingAuthCache) return;

  ensureStorageDir();
  const data: Record<string, PendingAuthWithPKCE> = {};
  for (const [state, pending] of pendingAuthCache) {
    data[state] = pending;
  }

  try {
    writeFileSync(PENDING_AUTH_FILE, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error("Failed to save pending auth:", error);
  }
}

// ============ Client Registration ============

/**
 * Register a new OAuth client
 */
export function registerClient(client: RegisteredClient): void {
  const clients = loadClients();
  clients.set(client.client_id, client);
  saveClients();
  console.log(`Registered OAuth client: ${client.client_id}`);
}

/**
 * Get a registered client by ID
 */
export function getClient(clientId: string): RegisteredClient | undefined {
  const clients = loadClients();
  return clients.get(clientId);
}

/**
 * Check if a client ID exists
 */
export function clientExists(clientId: string): boolean {
  const clients = loadClients();
  return clients.has(clientId);
}

/**
 * Validate client credentials
 */
export function validateClientCredentials(
  clientId: string,
  clientSecret?: string
): boolean {
  const client = getClient(clientId);
  if (!client) return false;

  // If client has no secret (public client), accept
  if (!client.client_secret) return true;

  // Otherwise validate secret
  return client.client_secret === clientSecret;
}

/**
 * Validate redirect URI for a client
 */
export function validateRedirectUri(
  clientId: string,
  redirectUri: string
): boolean {
  const client = getClient(clientId);
  if (!client) return false;

  return client.redirect_uris.some((uri) => {
    // Exact match or localhost with any port
    if (uri === redirectUri) return true;

    // Handle localhost wildcards (common for CLI tools)
    try {
      const registered = new URL(uri);
      const requested = new URL(redirectUri);

      if (
        registered.hostname === "localhost" &&
        requested.hostname === "localhost" &&
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

// ============ Pending Auth with PKCE ============

/**
 * Store a pending auth request
 */
export function storePendingAuth(pending: PendingAuthWithPKCE): void {
  const cache = loadPendingAuth();
  cache.set(pending.state, pending);
  savePendingAuth();
}

/**
 * Get and remove a pending auth request
 */
export function consumePendingAuth(
  state: string
): PendingAuthWithPKCE | undefined {
  const cache = loadPendingAuth();
  const pending = cache.get(state);

  if (!pending) return undefined;

  // Check if expired (5 minutes)
  if (Date.now() - pending.createdAt > 5 * 60 * 1000) {
    cache.delete(state);
    savePendingAuth();
    return undefined;
  }

  // Remove from cache (one-time use)
  cache.delete(state);
  savePendingAuth();

  return pending;
}

/**
 * Cleanup expired pending auth requests
 */
export function cleanupExpiredPendingAuth(): void {
  const cache = loadPendingAuth();
  const now = Date.now();
  const TTL = 5 * 60 * 1000;
  let cleaned = 0;

  for (const [state, pending] of cache) {
    if (now - pending.createdAt > TTL) {
      cache.delete(state);
      cleaned++;
    }
  }

  if (cleaned > 0) {
    savePendingAuth();
  }
}

// Run cleanup every minute
setInterval(cleanupExpiredPendingAuth, 60000);
