/**
 * In-memory OAuthStore implementation for tests.
 * Implements the full OAuthStore interface without any I/O.
 */
import type {
  OAuthStore,
  RegisteredClient,
  PendingAuthWithPKCE,
  PkceForCodeData,
  StoredOAuthSession,
} from "../../src/oauth/store.js";

export function createMockStore(): OAuthStore {
  const clients = new Map<string, RegisteredClient>();
  const pendingAuths = new Map<string, PendingAuthWithPKCE>();
  const pkceCodes = new Map<string, PkceForCodeData>();
  const sessions = new Map<string, StoredOAuthSession>();

  return {
    async registerClient(client) {
      clients.set(client.client_id, client);
    },
    async getClient(clientId) {
      return clients.get(clientId);
    },
    async getClientCount() {
      return clients.size;
    },
    async clientExists(clientId) {
      return clients.has(clientId);
    },

    async storePendingAuth(pending) {
      pendingAuths.set(pending.state, pending);
    },
    async consumePendingAuth(state) {
      const pending = pendingAuths.get(state);
      if (pending) pendingAuths.delete(state);
      return pending;
    },

    async storePkceForCode(code, codeChallenge, codeChallengeMethod) {
      pkceCodes.set(code, { codeChallenge, codeChallengeMethod, createdAt: Date.now() });
    },
    async consumePkceForCode(code) {
      const data = pkceCodes.get(code);
      if (data) pkceCodes.delete(code);
      return data;
    },

    async storeSession(sessionId, session) {
      sessions.set(sessionId, session);
    },
    async getSession(sessionId) {
      return sessions.get(sessionId);
    },
    async updateSession(sessionId, session) {
      sessions.set(sessionId, session);
    },
    async removeSession(sessionId) {
      sessions.delete(sessionId);
    },

    async close() {},
  };
}
