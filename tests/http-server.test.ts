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

const { app, sessions, findCoalescableSession, SESSION_COALESCE_MAX_INITS, SESSION_COALESCE_WINDOW_MS } = await import("../src/http.js");

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
        initCallCount: 1,
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
        initCallCount: 1,
      } as any;

      expect(findCoalescableSession("token-b", "client-a")).toBeUndefined();
    });

    it("does not match different client name", () => {
      sessions["test-session-1"] = {
        authToken: "token-a",
        mcpClient: "client-a",
        lastActivityAt: Date.now(),
        initCallCount: 1,
      } as any;

      expect(findCoalescableSession("token-a", "client-b")).toBeUndefined();
    });

    it("does not match when initCallCount exceeds limit", () => {
      sessions["test-session-1"] = {
        authToken: "token-a",
        mcpClient: "client-a",
        lastActivityAt: Date.now(),
        initCallCount: SESSION_COALESCE_MAX_INITS,
      } as any;

      expect(findCoalescableSession("token-a", "client-a")).toBeUndefined();
    });

    it("does not match stale sessions", () => {
      sessions["test-session-1"] = {
        authToken: "token-a",
        mcpClient: "client-a",
        lastActivityAt: Date.now() - SESSION_COALESCE_WINDOW_MS - 60_000, // past the window
        initCallCount: 1,
      } as any;

      expect(findCoalescableSession("token-a", "client-a")).toBeUndefined();
    });

    it("still matches dead SSE session (but deprioritized)", () => {
      sessions["test-session-1"] = {
        authToken: "token-a",
        mcpClient: "client-a",
        lastActivityAt: Date.now(),
        initCallCount: 1,
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
        initCallCount: 1,
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
        initCallCount: 1,
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
        initCallCount: 1,
        sseResponse: { writableEnded: true } as any,
      } as any;

      sessions["live-sse"] = {
        authToken: "token-a",
        mcpClient: "client-a",
        lastActivityAt: Date.now() - 5000, // older but live SSE
        initCallCount: 1,
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
        initCallCount: 1,
      } as any;

      sessions["newer"] = {
        authToken: "token-a",
        mcpClient: "client-a",
        lastActivityAt: Date.now(),
        initCallCount: 1,
      } as any;

      const result = findCoalescableSession("token-a", "client-a");
      expect(result!.sessionId).toBe("newer");
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
});
