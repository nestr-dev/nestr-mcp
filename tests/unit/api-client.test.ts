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

  it("classifies 401 as AUTH_FAILED", async () => {
    mockFetch.mockResolvedValue(mockResponse(401, { message: "Unauthorized" }));
    const client = createClient();

    try {
      await client.listWorkspaces();
    } catch (err) {
      expect(err).toBeInstanceOf(NestrApiError);
      expect((err as NestrApiError).code).toBe("AUTH_FAILED");
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

  it("classifies generic 403 as FORBIDDEN", async () => {
    mockFetch.mockResolvedValue(mockResponse(403, { message: "Access denied" }));
    const client = createClient();

    try {
      await client.listWorkspaces();
    } catch (err) {
      expect((err as NestrApiError).code).toBe("FORBIDDEN");
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
    expect(logs).toMatch(/fingerprint=28:[a-f0-9]{8}:abcdef/);
    // Full token must never appear in logs.
    expect(logs).not.toContain("nestr_abcdef1234567890abcdef");

    // 200 path: no fingerprint log.
    logSpy.mockClear();
    mockFetch.mockResolvedValue(mockResponse(200, []));
    await client.listWorkspaces();
    expect(logSpy).not.toHaveBeenCalled();

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

      expect(toolError).toEqual({
        error: true,
        code: "NOT_FOUND",
        message: "Not found",
        status: 404,
        retryable: false,
        hint: undefined,
      });
    });

    it("includes hint when set", () => {
      const err = new NestrApiError("Auth failed", 401, "/workspaces", {
        hint: "Check your token",
      });
      expect(err.toToolError().hint).toBe("Check your token");
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

    it("AUTH_FAILED is not retryable", () => {
      const err = new NestrApiError("Unauthorized", 401, "/");
      expect(err.retryable).toBe(false);
    });

    it("NOT_FOUND is not retryable", () => {
      const err = new NestrApiError("Not found", 404, "/");
      expect(err.retryable).toBe(false);
    });
  });
});
