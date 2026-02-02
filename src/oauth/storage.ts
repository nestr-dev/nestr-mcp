/**
 * Persistent Storage for OAuth Data
 *
 * Stores registered OAuth clients and pending auth requests to disk.
 * Uses a simple JSON file-based storage that persists across restarts.
 * OAuth sessions are encrypted at rest using AES-256-GCM.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";

// Storage directory - use /data in production (mounted volume), fallback to local .data
const STORAGE_DIR = process.env.OAUTH_STORAGE_DIR ||
  (process.env.NODE_ENV === "production" ? "/data" : ".data");

const CLIENTS_FILE = join(STORAGE_DIR, "oauth-clients.json");
const PENDING_AUTH_FILE = join(STORAGE_DIR, "pending-auth.json");
const SESSIONS_FILE_ENCRYPTED = join(STORAGE_DIR, "oauth-sessions.enc");
const SESSIONS_FILE_PLAINTEXT = join(STORAGE_DIR, "oauth-sessions.json");

// Encryption constants
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;

/**
 * Check if encryption is enabled (OAUTH_ENCRYPTION_KEY env var is set)
 */
function isEncryptionEnabled(): boolean {
  return !!process.env.OAUTH_ENCRYPTION_KEY;
}

/**
 * Get the encryption key from environment variable.
 * Returns null if not set.
 */
function getEncryptionKey(): Buffer | null {
  if (!process.env.OAUTH_ENCRYPTION_KEY) {
    return null;
  }

  const key = Buffer.from(process.env.OAUTH_ENCRYPTION_KEY, "base64");
  if (key.length !== 32) {
    throw new Error("OAUTH_ENCRYPTION_KEY must be 32 bytes (256 bits) base64-encoded");
  }
  return key;
}

/**
 * Encrypt data using AES-256-GCM
 */
function encrypt(data: string, key: Buffer): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(data, "utf8", "base64");
  encrypted += cipher.final("base64");
  const authTag = cipher.getAuthTag();

  // Format: iv:authTag:encryptedData (all base64)
  return `${iv.toString("base64")}:${authTag.toString("base64")}:${encrypted}`;
}

/**
 * Decrypt data using AES-256-GCM
 */
