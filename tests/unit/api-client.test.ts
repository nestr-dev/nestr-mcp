import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NestrClient, NestrApiError } from "../../src/api/client.js";

describe("NestrClient", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function createClient(overrides?: Partial<ConstructorParameters<typeof NestrClient>[0]>) {
    return new NestrClient({
      apiKey: "test-api-key",
      baseUrl: "https://api.test.io/api",
      ...overrides,
    });
  }

  function mockResponse(status: number, body: unknown, ok = status < 400) {
    return {
      ok,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  }

  // ─── URL & Headers ──────────────────────────────────────────────

  it("constructs correct URL from baseUrl + endpoint", async () => {
    mockFetch.mockResolvedValue(mockResponse(200, []));
    const client = createClient();
    await client.listWorkspaces();

    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.test.io/api/workspaces");
  });

  it("sends Authorization Bearer header", async () => {
    mockFetch.mockResolvedValue(mockResponse(200, []));
    const client = createClient();
    await client.listWorkspaces();

    const [, opts] = mockFetch.mock.calls[0];
    expect(opts.headers.Authorization).toBe("Bearer test-api-key");
  });

  it("sends X-MCP-Client header when mcpClient is set", async () => {
    mockFetch.mockResolvedValue(mockResponse(200, []));
    const client = createClient({ mcpClient: "claude-desktop" });
    await client.listWorkspaces();

    const [, opts] = mockFetch.mock.calls[0];
    expect(opts.headers["X-MCP-Client"]).toBe("claude-desktop");
  });

  it("does not send X-MCP-Client header when mcpClient is not set", async () => {
    mockFetch.mockResolvedValue(mockResponse(200, []));
    const client = createClient();
    await client.listWorkspaces();

    const [, opts] = mockFetch.mock.calls[0];
    expect(opts.headers["X-MCP-Client"]).toBeUndefined();
  });

  it("defaults baseUrl to app.nestr.io", async () => {
    mockFetch.mockResolvedValue(mockResponse(200, []));
    const client = new NestrClient({ apiKey: "key" });
    await client.listWorkspaces();

    const [url] = mockFetch.mock.calls[0];
    expect(url).toMatch(/^https:\/\/app\.nestr\.io\/api\//);
  });

  // ─── Token Refresh ──────────────────────────────────────────────

  it("retries once on 401 when tokenProvider is set", async () => {
    const tokenProvider = vi.fn().mockResolvedValue("refreshed-token");
    const client = createClient({ tokenProvider });

    mockFetch
      .mockResolvedValueOnce(mockResponse(401, { message: "Unauthorized" }))
      .mockResolvedValueOnce(mockResponse(200, [{ _id: "ws1" }]));

    const result = await client.listWorkspaces();
    expect(result).toEqual([{ _id: "ws1" }]);
    expect(tokenProvider).toHaveBeenCalledOnce();
    expect(mockFetch).toHaveBeenCalledTimes(2);

    // Second call should use the refreshed token
    const [, secondOpts] = mockFetch.mock.calls[1];
    expect(secondOpts.headers.Authorization).toBe("Bearer refreshed-token");
  });

  it("does not retry 401 without tokenProvider", async () => {
    const client = createClient();
    mockFetch.mockResolvedValue(mockResponse(401, { message: "Unauthorized" }));

    await expect(client.listWorkspaces()).rejects.toThrow(NestrApiError);
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it("does not retry more than once", async () => {
    const tokenProvider = vi.fn().mockResolvedValue("refreshed-token");
    const client = createClient({ tokenProvider });

    // Both calls return 401
    mockFetch.mockResolvedValue(mockResponse(401, { message: "Unauthorized" }));

    await expect(client.listWorkspaces()).rejects.toThrow(NestrApiError);
    expect(mockFetch).toHaveBeenCalledTimes(2); // original + 1 retry
  });

  // ─── Error Classification ──────────────────────────────────────

  it("classifies 401 as AUTH_TOKEN_REJECTED_BY_NESTR", async () => {
    mockFetch.mockResolvedValue(mockResponse(401, { message: "Unauthorized" }));
    const client = createClient();

    try {
      await client.listWorkspaces();
    } catch (err) {
      expect(err).toBeInstanceOf(NestrApiError);
      expect((err as NestrApiError).code).toBe("AUTH_TOKEN_REJECTED_BY_NESTR");
    }
  });

  it("classifies 404 as NOT_FOUND", async () => {
    mockFetch.mockResolvedValue(mockResponse(404, { message: "Not found" }));
    const client = createClient();

    try {
      await client.listWorkspaces();
    } catch (err) {
      expect((err as NestrApiError).code).toBe("NOT_FOUND");
    }
  });

  it("classifies 429 as RATE_LIMITED", async () => {
    mockFetch.mockResolvedValue(mockResponse(429, { message: "Too many" }));
    const client = createClient();

    try {
      await client.listWorkspaces();
    } catch (err) {
      expect((err as NestrApiError).code).toBe("RATE_LIMITED");
      expect((err as NestrApiError).retryable).toBe(true);
    }
  });

  it("classifies 500 as SERVER_ERROR", async () => {
    mockFetch.mockResolvedValue(mockResponse(500, { message: "Internal error" }));
    const client = createClient();

    try {
      await client.listWorkspaces();
    } catch (err) {
      expect((err as NestrApiError).code).toBe("SERVER_ERROR");
      expect((err as NestrApiError).retryable).toBe(true);
    }
  });

  it("classifies 403 with 'app disabled' as APP_DISABLED", async () => {
    mockFetch.mockResolvedValue(mockResponse(403, { message: "App is not enabled" }));
    const client = createClient();

    try {
      await client.listWorkspaces();
    } catch (err) {
      expect((err as NestrApiError).code).toBe("APP_DISABLED");
    }
  });

  it("classifies 403 with 'plan' as PLAN_REQUIRED", async () => {
    mockFetch.mockResolvedValue(mockResponse(403, { message: "Requires Pro plan" }));
    const client = createClient();

    try {
      await client.listWorkspaces();
    } catch (err) {
      expect((err as NestrApiError).code).toBe("PLAN_REQUIRED");
    }
  });

  it("classifies generic 403 as AUTH_SCOPE_INSUFFICIENT", async () => {
    mockFetch.mockResolvedValue(mockResponse(403, { message: "Access denied" }));
    const client = createClient();

    try {
      await client.listWorkspaces();
    } catch (err) {
      expect((err as NestrApiError).code).toBe("AUTH_SCOPE_INSUFFICIENT");
    }
  });

  it("logs a bearer fingerprint on 401 (and not on other statuses)", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    mockFetch.mockResolvedValue(mockResponse(401, { message: "You must be logged in" }));
    const client = createClient({ apiKey: "nestr_abcdef1234567890abcdef" });

    try {
      await client.listWorkspaces();
    } catch {
      // expected
    }

    const logs = logSpy.mock.calls.map((args) => args.join(" ")).join("\n");
    expect(logs).toContain("[Auth] 401 from Nestr");
    expect(logs).toContain("/workspaces");
    // Fingerprint format: <length>:<sha256-prefix-8>:<last-6>. Token is 28 chars, last 6 are "abcdef".
    expect(logs).toMatch(/\[Auth\] 401 from Nestr.*fingerprint=28:[a-f0-9]{8}:abcdef/);
    // Full token must never appear in logs.
    expect(logs).not.toContain("nestr_abcdef1234567890abcdef");

    // 200 path: no [Auth] 401 fingerprint log. (The structured [Outbound] /
    // [Upstream] lines fire on every request — those are intentional and
    // include only the fingerprint, never the raw token.)
    logSpy.mockClear();
    mockFetch.mockResolvedValue(mockResponse(200, []));
    await client.listWorkspaces();
    const okLogs = logSpy.mock.calls.map((args) => args.join(" ")).join("\n");
    expect(okLogs).not.toContain("[Auth] 401 from Nestr");
    expect(okLogs).not.toContain("nestr_abcdef1234567890abcdef");

    logSpy.mockRestore();
  });

  it("omits the fingerprint tail when the token is too short to safely expose 6 chars", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    mockFetch.mockResolvedValue(mockResponse(401, { message: "Unauthorized" }));
    // 5-char token: well under the 16-char threshold for including the tail.
    const shortToken = "short";
    const client = createClient({ apiKey: shortToken });

    try {
      await client.listWorkspaces();
    } catch {
      // expected
    }

    const logs = logSpy.mock.calls.map((args) => args.join(" ")).join("\n");
    // Format: <length>:<sha256-prefix-8> with NO trailing :<tail>.
    expect(logs).toMatch(/fingerprint=5:[a-f0-9]{8}(?!:)/);
    expect(logs).not.toContain(shortToken);

    logSpy.mockRestore();
  });
});

// ─── NestrApiError ────────────────────────────────────────────────

describe("NestrApiError", () => {
  describe("toToolError", () => {
    it("produces structured error object", () => {
      const err = new NestrApiError("Not found", 404, "/nests/abc");
      const toolError = err.toToolError();

      // Outside a request context, correlationId is undefined.
      expect(toolError).toEqual({
        error: true,
        code: "NOT_FOUND",
        message: "Not found",
        status: 404,
        retryable: false,
        hint: undefined,
        flow: undefined,
        correlationId: undefined,
      });
    });

    it("includes hint when set", () => {
      const err = new NestrApiError("Auth failed", 401, "/workspaces", {
        hint: "Check your token",
      });
      expect(err.toToolError().hint).toBe("Check your token");
    });

    it("carries flow through to the tool error", () => {
      const err = new NestrApiError("Auth failed", 401, "/workspaces", { flow: "B" });
      expect(err.toToolError().flow).toBe("B");
    });
  });

  describe("retryable inference", () => {
    it("RATE_LIMITED is retryable", () => {
      const err = new NestrApiError("Too many", 429, "/");
      expect(err.retryable).toBe(true);
    });

    it("SERVER_ERROR is retryable", () => {
      const err = new NestrApiError("Error", 500, "/");
      expect(err.retryable).toBe(true);
    });

    it("AUTH_TOKEN_REJECTED_BY_NESTR is not retryable", () => {
      const err = new NestrApiError("Unauthorized", 401, "/");
      expect(err.retryable).toBe(false);
    });

    it("AUTH_REFRESH_NOT_ATTEMPTED is retryable (server bug, retry once)", () => {
      const err = new NestrApiError("server bug", 401, "/", { code: "AUTH_REFRESH_NOT_ATTEMPTED" });
      expect(err.retryable).toBe(true);
    });

    it("AUTH_PROXY_HEADER_DROPPED is retryable (server bug, retry once)", () => {
      const err = new NestrApiError("header missing", 500, "/", { code: "AUTH_PROXY_HEADER_DROPPED" });
      expect(err.retryable).toBe(true);
    });

    it("AUTH_REFRESH_FAILED is not retryable (user must reconnect)", () => {
      const err = new NestrApiError("refresh rejected", 401, "/", { code: "AUTH_REFRESH_FAILED" });
      expect(err.retryable).toBe(false);
    });

    it("AUTH_SCOPE_INSUFFICIENT is not retryable", () => {
      const err = new NestrApiError("forbidden", 403, "/");
      expect(err.code).toBe("AUTH_SCOPE_INSUFFICIENT");
      expect(err.retryable).toBe(false);
    });

    it("NOT_FOUND is not retryable", () => {
      const err = new NestrApiError("Not found", 404, "/");
      expect(err.retryable).toBe(false);
    });
  });

  // The hints attached by NestrClient on 401/403 must let an LLM client
  // branch by substring without parsing fields. Three buckets:
  //   - "client should refresh"   → token-rejected on Flow B
  //   - "user must re-OAuth"      → refresh failed on Flow A, or generic 401
  //   - "server bug"              → AUTH_REFRESH_NOT_ATTEMPTED / AUTH_PROXY_HEADER_DROPPED
  describe("hint LLM-branching substrings", () => {
    let mockFetch: ReturnType<typeof vi.fn>;
    beforeEach(() => {
      mockFetch = vi.fn();
      vi.stubGlobal("fetch", mockFetch);
    });
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    function mockResponse(status: number, body: unknown) {
      return {
        ok: status < 400,
        status,
        json: async () => body,
        text: async () => JSON.stringify(body),
      };
    }

    it("Flow B 401 hint tells the client to refresh", async () => {
      mockFetch.mockResolvedValue(mockResponse(401, { message: "no token" }));
      const client = new NestrClient({ apiKey: "x", flow: "B", baseUrl: "https://api.test/api" });
      try {
        await client.listWorkspaces();
      } catch (err) {
        const hint = (err as NestrApiError).hint || "";
        expect(hint).toMatch(/client.*responsibility|grant_type=refresh_token/i);
      }
    });

    it("Flow A refresh-failed hint tells the user to re-OAuth", () => {
      const err = new NestrApiError("refresh rejected", 401, "/", {
        code: "AUTH_REFRESH_FAILED",
        flow: "A",
        hint: "Server-side refresh failed. User must re-authenticate via /oauth/authorize.",
      });
      expect(err.hint).toMatch(/re-?authenticate|re-?OAuth|reconnect/i);
    });

    it("AUTH_REFRESH_NOT_ATTEMPTED hint flags it as a server bug", () => {
      // We don't have a public API that emits this code yet (HTTP layer is
      // the place to set it). Construct directly to validate the contract.
      const err = new NestrApiError("ought to have refreshed", 401, "/", {
        code: "AUTH_REFRESH_NOT_ATTEMPTED",
        hint: "Server bug: refresh should have been attempted. Retry once.",
      });
      expect(err.hint).toMatch(/server bug/i);
      expect(err.retryable).toBe(true);
    });
  });
});
