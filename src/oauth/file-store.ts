/**
 * File-based OAuthStore Implementation
 *
 * Stores OAuth state as JSON files on disk with in-memory caching.
 * Used for local development and stdio mode (npx @nestr/mcp).
 *
 * For multi-pod production deployments, use RedisStore (REDIS_URL).
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import type {
  OAuthStore,
  RegisteredClient,
  PendingAuthWithPKCE,
  StoredOAuthSession,
  StoredMcpSession,
  PkceForCodeData,
} from "./store.js";

// Storage directory - use /data in production (mounted volume), fallback to local .data
const STORAGE_DIR = process.env.OAUTH_STORAGE_DIR ||
  (process.env.NODE_ENV === "production" ? "/data" : ".data");

const CLIENTS_FILE = join(STORAGE_DIR, "oauth-clients.json");
const PENDING_AUTH_FILE = join(STORAGE_DIR, "pending-auth.json");
const PKCE_FOR_CODE_FILE = join(STORAGE_DIR, "pkce-codes.json");
const SESSIONS_FILE_ENCRYPTED = join(STORAGE_DIR, "oauth-sessions.enc");
const SESSIONS_FILE_PLAINTEXT = join(STORAGE_DIR, "oauth-sessions.json");
const MCP_SESSIONS_FILE = join(STORAGE_DIR, "mcp-sessions.json");

// Encryption constants
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;

// TTL constants
const PENDING_AUTH_TTL_MS = 5 * 60 * 1000; // 5 minutes
const PKCE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MCP_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface McpSessionRecord extends StoredMcpSession {
  expiresAt: number;
}

// ============ Encryption helpers ============

function getEncryptionKey(): Buffer | null {
  if (!process.env.OAUTH_ENCRYPTION_KEY) return null;

  const key = Buffer.from(process.env.OAUTH_ENCRYPTION_KEY, "base64");
  if (key.length !== 32) {
    throw new Error("OAUTH_ENCRYPTION_KEY must be 32 bytes (256 bits) base64-encoded");
  }
  return key;
}

function encrypt(data: string, key: Buffer): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(data, "utf8", "base64");
  encrypted += cipher.final("base64");
  const authTag = cipher.getAuthTag();
  return `${iv.toString("base64")}:${authTag.toString("base64")}:${encrypted}`;
}

function decrypt(encryptedData: string, key: Buffer): string {
  const parts = encryptedData.split(":");
  if (parts.length !== 3) throw new Error("Invalid encrypted data format");

  const iv = Buffer.from(parts[0], "base64");
  const authTag = Buffer.from(parts[1], "base64");
  const data = parts[2];

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(data, "base64", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

// ============ File I/O helpers ============

function ensureStorageDir(): void {
  if (!existsSync(STORAGE_DIR)) {
    mkdirSync(STORAGE_DIR, { recursive: true });
  }
}

function loadJsonFile<T>(filePath: string): Record<string, T> {
  if (!existsSync(filePath)) return {};
  try {
    return JSON.parse(readFileSync(filePath, "utf-8"));
  } catch (error) {
    console.error(`Failed to load ${filePath}:`, error);
    return {};
  }
}

function saveJsonFile(filePath: string, data: unknown): void {
  ensureStorageDir();
  try {
    writeFileSync(filePath, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error(`Failed to save ${filePath}:`, error);
  }
}

// ============ FileStore implementation ============

class FileStore implements OAuthStore {
  private clientsCache: Map<string, RegisteredClient> | null = null;
  private pendingAuthCache: Map<string, PendingAuthWithPKCE> | null = null;
  private pkceForCodeCache: Map<string, PkceForCodeData> | null = null;
  private sessionsCache: Map<string, StoredOAuthSession> | null = null;
  private mcpSessionsCache: Map<string, McpSessionRecord> | null = null;
  private cleanupInterval: ReturnType<typeof setInterval>;

  constructor() {
    ensureStorageDir();
    // Run cleanup every minute
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredPendingAuth();
      this.cleanupExpiredSessions();
      this.cleanupExpiredMcpSessions();
    }, 60000);
  }

  // ---- Clients ----

  private loadClients(): Map<string, RegisteredClient> {
    if (this.clientsCache) return this.clientsCache;

    this.clientsCache = new Map();
    const data = loadJsonFile<RegisteredClient>(CLIENTS_FILE);
    for (const [id, client] of Object.entries(data)) {
      this.clientsCache.set(id, client);
    }
    if (this.clientsCache.size > 0) {
      console.log(`Loaded ${this.clientsCache.size} registered OAuth clients`);
    }
    return this.clientsCache;
  }

  private saveClients(): void {
    if (!this.clientsCache) return;
    const data: Record<string, RegisteredClient> = {};
    for (const [id, client] of this.clientsCache) data[id] = client;
    saveJsonFile(CLIENTS_FILE, data);
  }

  async registerClient(client: RegisteredClient): Promise<void> {
    const clients = this.loadClients();
    clients.set(client.client_id, client);
    this.saveClients();
    console.log(`Registered OAuth client: ${client.client_id}`);
  }

  async getClient(clientId: string): Promise<RegisteredClient | undefined> {
    return this.loadClients().get(clientId);
  }

  async getClientCount(): Promise<number> {
    return this.loadClients().size;
  }

  async clientExists(clientId: string): Promise<boolean> {
    return this.loadClients().has(clientId);
  }

  // ---- Pending Auth ----

  private loadPendingAuth(): Map<string, PendingAuthWithPKCE> {
    if (this.pendingAuthCache) return this.pendingAuthCache;

    this.pendingAuthCache = new Map();
    const data = loadJsonFile<PendingAuthWithPKCE>(PENDING_AUTH_FILE);
    const now = Date.now();
    for (const [state, pending] of Object.entries(data)) {
      if (now - pending.createdAt < PENDING_AUTH_TTL_MS) {
        this.pendingAuthCache.set(state, pending);
      }
    }
    return this.pendingAuthCache;
  }

  private savePendingAuth(): void {
    if (!this.pendingAuthCache) return;
    const data: Record<string, PendingAuthWithPKCE> = {};
    for (const [state, pending] of this.pendingAuthCache) data[state] = pending;
    saveJsonFile(PENDING_AUTH_FILE, data);
  }

  async storePendingAuth(pending: PendingAuthWithPKCE): Promise<void> {
    const cache = this.loadPendingAuth();
    cache.set(pending.state, pending);
    this.savePendingAuth();
  }

  async consumePendingAuth(state: string): Promise<PendingAuthWithPKCE | undefined> {
    const cache = this.loadPendingAuth();
    const pending = cache.get(state);
    if (!pending) return undefined;

    if (Date.now() - pending.createdAt > PENDING_AUTH_TTL_MS) {
      cache.delete(state);
      this.savePendingAuth();
      return undefined;
    }

    cache.delete(state);
    this.savePendingAuth();
    return pending;
  }

  private cleanupExpiredPendingAuth(): void {
    const cache = this.loadPendingAuth();
    const now = Date.now();
    let cleaned = 0;
    for (const [state, pending] of cache) {
      if (now - pending.createdAt > PENDING_AUTH_TTL_MS) {
        cache.delete(state);
        cleaned++;
      }
    }
    if (cleaned > 0) this.savePendingAuth();
  }

  // ---- PKCE Codes ----

  private loadPkceForCode(): Map<string, PkceForCodeData> {
    if (this.pkceForCodeCache) return this.pkceForCodeCache;

    this.pkceForCodeCache = new Map();
    const data = loadJsonFile<PkceForCodeData>(PKCE_FOR_CODE_FILE);
    const now = Date.now();
    for (const [code, pkce] of Object.entries(data)) {
      if (now - pkce.createdAt < PKCE_TTL_MS) {
        this.pkceForCodeCache.set(code, pkce);
      }
    }
    return this.pkceForCodeCache;
  }

  private savePkceForCode(): void {
    if (!this.pkceForCodeCache) return;
    const data: Record<string, PkceForCodeData> = {};
    for (const [code, pkce] of this.pkceForCodeCache) data[code] = pkce;
    saveJsonFile(PKCE_FOR_CODE_FILE, data);
  }

  async storePkceForCode(code: string, codeChallenge: string, codeChallengeMethod: string): Promise<void> {
    const cache = this.loadPkceForCode();
    cache.set(code, { codeChallenge, codeChallengeMethod, createdAt: Date.now() });
    this.savePkceForCode();
  }

  async consumePkceForCode(code: string): Promise<PkceForCodeData | undefined> {
    const cache = this.loadPkceForCode();
    const pkce = cache.get(code);
    if (!pkce) return undefined;

    if (Date.now() - pkce.createdAt > PKCE_TTL_MS) {
      cache.delete(code);
      this.savePkceForCode();
      return undefined;
    }

    cache.delete(code);
    this.savePkceForCode();
    return pkce;
  }

  // ---- Sessions ----

  private migrateToEncrypted(key: Buffer): Map<string, StoredOAuthSession> | null {
    if (!existsSync(SESSIONS_FILE_PLAINTEXT)) return null;

    try {
      const data = JSON.parse(readFileSync(SESSIONS_FILE_PLAINTEXT, "utf-8"));
      const sessions = new Map<string, StoredOAuthSession>();
      for (const [id, session] of Object.entries(data)) {
        sessions.set(id, session as StoredOAuthSession);
      }

      console.log(`Migrating ${sessions.size} OAuth sessions from plaintext to encrypted storage`);
      const plaintext = JSON.stringify(data);
      const encrypted = encrypt(plaintext, key);
      writeFileSync(SESSIONS_FILE_ENCRYPTED, encrypted, { mode: 0o600 });
      unlinkSync(SESSIONS_FILE_PLAINTEXT);
      console.log("Migration complete - plaintext sessions file removed");

      return sessions;
    } catch (error) {
      console.error("Failed to migrate sessions to encrypted:", error);
      return null;
    }
  }

  private loadSessions(): Map<string, StoredOAuthSession> {
    if (this.sessionsCache) return this.sessionsCache;

    ensureStorageDir();
    this.sessionsCache = new Map();
    const encryptionKey = getEncryptionKey();

    if (encryptionKey) {
      if (existsSync(SESSIONS_FILE_ENCRYPTED)) {
        try {
          const encryptedData = readFileSync(SESSIONS_FILE_ENCRYPTED, "utf-8");
          const decrypted = decrypt(encryptedData, encryptionKey);
          const data = JSON.parse(decrypted);
          for (const [id, session] of Object.entries(data)) {
            this.sessionsCache.set(id, session as StoredOAuthSession);
          }
          console.log(`Loaded ${this.sessionsCache.size} OAuth sessions (encrypted)`);
        } catch (error) {
          console.error("Failed to load encrypted OAuth sessions (starting fresh):", error);
          this.sessionsCache = new Map();
        }
      } else {
        const migrated = this.migrateToEncrypted(encryptionKey);
        if (migrated) this.sessionsCache = migrated;
      }
    } else {
      if (existsSync(SESSIONS_FILE_PLAINTEXT)) {
        try {
          const data = JSON.parse(readFileSync(SESSIONS_FILE_PLAINTEXT, "utf-8"));
          for (const [id, session] of Object.entries(data)) {
            this.sessionsCache.set(id, session as StoredOAuthSession);
          }
          console.log(`Loaded ${this.sessionsCache.size} OAuth sessions`);
        } catch (error) {
          console.error("Failed to load OAuth sessions:", error);
        }
      }
    }

    return this.sessionsCache;
  }

  private saveSessions(): void {
    if (!this.sessionsCache) return;

    ensureStorageDir();
    const data: Record<string, StoredOAuthSession> = {};
    for (const [id, session] of this.sessionsCache) data[id] = session;

    const encryptionKey = getEncryptionKey();
    try {
      if (encryptionKey) {
        const plaintext = JSON.stringify(data);
        const encrypted = encrypt(plaintext, encryptionKey);
        writeFileSync(SESSIONS_FILE_ENCRYPTED, encrypted, { mode: 0o600 });
      } else {
        writeFileSync(SESSIONS_FILE_PLAINTEXT, JSON.stringify(data, null, 2));
      }
    } catch (error) {
      console.error("Failed to save OAuth sessions:", error);
    }
  }

  async storeSession(sessionId: string, session: StoredOAuthSession): Promise<void> {
    const cache = this.loadSessions();
    cache.set(sessionId, session);
    this.saveSessions();
  }

  async getSession(sessionId: string): Promise<StoredOAuthSession | undefined> {
    return this.loadSessions().get(sessionId);
  }

  async updateSession(sessionId: string, session: StoredOAuthSession): Promise<void> {
    const cache = this.loadSessions();
    if (cache.has(sessionId)) {
      cache.set(sessionId, session);
      this.saveSessions();
    }
  }

  async removeSession(sessionId: string): Promise<void> {
    const cache = this.loadSessions();
    if (cache.delete(sessionId)) {
      this.saveSessions();
    }
  }

  private cleanupExpiredSessions(): void {
    const cache = this.loadSessions();
    const now = Date.now();
    let cleaned = 0;
    for (const [sessionId, session] of cache) {
      if (now >= session.expiresAt && !session.refreshToken) {
        cache.delete(sessionId);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      this.saveSessions();
      console.log(`Cleaned up ${cleaned} expired OAuth sessions`);
    }
  }

  // ---- MCP Sessions ----

  private loadMcpSessions(): Map<string, McpSessionRecord> {
    if (this.mcpSessionsCache) return this.mcpSessionsCache;

    this.mcpSessionsCache = new Map();
    const data = loadJsonFile<McpSessionRecord>(MCP_SESSIONS_FILE);
    const now = Date.now();
    for (const [sid, record] of Object.entries(data)) {
      if (record.expiresAt > now) {
        this.mcpSessionsCache.set(sid, record);
      }
    }
    return this.mcpSessionsCache;
  }

  private saveMcpSessions(): void {
    if (!this.mcpSessionsCache) return;
    const data: Record<string, McpSessionRecord> = {};
    for (const [sid, record] of this.mcpSessionsCache) data[sid] = record;
    saveJsonFile(MCP_SESSIONS_FILE, data);
  }

  async storeMcpSession(sessionId: string, session: StoredMcpSession): Promise<void> {
    const cache = this.loadMcpSessions();
    cache.set(sessionId, { ...session, expiresAt: Date.now() + MCP_SESSION_TTL_MS });
    this.saveMcpSessions();
  }

  async getMcpSession(sessionId: string): Promise<StoredMcpSession | undefined> {
    const cache = this.loadMcpSessions();
    const record = cache.get(sessionId);
    if (!record) return undefined;
    if (record.expiresAt <= Date.now()) {
      cache.delete(sessionId);
      this.saveMcpSessions();
      return undefined;
    }
    const { expiresAt: _expiresAt, ...session } = record;
    return session;
  }

  async touchMcpSession(sessionId: string): Promise<void> {
    const cache = this.loadMcpSessions();
    const record = cache.get(sessionId);
    if (!record) return;
    record.expiresAt = Date.now() + MCP_SESSION_TTL_MS;
    this.saveMcpSessions();
  }

  async removeMcpSession(sessionId: string): Promise<void> {
    const cache = this.loadMcpSessions();
    if (cache.delete(sessionId)) {
      this.saveMcpSessions();
    }
  }

  private cleanupExpiredMcpSessions(): void {
    const cache = this.loadMcpSessions();
    const now = Date.now();
    let cleaned = 0;
    for (const [sid, record] of cache) {
      if (record.expiresAt <= now) {
        cache.delete(sid);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      this.saveMcpSessions();
    }
  }

  // ---- Lifecycle ----

  async close(): Promise<void> {
    clearInterval(this.cleanupInterval);
  }
}

/**
 * Create a file-based OAuthStore instance.
 */
export function createFileStore(): OAuthStore {
  return new FileStore();
}
