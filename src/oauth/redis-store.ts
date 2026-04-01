/**
 * Redis-backed OAuthStore Implementation
 *
 * Uses Redis for shared state across multiple pods.
 * Activated when REDIS_URL environment variable is set.
 *
 * Features:
 * - Native TTL for automatic expiry (no cleanup timers needed)
 * - Atomic GETDEL for consume-once operations (pending auth, PKCE)
 * - Optional AES-256-GCM encryption for session values (OAUTH_ENCRYPTION_KEY)
 */

import { Redis } from "ioredis";
import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import type {
  OAuthStore,
  RegisteredClient,
  PendingAuthWithPKCE,
  StoredOAuthSession,
  PkceForCodeData,
} from "./store.js";

// Key prefixes
const PREFIX = {
  client: "oauth:client:",
  clientCount: "oauth:client:count",
  pending: "oauth:pending:",
  pkce: "oauth:pkce:",
  session: "oauth:session:",
} as const;

// TTLs in seconds
const PENDING_AUTH_TTL = 300; // 5 minutes
const PKCE_TTL = 300; // 5 minutes
const CLIENT_TTL = 86400; // 24 hours (clients re-register on reconnect)
const SESSION_REFRESH_TTL = 30 * 86400; // 30 days for sessions with refresh tokens

// Encryption constants
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;

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

class RedisStore implements OAuthStore {
  private redis: Redis;
  private encryptionKey: Buffer | null;

  constructor(redis: Redis) {
    this.redis = redis;
    this.encryptionKey = getEncryptionKey();
  }

  // ---- Helpers ----

  private serialize(data: unknown): string {
    const json = JSON.stringify(data);
    if (this.encryptionKey) return encrypt(json, this.encryptionKey);
    return json;
  }

  private deserialize<T>(raw: string): T {
    if (this.encryptionKey) {
      const json = decrypt(raw, this.encryptionKey);
      return JSON.parse(json);
    }
    return JSON.parse(raw);
  }

  // ---- Clients ----

  async registerClient(client: RegisteredClient): Promise<void> {
    const key = PREFIX.client + client.client_id;
    const pipeline = this.redis.pipeline();
    pipeline.set(key, this.serialize(client), "EX", CLIENT_TTL);
    pipeline.incr(PREFIX.clientCount);
    await pipeline.exec();
    console.log(`Registered OAuth client: ${client.client_id}`);
  }

  async getClient(clientId: string): Promise<RegisteredClient | undefined> {
    const raw = await this.redis.get(PREFIX.client + clientId);
    if (!raw) return undefined;
    return this.deserialize<RegisteredClient>(raw);
  }

  async getClientCount(): Promise<number> {
    const count = await this.redis.get(PREFIX.clientCount);
    return count ? parseInt(count, 10) : 0;
  }

  async clientExists(clientId: string): Promise<boolean> {
    return (await this.redis.exists(PREFIX.client + clientId)) === 1;
  }

  // ---- Pending Auth ----

  async storePendingAuth(pending: PendingAuthWithPKCE): Promise<void> {
    await this.redis.set(
      PREFIX.pending + pending.state,
      this.serialize(pending),
      "EX",
      PENDING_AUTH_TTL
    );
  }

  async consumePendingAuth(state: string): Promise<PendingAuthWithPKCE | undefined> {
    const raw = await this.redis.getdel(PREFIX.pending + state);
    if (!raw) return undefined;
    return this.deserialize<PendingAuthWithPKCE>(raw);
  }

  // ---- PKCE Codes ----

  async storePkceForCode(code: string, codeChallenge: string, codeChallengeMethod: string): Promise<void> {
    const data: PkceForCodeData = { codeChallenge, codeChallengeMethod, createdAt: Date.now() };
    await this.redis.set(PREFIX.pkce + code, this.serialize(data), "EX", PKCE_TTL);
  }

  async consumePkceForCode(code: string): Promise<PkceForCodeData | undefined> {
    const raw = await this.redis.getdel(PREFIX.pkce + code);
    if (!raw) return undefined;
    return this.deserialize<PkceForCodeData>(raw);
  }

  // ---- Sessions ----

  private sessionTtl(session: StoredOAuthSession): number {
    if (session.refreshToken) return SESSION_REFRESH_TTL;
    // TTL = time until expiry (minimum 60s to avoid immediate deletion)
    const ttl = Math.max(60, Math.ceil((session.expiresAt - Date.now()) / 1000));
    return ttl;
  }

  async storeSession(sessionId: string, session: StoredOAuthSession): Promise<void> {
    await this.redis.set(
      PREFIX.session + sessionId,
      this.serialize(session),
      "EX",
      this.sessionTtl(session)
    );
  }

  async getSession(sessionId: string): Promise<StoredOAuthSession | undefined> {
    const raw = await this.redis.get(PREFIX.session + sessionId);
    if (!raw) return undefined;
    return this.deserialize<StoredOAuthSession>(raw);
  }

  async updateSession(sessionId: string, session: StoredOAuthSession): Promise<void> {
    const exists = await this.redis.exists(PREFIX.session + sessionId);
    if (exists) {
      await this.redis.set(
        PREFIX.session + sessionId,
        this.serialize(session),
        "EX",
        this.sessionTtl(session)
      );
    }
  }

  async removeSession(sessionId: string): Promise<void> {
    await this.redis.del(PREFIX.session + sessionId);
  }

  // ---- Lifecycle ----

  async close(): Promise<void> {
    await this.redis.quit();
  }
}

/**
 * Create a Redis-backed OAuthStore instance.
 */
export async function createRedisStore(redisUrl: string): Promise<OAuthStore> {
  const redis = new Redis(redisUrl, {
    maxRetriesPerRequest: 3,
    retryStrategy(times: number) {
      // Exponential backoff: 50ms, 100ms, 200ms, ... capped at 2s
      return Math.min(times * 50, 2000);
    },
  });

  // Verify connection
  await redis.ping();
  console.log("Redis connected for OAuth storage");

  return new RedisStore(redis);
}
