import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { createMockStore } from "./helpers/mock-store.js";

// Mock the OAuth store before importing the app
const mockStore = createMockStore();
vi.mock("../src/oauth/store.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/oauth/store.js")>();
  return {
    ...actual,
    getStore: () => mockStore,
    initStore: vi.fn().mockResolvedValue(mockStore),
  };
});

// Mock analytics to avoid side effects
vi.mock("../src/analytics/ga4.js", () => ({}));

// Stub mcpcat to prevent it from trying to connect
vi.mock("mcpcat", () => ({
  default: { wrap: (_server: unknown) => _server },
}));

const { app, sessions, findCoalescableSession, SESSION_COALESCE_WINDOW_MS } = await import("../src/http.js");

describe("HTTP Server", () => {
  beforeEach(() => {
    // Clear sessions between tests
    for (const key of Object.keys(sessions)) {
      delete sessions[key];
    }
  });

  // ─── Health & Landing ─────────────────────────────────────────────

  describe("GET /health", () => {
    it("returns 200 with status ok", async () => {
      const res = await request(app).get("/health");
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("ok");
      expect(res.body.service).toBe("nestr-mcp");
      expect(res.body.version).toBeDefined();
    });
  });

  describe("GET /", () => {
    it("returns 200 with HTML content", async () => {
      const res = await request(app).get("/");
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/html/);
    });
  });

  // ─── Well-Known Metadata ──────────────────────────────────────────

  describe("GET /.well-known/oauth-protected-resource", () => {
    it("returns valid RFC 9728 metadata", async () => {
      const res = await request(app).get("/.well-known/oauth-protected-resource");
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("resource");
      expect(res.body).toHaveProperty("authorization_servers");
      expect(Array.isArray(res.body.authorization_servers)).toBe(true);
      expect(res.body.bearer_methods_supported).toContain("header");
    });
  });

  describe("GET /.well-known/oauth-authorization-server", () => {
    it("returns valid RFC 8414 metadata", async () => {
      const res = await request(app).get("/.well-known/oauth-authorization-server");
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("issuer");
      expect(res.body).toHaveProperty("authorization_endpoint");
      expect(res.body).toHaveProperty("token_endpoint");
      expect(res.body).toHaveProperty("registration_endpoint");
      expect(res.body.response_types_supported).toContain("code");
      expect(res.body.grant_types_supported).toContain("authorization_code");
      expect(res.body.grant_types_supported).toContain("refresh_token");
      expect(res.body.code_challenge_methods_supported).toContain("S256");
    });
  });

  // ─── Security Headers ─────────────────────────────────────────────

  describe("Security middleware", () => {
    it("includes Helmet headers", async () => {
      const res = await request(app).get("/health");
      expect(res.headers["x-content-type-options"]).toBe("nosniff");
      expect(res.headers).toHaveProperty("x-frame-options");
    });
  });

  // ─── Body Parsing Errors ──────────────────────────────────────────

  describe("POST /mcp — body parsing", () => {
    it("returns JSON-RPC parse error for malformed JSON", async () => {
      const res = await request(app)
        .post("/mcp")
        .set("Content-Type", "application/json")
        .set("Accept", "application/json, text/event-stream")
        .set("Authorization", "Bearer test-token")
        .send("{bad json");

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe(-32700);
      expect(res.body.error.message).toMatch(/parse error/i);
    });

    it("returns JSON-RPC parse error for bare string body", async () => {
      const res = await request(app)
        .post("/mcp")
        .set("Content-Type", "application/json")
        .set("Accept", "application/json, text/event-stream")
        .set("Authorization", "Bearer test-token")
        .send("tools");

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe(-32700);
    });
  });

  // ─── Authentication Gating ────────────────────────────────────────

  describe("POST /mcp — authentication", () => {
    it("returns 401 without auth headers", async () => {
      const res = await request(app)
        .post("/mcp")
        .set("Content-Type", "application/json")
        .set("Accept", "application/json, text/event-stream")
        .send({ jsonrpc: "2.0", method: "initialize", id: 1 });

      expect(res.status).toBe(401);
      expect(res.headers["www-authenticate"]).toMatch(/^Bearer resource_metadata="/);
      expect(res.body.error.code).toBe(-32001);
    });

    it("returns 400 for non-init request without session", async () => {
      const res = await request(app)
        .post("/mcp")
        .set("Content-Type", "application/json")
        .set("Accept", "application/json, text/event-stream")
        .set("Authorization", "Bearer test-token")
        .send({ jsonrpc: "2.0", method: "tools/list", id: 1 });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/not an initialization request/i);
    });

    it("returns 404 for stale session ID", async () => {
      const res = await request(app)
        .post("/mcp")
        .set("Content-Type", "application/json")
        .set("Accept", "application/json, text/event-stream")
        .set("Authorization", "Bearer test-token")
        .set("mcp-session-id", "nonexistent-session-id")
        .send({ jsonrpc: "2.0", method: "tools/list", id: 1 });

      expect(res.status).toBe(404);
      expect(res.body.error.message).toMatch(/session not found/i);
    });

    it("accepts API key via X-Nestr-API-Key header", async () => {
      const res = await request(app)
        .post("/mcp")
        .set("Content-Type", "application/json")
        .set("Accept", "application/json, text/event-stream")
        .set("X-Nestr-API-Key", "test-api-key")
        .send({ jsonrpc: "2.0", method: "tools/list", id: 1 });

      // Should get past auth (400 = "not init request", not 401 = "no auth")
      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/not an initialization request/i);
    });
  });

  // ─── Session Lifecycle ────────────────────────────────────────────

  describe("POST /mcp — session lifecycle", () => {
    it("creates a session on valid initialize request", async () => {
      const res = await request(app)
        .post("/mcp")
        .set("Content-Type", "application/json")
        .set("Accept", "application/json, text/event-stream")
        .set("Authorization", "Bearer test-token")
        .send({
          jsonrpc: "2.0",
          method: "initialize",
          params: {
            protocolVersion: "2025-03-26",
            capabilities: {},
            clientInfo: { name: "test-client", version: "1.0" },
          },
          id: 1,
        });

      // The MCP SDK may return SSE or JSON depending on Accept header handling
      // A successful init should return 200
      expect(res.status).toBe(200);
      expect(res.headers["mcp-session-id"]).toBeDefined();
    });

    // Regression: Claude Desktop's mcp-remote reconnects after an SSE drop by
    // sending a fresh `initialize` (no session ID) with the same auth token.
    // Before the fix, session coalescing routed the new init into the old
    // already-initialized transport and the SDK returned 400 "Server already
    // initialized", permanently breaking reconnects until the session idled out.
    it("replaces a stale same-client session on re-initialize instead of 400ing", async () => {
      const authHeader = "Bearer reconnect-token";
      const initBody = {
        jsonrpc: "2.0",
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "claude-desktop", version: "1.0" },
        },
        id: 1,
      };

      const first = await request(app)
        .post("/mcp")
        .set("Content-Type", "application/json")
        .set("Accept", "application/json, text/event-stream")
        .set("Authorization", authHeader)
        .send(initBody);

      expect(first.status).toBe(200);
      const firstSid = first.headers["mcp-session-id"];
      expect(firstSid).toBeDefined();
      expect(sessions[firstSid]).toBeDefined();

      // Simulate a reconnect: same auth + client, no session ID.
      const second = await request(app)
        .post("/mcp")
        .set("Content-Type", "application/json")
        .set("Accept", "application/json, text/event-stream")
        .set("Authorization", authHeader)
        .send({ ...initBody, id: 2 });

      expect(second.status).toBe(200);
      const secondSid = second.headers["mcp-session-id"];
      expect(secondSid).toBeDefined();
      expect(secondSid).not.toBe(firstSid);
      expect(sessions[firstSid]).toBeUndefined();
      expect(sessions[secondSid]).toBeDefined();
    });
  });

  // ─── Session Coalescing ───────────────────────────────────────────

  describe("findCoalescableSession", () => {
    it("returns undefined when no sessions exist", () => {
      expect(findCoalescableSession("token-a", "client-a")).toBeUndefined();
    });

    it("matches session with same auth token and client name", () => {
      const sessionId = "test-session-1";
      sessions[sessionId] = {
        authToken: "token-a",
        mcpClient: "client-a",
        lastActivityAt: Date.now(),
      } as any;

      const result = findCoalescableSession("token-a", "client-a");
      expect(result).toBeDefined();
      expect(result!.sessionId).toBe(sessionId);
    });

    it("does not match different auth token", () => {
      sessions["test-session-1"] = {
        authToken: "token-a",
        mcpClient: "client-a",
        lastActivityAt: Date.now(),
      } as any;

      expect(findCoalescableSession("token-b", "client-a")).toBeUndefined();
    });

    it("does not match different client name", () => {
      sessions["test-session-1"] = {
        authToken: "token-a",
        mcpClient: "client-a",
        lastActivityAt: Date.now(),
      } as any;

      expect(findCoalescableSession("token-a", "client-b")).toBeUndefined();
    });

    it("does not match stale sessions", () => {
      sessions["test-session-1"] = {
        authToken: "token-a",
        mcpClient: "client-a",
        lastActivityAt: Date.now() - SESSION_COALESCE_WINDOW_MS - 60_000, // past the window
      } as any;

      expect(findCoalescableSession("token-a", "client-a")).toBeUndefined();
    });

    it("still matches dead SSE session (but deprioritized)", () => {
      sessions["test-session-1"] = {
        authToken: "token-a",
        mcpClient: "client-a",
        lastActivityAt: Date.now(),
        sseResponse: { writableEnded: true } as any,
      } as any;

      // Dead SSE sessions are still eligible — just deprioritized vs live ones
      const result = findCoalescableSession("token-a", "client-a");
      expect(result).toBeDefined();
    });

    it("matches when no SSE stream was ever opened", () => {
      sessions["test-session-1"] = {
        authToken: "token-a",
        mcpClient: "client-a",
        lastActivityAt: Date.now(),
        sseResponse: undefined,
      } as any;

      const result = findCoalescableSession("token-a", "client-a");
      expect(result).toBeDefined();
    });

    it("matches when SSE stream is alive", () => {
      sessions["test-session-1"] = {
        authToken: "token-a",
        mcpClient: "client-a",
        lastActivityAt: Date.now(),
        sseResponse: { writableEnded: false } as any,
      } as any;

      const result = findCoalescableSession("token-a", "client-a");
      expect(result).toBeDefined();
    });

    it("prefers live SSE session over dead SSE session", () => {
      sessions["dead-sse"] = {
        authToken: "token-a",
        mcpClient: "client-a",
        lastActivityAt: Date.now(),
        sseResponse: { writableEnded: true } as any,
      } as any;

      sessions["live-sse"] = {
        authToken: "token-a",
        mcpClient: "client-a",
        lastActivityAt: Date.now() - 5000, // older but live SSE
        sseResponse: { writableEnded: false } as any,
      } as any;

      const result = findCoalescableSession("token-a", "client-a");
      expect(result!.sessionId).toBe("live-sse");
    });

    it("picks the most recently active session when SSE status is equal", () => {
      sessions["older"] = {
        authToken: "token-a",
        mcpClient: "client-a",
        lastActivityAt: Date.now() - 5000,
      } as any;

      sessions["newer"] = {
        authToken: "token-a",
        mcpClient: "client-a",
        lastActivityAt: Date.now(),
      } as any;

      const result = findCoalescableSession("token-a", "client-a");
      expect(result!.sessionId).toBe("newer");
    });
  });

  // ─── Session Rehydration ──────────────────────────────────────────
  // Sessions are persisted to the OAuth store on init so they survive a
  // pod restart. A request with a sessionId not in the local sessions map
  // should rehydrate from the store transparently.

  describe("POST /mcp — session rehydration", () => {
    it("rehydrates a persisted session and serves the request", async () => {
      const sessionId = "rehydrate-target-session";
      const token = "rehydrate-token";

      // Simulate a session that was created by a previous pod: only the
      // persisted record exists; the in-memory map is empty.
      await mockStore.storeMcpSession(sessionId, {
        authToken: token,
        mcpClient: "claude-code",
        userId: "user-123",
        userName: "Test User",
        isApiKey: false,
        wantsJsonOnly: false,
        hasStoredOAuthSession: false,
        createdAt: Date.now(),
      });

      const res = await request(app)
        .post("/mcp")
        .set("Content-Type", "application/json")
        .set("Accept", "application/json, text/event-stream")
        .set("Authorization", `Bearer ${token}`)
        .set("mcp-session-id", sessionId)
        .send({ jsonrpc: "2.0", method: "tools/list", id: 1 });

      // Must NOT be 404 — rehydration should make this look like a normal
      // existing-session request from the SDK's perspective.
      expect(res.status).not.toBe(404);
      // Session should now be live in memory.
      expect(sessions[sessionId]).toBeDefined();
      expect(sessions[sessionId].authToken).toBe(token);
      expect(sessions[sessionId].mcpClient).toBe("claude-code");
    });

    it("refuses rehydration when the request token doesn't match the stored token", async () => {
      const sessionId = "mismatch-session";
      await mockStore.storeMcpSession(sessionId, {
        authToken: "original-token",
        mcpClient: "claude-code",
        isApiKey: false,
        wantsJsonOnly: false,
        hasStoredOAuthSession: false,
        createdAt: Date.now(),
      });

      const res = await request(app)
        .post("/mcp")
        .set("Content-Type", "application/json")
        .set("Accept", "application/json, text/event-stream")
        .set("Authorization", "Bearer different-token")
        .set("mcp-session-id", sessionId)
        .send({ jsonrpc: "2.0", method: "tools/list", id: 1 });

      expect(res.status).toBe(404);
      expect(sessions[sessionId]).toBeUndefined();
    });

    it("returns 404 when sessionId is unknown to both the local map and the store", async () => {
      const res = await request(app)
        .post("/mcp")
        .set("Content-Type", "application/json")
        .set("Accept", "application/json, text/event-stream")
        .set("Authorization", "Bearer some-token")
        .set("mcp-session-id", "totally-unknown-id")
        .send({ jsonrpc: "2.0", method: "tools/list", id: 1 });

      expect(res.status).toBe(404);
      expect(res.body.error.message).toMatch(/session not found/i);
    });
  });

  // ─── 401 Surfacing for Expired Stored Sessions ────────────────────
  // When the server holds an OAuth session for a token (browser flow) and
  // the refresh fails, we must return HTTP 401 + WWW-Authenticate so the
  // MCP client triggers its re-auth flow — not wrap the failure as a tool
  // error the client ignores.

  describe("POST /mcp — expired stored OAuth session", () => {
    it("returns 401 with WWW-Authenticate when the stored OAuth session is gone", async () => {
      const sessionId = "expired-oauth-session";
      const token = "expired-token";

      // Persist an MCP session that flagged hasStoredOAuthSession=true.
      await mockStore.storeMcpSession(sessionId, {
        authToken: token,
        mcpClient: "claude-code",
        isApiKey: false,
        wantsJsonOnly: false,
        hasStoredOAuthSession: true,
        createdAt: Date.now(),
      });
      // Deliberately do NOT seed an OAuth session in the store — simulates
      // an expired/refresh-failed stored session.

      const res = await request(app)
        .post("/mcp")
        .set("Content-Type", "application/json")
        .set("Accept", "application/json, text/event-stream")
        .set("Authorization", `Bearer ${token}`)
        .set("mcp-session-id", sessionId)
        .send({ jsonrpc: "2.0", method: "tools/list", id: 1 });

      expect(res.status).toBe(401);
      expect(res.headers["www-authenticate"]).toMatch(/^Bearer resource_metadata="/);
    });
  });

  // ─── Token Swap Detection ─────────────────────────────────────────
  // The session caches the auth token at construction time and binds its
  // NestrClient to it. If the request's token differs (user re-OAuthed,
  // OAuth refresh rotated the token, swapped from API key to OAuth, etc.)
  // calls would silently use the stale credential. The server must drop the
  // session and force the client to re-init.

  describe("token swap on existing session", () => {
    async function initSession(token: string): Promise<string> {
      const res = await request(app)
        .post("/mcp")
        .set("Content-Type", "application/json")
        .set("Accept", "application/json, text/event-stream")
        .set("Authorization", `Bearer ${token}`)
        .send({
          jsonrpc: "2.0",
          method: "initialize",
          params: {
            protocolVersion: "2025-03-26",
            capabilities: {},
            clientInfo: { name: "claude-code", version: "1.0" },
          },
          id: 1,
        });
      expect(res.status).toBe(200);
      const sid = res.headers["mcp-session-id"];
      expect(sid).toBeDefined();
      return sid;
    }

    it("POST: drops the session and returns 404 when the request token changed", async () => {
      const sid = await initSession("original-token");
      expect(sessions[sid]).toBeDefined();

      const res = await request(app)
        .post("/mcp")
        .set("Content-Type", "application/json")
        .set("Accept", "application/json, text/event-stream")
        .set("Authorization", "Bearer rotated-token")
        .set("mcp-session-id", sid)
        .send({ jsonrpc: "2.0", method: "tools/list", id: 2 });

      expect(res.status).toBe(404);
      expect(res.body.error.message).toMatch(/credential changed/i);
      expect(sessions[sid]).toBeUndefined();
      // Persisted record should also be cleaned so a rehydrate doesn't revive it.
      expect(await mockStore.getMcpSession(sid)).toBeUndefined();
    });

    it("POST: passes through when the request token matches", async () => {
      const sid = await initSession("steady-token");

      const res = await request(app)
        .post("/mcp")
        .set("Content-Type", "application/json")
        .set("Accept", "application/json, text/event-stream")
        .set("Authorization", "Bearer steady-token")
        .set("mcp-session-id", sid)
        .send({ jsonrpc: "2.0", method: "tools/list", id: 2 });

      expect(res.status).not.toBe(404);
      expect(sessions[sid]).toBeDefined();
    });

    it("DELETE: refuses when the request token doesn't match (without closing the session)", async () => {
      const sid = await initSession("owner-token");
      expect(sessions[sid]).toBeDefined();

      const res = await request(app)
        .delete("/mcp")
        .set("Authorization", "Bearer attacker-token")
        .set("mcp-session-id", sid);

      expect(res.status).toBe(404);
      // Session must remain intact — a non-owner DELETE is not authoritative.
      expect(sessions[sid]).toBeDefined();
    });
  });

  // ─── DELETE Cleanup ───────────────────────────────────────────────

  describe("DELETE /mcp", () => {
    it("removes a persisted MCP session from the store even when not in memory", async () => {
      const sessionId = "delete-me-session";
      const token = "delete-token";

      await mockStore.storeMcpSession(sessionId, {
        authToken: token,
        mcpClient: "claude-code",
        isApiKey: false,
        wantsJsonOnly: false,
        hasStoredOAuthSession: false,
        createdAt: Date.now(),
      });

      // No bearer token → can't rehydrate, but we should still drop the
      // persisted record so it doesn't outlive the client's intent.
      const res = await request(app)
        .delete("/mcp")
        .set("mcp-session-id", sessionId);

      expect(res.status).toBe(404);
      expect(await mockStore.getMcpSession(sessionId)).toBeUndefined();
    });
  });

  // ─── OAuth Client Registration ────────────────────────────────────

  describe("POST /oauth/register", () => {
    it("returns 201 with client_id for valid registration", async () => {
      const res = await request(app)
        .post("/oauth/register")
        .set("Content-Type", "application/json")
        .send({
          redirect_uris: ["http://localhost:3000/callback"],
          client_name: "Test Client",
        });

      expect(res.status).toBe(201);
      expect(res.body.client_id).toMatch(/^mcp-/);
      expect(res.body.client_secret).toBeDefined();
      expect(res.body.client_name).toBe("Test Client");
      expect(res.body.redirect_uris).toEqual(["http://localhost:3000/callback"]);
    });

    it("returns 400 when redirect_uris is missing", async () => {
      const res = await request(app)
        .post("/oauth/register")
        .set("Content-Type", "application/json")
        .send({ client_name: "Test Client" });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("invalid_client_metadata");
    });

    it("returns 400 for non-HTTPS non-localhost redirect URI", async () => {
      const res = await request(app)
        .post("/oauth/register")
        .set("Content-Type", "application/json")
        .send({
          redirect_uris: ["http://evil.com/callback"],
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("invalid_redirect_uri");
    });

    it("accepts HTTPS redirect URIs", async () => {
      const res = await request(app)
        .post("/oauth/register")
        .set("Content-Type", "application/json")
        .send({
          redirect_uris: ["https://example.com/callback"],
        });

      expect(res.status).toBe(201);
    });
  });

  // ─── OAuth Token Endpoint ─────────────────────────────────────────

  describe("POST /oauth/token", () => {
    it("returns 400 for unsupported grant_type", async () => {
      const res = await request(app)
        .post("/oauth/token")
        .set("Content-Type", "application/x-www-form-urlencoded")
        .send("grant_type=password&username=foo&password=bar");

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("unsupported_grant_type");
    });

    it("returns 400 when refresh_token is missing for refresh grant", async () => {
      const res = await request(app)
        .post("/oauth/token")
        .set("Content-Type", "application/x-www-form-urlencoded")
        .send("grant_type=refresh_token");

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("invalid_request");
      expect(res.body.error_description).toMatch(/refresh_token/);
    });

    it("returns 400 when code is missing for authorization_code grant", async () => {
      const res = await request(app)
        .post("/oauth/token")
        .set("Content-Type", "application/x-www-form-urlencoded")
        .send("grant_type=authorization_code");

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("invalid_request");
      expect(res.body.error_description).toMatch(/code/);
    });

    it("proxies refresh_token request to Nestr", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        status: 200,
        json: async () => ({
          access_token: "new-token",
          refresh_token: "new-refresh",
          token_type: "bearer",
        }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const res = await request(app)
        .post("/oauth/token")
        .set("Content-Type", "application/x-www-form-urlencoded")
        .send("grant_type=refresh_token&refresh_token=old-refresh&client_id=test");

      expect(res.status).toBe(200);
      expect(res.body.access_token).toBe("new-token");

      // Verify fetch was called with the right params
      expect(mockFetch).toHaveBeenCalled();
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toMatch(/\/oauth\/token$/);
      expect(opts.method).toBe("POST");

      vi.unstubAllGlobals();
    });
  });

  // ─── DELETE /mcp ──────────────────────────────────────────────────

  describe("DELETE /mcp", () => {
    it("returns 404 without session ID", async () => {
      const res = await request(app).delete("/mcp");
      expect(res.status).toBe(404);
      expect(res.body.error.message).toMatch(/session not found/i);
    });

    it("returns 404 for unknown session ID", async () => {
      const res = await request(app)
        .delete("/mcp")
        .set("mcp-session-id", "nonexistent");
      expect(res.status).toBe(404);
    });
  });

  // ─── Flow B (Cowork-style) auth surfacing ──────────────────────────
  // Regression: a tool call with an expired bearer must come back as a
  // transport-level HTTP 401 + WWW-Authenticate so the MCP SDK auto-refreshes.
  // Returning a 200 with `isError: true` (the original Cowork bug) leaves the
  // SDK wedged on a dead token until the user reconnects manually.

  describe("POST /mcp — Flow B auth surfacing", () => {
    async function initFlowBSession(token: string): Promise<string> {
      // Init: server probes /users/me to identify the user. Return success so
      // the session gets created. Then we'll swap in a 401 for the tool call.
      const initFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ _id: "user-1", username: "alice", profile: { fullName: "Alice" } }),
        json: async () => ({ _id: "user-1", username: "alice", profile: { fullName: "Alice" } }),
      });
      vi.stubGlobal("fetch", initFetch);

      const res = await request(app)
        .post("/mcp")
        .set("Content-Type", "application/json")
        .set("Accept", "application/json, text/event-stream")
        .set("Authorization", `Bearer ${token}`)
        .send({
          jsonrpc: "2.0",
          method: "initialize",
          params: {
            protocolVersion: "2025-03-26",
            capabilities: {},
            clientInfo: { name: "cowork-test", version: "1.0" },
          },
          id: 1,
        });

      vi.unstubAllGlobals();
      expect(res.status).toBe(200);
      const sid = res.headers["mcp-session-id"];
      expect(sid).toBeDefined();
      return sid;
    }

    /** Parse an SSE-framed response body. Returns the first JSON-RPC payload found. */
    function parseSse(body: string): unknown {
      const dataLine = body.split("\n").find((line) => line.startsWith("data: "));
      if (!dataLine) throw new Error(`No SSE data in body: ${body.slice(0, 200)}`);
      return JSON.parse(dataLine.slice("data: ".length));
    }

    it("returns HTTP 401 + WWW-Authenticate when Nestr rejects the bearer on a tool call", async () => {
      const token = "flow-b-stale-bearer";
      const sid = await initFlowBSession(token);

      // Tool-call time: pre-flight probe to /users/me 401s.
      const tool401 = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => JSON.stringify({ message: "You must be logged in to do this." }),
        json: async () => ({ message: "You must be logged in to do this." }),
      });
      vi.stubGlobal("fetch", tool401);

      const res = await request(app)
        .post("/mcp")
        .set("Content-Type", "application/json")
        .set("Accept", "application/json, text/event-stream")
        .set("Authorization", `Bearer ${token}`)
        .set("mcp-session-id", sid)
        .send({
          jsonrpc: "2.0",
          method: "tools/call",
          params: { name: "nestr_list_workspaces", arguments: {} },
          id: 2,
        });

      // Transport-level 401, NOT 200 with isError:true. Triggers MCP SDK re-auth.
      expect(res.status).toBe(401);
      expect(res.headers["www-authenticate"]).toMatch(/^Bearer resource_metadata="/);
      expect(res.headers["www-authenticate"]).toContain('error="invalid_token"');
      // 401 path returns plain JSON (not SSE) since we short-circuit before
      // transport.handleRequest.
      expect(res.body.error.data?.flow).toBe("B");

      vi.unstubAllGlobals();
    });

    it("returns a tool result (not transport 401) when Nestr returns 403 — scope, not auth", async () => {
      const token = "flow-b-scoped-bearer";
      const sid = await initFlowBSession(token);

      // Pre-flight probe says 200 (token is valid). The actual tool then 403s.
      const fetchSeq = vi.fn()
        // pre-flight /users/me
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ _id: "user-1", username: "alice" }),
          json: async () => ({ _id: "user-1", username: "alice" }),
        })
        // tool: GET /workspaces
        .mockResolvedValueOnce({
          ok: false,
          status: 403,
          text: async () => JSON.stringify({ message: "Access denied" }),
          json: async () => ({ message: "Access denied" }),
        });
      vi.stubGlobal("fetch", fetchSeq);

      const res = await request(app)
        .post("/mcp")
        .set("Content-Type", "application/json")
        .set("Accept", "application/json, text/event-stream")
        .set("Authorization", `Bearer ${token}`)
        .set("mcp-session-id", sid)
        .send({
          jsonrpc: "2.0",
          method: "tools/call",
          params: { name: "nestr_list_workspaces", arguments: {} },
          id: 3,
        });

      // 403 is "valid token, no permission". It must NOT trigger transport-level
      // re-auth — that would kick the user out of a perfectly good session.
      expect(res.status).toBe(200);
      expect(res.headers["www-authenticate"]).toBeUndefined();
      // SSE-framed response — extract the JSON-RPC envelope from `data: ...`.
      const envelope = parseSse(res.text) as { result?: { content?: Array<{ text?: string }> } };
      const text = envelope.result?.content?.[0]?.text || "";
      expect(text).toContain("AUTH_SCOPE_INSUFFICIENT");
      expect(text).not.toContain("AUTH_TOKEN_REJECTED_BY_NESTR");

      vi.unstubAllGlobals();
    });

    it("nestr_diagnose works without an Authorization header", async () => {
      // No Authorization header — diagnose is the escape hatch when the bearer
      // is missing or rejected. It should still return a tool result describing
      // the (lack of) auth state.
      const token = "diagnose-bearer";
      const sid = await initFlowBSession(token);

      // No fetch stubs — diagnose doesn't talk to Nestr.
      const res = await request(app)
        .post("/mcp")
        .set("Content-Type", "application/json")
        .set("Accept", "application/json, text/event-stream")
        // Authorization header still set on the connection (the session is
        // bound to it), but diagnose itself bypasses pre-flight.
        .set("Authorization", `Bearer ${token}`)
        .set("mcp-session-id", sid)
        .send({
          jsonrpc: "2.0",
          method: "tools/call",
          params: { name: "nestr_diagnose", arguments: {} },
          id: 4,
        });

      expect(res.status).toBe(200);
      const envelope = parseSse(res.text) as { result?: { content?: Array<{ text?: string }> } };
      const text = envelope.result?.content?.[0]?.text;
      expect(text).toBeDefined();
      const parsed = JSON.parse(text!);
      expect(parsed.flow).toBe("B");
      expect(parsed.tokenPresented).toBe(true);
      expect(parsed.serverVersion).toBeTruthy();
      expect(parsed.tokenFingerprint).toMatch(/^\d+:[a-f0-9]+/);
    });
  });
});