function decrypt(encryptedData: string, key: Buffer): string {
  const parts = encryptedData.split(":");

  if (parts.length !== 3) {
    throw new Error("Invalid encrypted data format");
  }

  const iv = Buffer.from(parts[0], "base64");
  const authTag = Buffer.from(parts[1], "base64");
  const data = parts[2];

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(data, "base64", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

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
  /** GA4 client_id for cross-domain analytics tracking */
  gaClientId?: string;
}

/**
 * Stored OAuth session after successful authentication
 */
export interface StoredOAuthSession {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  scope?: string;
  /** Nestr user ID for analytics (GA4 user_id) */
  userId?: string;
}

// In-memory cache backed by disk
let clientsCache: Map<string, RegisteredClient> | null = null;
let pendingAuthCache: Map<string, PendingAuthWithPKCE> | null = null;
let sessionsCache: Map<string, StoredOAuthSession> | null = null;

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

// ============ OAuth Sessions ============
// Uses plaintext storage by default, encrypted storage when OAUTH_ENCRYPTION_KEY is set

/**
 * Migrate plaintext sessions to encrypted format when encryption key is added
 */
function migrateToEncrypted(key: Buffer): Map<string, StoredOAuthSession> | null {
  if (!existsSync(SESSIONS_FILE_PLAINTEXT)) {
    return null;
  }

  try {
    const data = JSON.parse(readFileSync(SESSIONS_FILE_PLAINTEXT, "utf-8"));
    const sessions = new Map<string, StoredOAuthSession>();

    for (const [id, session] of Object.entries(data)) {
      sessions.set(id, session as StoredOAuthSession);
    }

    console.log(`Migrating ${sessions.size} OAuth sessions from plaintext to encrypted storage`);

    // Save encrypted version
    const plaintext = JSON.stringify(data);
    const encrypted = encrypt(plaintext, key);
    writeFileSync(SESSIONS_FILE_ENCRYPTED, encrypted, { mode: 0o600 });

    // Remove plaintext file
    unlinkSync(SESSIONS_FILE_PLAINTEXT);
    console.log("Migration complete - plaintext sessions file removed");

    return sessions;
  } catch (error) {
    console.error("Failed to migrate sessions to encrypted:", error);
    return null;
  }
}

/**
 * Load OAuth sessions from disk
 * - If OAUTH_ENCRYPTION_KEY is set: uses encrypted storage, migrates plaintext if exists
 * - Otherwise: uses plaintext storage
 */
function loadSessions(): Map<string, StoredOAuthSession> {
  if (sessionsCache) return sessionsCache;

  ensureStorageDir();
  sessionsCache = new Map();

  const encryptionKey = getEncryptionKey();

  if (encryptionKey) {
    // Encryption enabled - use encrypted storage
    if (existsSync(SESSIONS_FILE_ENCRYPTED)) {
      try {
        const encryptedData = readFileSync(SESSIONS_FILE_ENCRYPTED, "utf-8");
        const decrypted = decrypt(encryptedData, encryptionKey);
        const data = JSON.parse(decrypted);
        for (const [id, session] of Object.entries(data)) {
          sessionsCache.set(id, session as StoredOAuthSession);
        }
        console.log(`Loaded ${sessionsCache.size} OAuth sessions (encrypted)`);
      } catch (error) {
        console.error("Failed to load encrypted OAuth sessions (starting fresh):", error);
        sessionsCache = new Map();
      }
    } else {
      // Try migrating from plaintext
      const migrated = migrateToEncrypted(encryptionKey);
      if (migrated) {
        sessionsCache = migrated;
      }
    }
  } else {
    // No encryption - use plaintext storage
    if (existsSync(SESSIONS_FILE_PLAINTEXT)) {
      try {
        const data = JSON.parse(readFileSync(SESSIONS_FILE_PLAINTEXT, "utf-8"));
        for (const [id, session] of Object.entries(data)) {
          sessionsCache.set(id, session as StoredOAuthSession);
        }
        console.log(`Loaded ${sessionsCache.size} OAuth sessions`);
      } catch (error) {
        console.error("Failed to load OAuth sessions:", error);
      }
    }
  }

  return sessionsCache;
}

/**
 * Save OAuth sessions to disk
 * - If OAUTH_ENCRYPTION_KEY is set: saves encrypted
 * - Otherwise: saves plaintext
 */
function saveSessions(): void {
  if (!sessionsCache) return;

  ensureStorageDir();
  const data: Record<string, StoredOAuthSession> = {};
  for (const [id, session] of sessionsCache) {
    data[id] = session;
  }

  const encryptionKey = getEncryptionKey();

  try {
    if (encryptionKey) {
      // Save encrypted
      const plaintext = JSON.stringify(data);
      const encrypted = encrypt(plaintext, encryptionKey);
      writeFileSync(SESSIONS_FILE_ENCRYPTED, encrypted, { mode: 0o600 });
    } else {
      // Save plaintext
      writeFileSync(SESSIONS_FILE_PLAINTEXT, JSON.stringify(data, null, 2));
    }
  } catch (error) {
    console.error("Failed to save OAuth sessions:", error);
  }
}

/**
 * Store an OAuth session
 */
export function storeSession(sessionId: string, session: StoredOAuthSession): void {
  const cache = loadSessions();
  cache.set(sessionId, session);
  saveSessions();
}

/**
 * Get an OAuth session by ID
 */
export function getSession(sessionId: string): StoredOAuthSession | undefined {
  const cache = loadSessions();
  return cache.get(sessionId);
}

/**
 * Update an existing OAuth session (e.g., after token refresh)
 */
export function updateSession(sessionId: string, session: StoredOAuthSession): void {
  const cache = loadSessions();
  if (cache.has(sessionId)) {
    cache.set(sessionId, session);
    saveSessions();
  }
}

/**
 * Remove an OAuth session
 */
export function removeSession(sessionId: string): void {
  const cache = loadSessions();
  if (cache.delete(sessionId)) {
    saveSessions();
  }
}

/**
 * Cleanup expired OAuth sessions
 * Sessions are considered expired if their expiresAt time has passed
 * and they have no refresh token
 */
export function cleanupExpiredSessions(): void {
  const cache = loadSessions();
  const now = Date.now();
  let cleaned = 0;

  for (const [sessionId, session] of cache) {
    // Only remove if expired AND no refresh token
    // Sessions with refresh tokens can be renewed
    if (now >= session.expiresAt && !session.refreshToken) {
      cache.delete(sessionId);
      cleaned++;
    }
  }

  if (cleaned > 0) {
    saveSessions();
    console.log(`Cleaned up ${cleaned} expired OAuth sessions`);
  }
}

// Run cleanup every minute
setInterval(() => {
  cleanupExpiredPendingAuth();
  cleanupExpiredSessions();
}, 60000);
