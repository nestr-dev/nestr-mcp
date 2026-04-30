/**
 * OAuthStore Interface
 *
 * Abstraction layer for OAuth state storage. Two implementations:
 * - FileStore (default): JSON files on disk, for local dev and stdio mode
 * - RedisStore: Redis-backed, for multi-pod production deployment (REDIS_URL)
 */

// ============ Types ============

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
  /**
   * Most recent refresh attempt — for `nestr_diagnose`. We persist this so the
   * answer survives pod restarts and is consistent across the pool. Cleared
   * (or replaced) whenever a new refresh runs.
   */
  lastRefreshAttempt?: { at: number; success: boolean; error?: string };
}

/**
 * PKCE challenge data indexed by authorization code
 */
export interface PkceForCodeData {
  codeChallenge: string;
  codeChallengeMethod: string;
  createdAt: number;
}

/**
 * Persisted MCP session metadata.
 *
 * Lets a session survive a pod restart: when a request arrives with a sessionId
 * we no longer hold in memory, we look it up here and rebuild the in-memory
 * transport + server so the client never sees a "session terminated" error.
 *
 * The transport itself is in-memory only — what we persist is the bag of facts
 * needed to recreate it (auth, identity, negotiated protocol).
 */
export interface StoredMcpSession {
  authToken: string;
  mcpClient?: string;
  userId?: string;
  userName?: string;
  isApiKey: boolean;
  wantsJsonOnly: boolean;
  hasStoredOAuthSession: boolean;
  createdAt: number;
}

// ============ Store Interface ============

export interface OAuthStore {
  // Client Registration
  registerClient(client: RegisteredClient): Promise<void>;
  getClient(clientId: string): Promise<RegisteredClient | undefined>;
  getClientCount(): Promise<number>;
  clientExists(clientId: string): Promise<boolean>;

  // Pending Auth (consume-once, 5-min TTL)
  storePendingAuth(pending: PendingAuthWithPKCE): Promise<void>;
  consumePendingAuth(state: string): Promise<PendingAuthWithPKCE | undefined>;

  // PKCE Codes (consume-once, 5-min TTL)
  storePkceForCode(code: string, codeChallenge: string, codeChallengeMethod: string): Promise<void>;
  consumePkceForCode(code: string): Promise<PkceForCodeData | undefined>;

  // OAuth Sessions
  storeSession(sessionId: string, session: StoredOAuthSession): Promise<void>;
  getSession(sessionId: string): Promise<StoredOAuthSession | undefined>;
  updateSession(sessionId: string, session: StoredOAuthSession): Promise<void>;
  removeSession(sessionId: string): Promise<void>;

  // MCP Sessions (persisted so sessions survive pod restarts / can be rehydrated)
  storeMcpSession(sessionId: string, session: StoredMcpSession): Promise<void>;
  getMcpSession(sessionId: string): Promise<StoredMcpSession | undefined>;
  touchMcpSession(sessionId: string): Promise<void>;
  removeMcpSession(sessionId: string): Promise<void>;

  // Lifecycle
  close(): Promise<void>;
}

// ============ Store Singleton ============

let _store: OAuthStore | null = null;

/**
 * Initialize the global store. Must be called once at startup (before handling requests).
 */
export async function initStore(): Promise<OAuthStore> {
  if (_store) return _store;

  if (process.env.REDIS_URL) {
    const { createRedisStore } = await import("./redis-store.js");
    _store = await createRedisStore(process.env.REDIS_URL);
    console.log("OAuth store: Redis");
  } else {
    const { createFileStore } = await import("./file-store.js");
    _store = createFileStore();
    console.log("OAuth store: file-based");
  }

  return _store;
}

/**
 * Get the initialized store. Throws if initStore() hasn't been called.
 */
export function getStore(): OAuthStore {
  if (!_store) {
    throw new Error("OAuth store not initialized. Call initStore() during startup.");
  }
  return _store;
}
