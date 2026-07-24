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

  // ─── Connectors ─────────────────────────────────────────────────

  it("listConnectors GETs the catalog and unwraps data", async () => {
    const entries = [
      { _id: "c1", workspaceId: "ws1", type: "mcp", name: "Slack", enabled: true },
      { _id: "c2", workspaceId: "ws1", type: "cli", name: "Deploy", enabled: false },
    ];
    mockFetch.mockResolvedValue(mockResponse(200, { status: "success", data: entries }));
    const client = createClient();

    const result = await client.listConnectors("ws1");

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.test.io/api/workspaces/ws1/connectors");
    expect(opts.method ?? "GET").toBe("GET");
    // Unwrapped from { status, data }
    expect(result).toEqual(entries);
  });

  it("registerConnector POSTs the body and unwraps the created connector", async () => {
    const created = { _id: "c9", workspaceId: "ws1", type: "mcp", name: "Slack", enabled: true };
    mockFetch.mockResolvedValue(mockResponse(200, { status: "success", data: created }));
    const client = createClient();

    const result = await client.registerConnector("ws1", {
      type: "mcp",
      name: "Slack",
      config: { url: "https://mcp.example.com" },
      exposure: { domainGated: true },
      authStrategy: "secret",
    });

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.test.io/api/workspaces/ws1/connectors");
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body)).toEqual({
      type: "mcp",
      name: "Slack",
      config: { url: "https://mcp.example.com" },
      exposure: { domainGated: true },
      authStrategy: "secret",
    });
    expect(result).toEqual(created);
  });

  it("bindConnector POSTs connectorId + owner and unwraps the connection", async () => {
    const connection = {
      _id: "conn1",
      workspaceId: "ws1",
      owner: { type: "role-domain", id: "domain-7" },
      status: "active",
      credentialsField: { domainId: "domain-7", fieldId: "domain-7-credentials-connector_credentials", fieldCode: "connector_credentials" },
    };
    mockFetch.mockResolvedValue(mockResponse(200, { status: "success", data: connection }));
    const client = createClient();

    const result = await client.bindConnector("ws1", {
      connectorId: "c9",
      owner: { type: "role-domain", id: "domain-7" },
    });

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.test.io/api/workspaces/ws1/connections");
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body)).toEqual({
      connectorId: "c9",
      owner: { type: "role-domain", id: "domain-7" },
    });
    expect(result).toEqual(connection);
    expect(result.credentialsField?.domainId).toBe("domain-7");
  });

  it("registerConnector surfaces a 403 as AUTH_SCOPE_INSUFFICIENT (admin-only)", async () => {
    mockFetch.mockResolvedValue(
      mockResponse(403, { status: "error", message: "Workspace admin access is required to manage connectors" })
    );
    const client = createClient();

    await expect(
      client.registerConnector("ws1", { type: "mcp", name: "Slack" })
    ).rejects.toMatchObject({ code: "AUTH_SCOPE_INSUFFICIENT", status: 403 });
  });

  // ─── Sort / pagination pass-through ─────────────────────────────
  // All list endpoints backed by the API's getMultiple handler honor a
  // `sort` query param (field name, '-' prefix for descending).

  it("listWorkspaces passes sort as a query param", async () => {
    mockFetch.mockResolvedValue(mockResponse(200, []));
    const client = createClient();
    await client.listWorkspaces({ sort: "-updatedAt" });

    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.test.io/api/workspaces?sort=-updatedAt");
  });

  it("searchWorkspace passes sort alongside search", async () => {
    mockFetch.mockResolvedValue(mockResponse(200, []));
    const client = createClient();
    await client.searchWorkspace("ws1", "label:project", { sort: "due", limit: 5 });

    const [url] = mockFetch.mock.calls[0];
    const parsed = new URL(url);
    expect(parsed.pathname).toBe("/api/workspaces/ws1/search");
    expect(parsed.searchParams.get("search")).toBe("label:project");
    expect(parsed.searchParams.get("sort")).toBe("due");
    expect(parsed.searchParams.get("limit")).toBe("5");
  });

  it("getWorkspaceProjects passes sort, limit and page", async () => {
    mockFetch.mockResolvedValue(mockResponse(200, []));
    const client = createClient();
    await client.getWorkspaceProjects("ws1", { sort: "-due", limit: 10, page: 2 });

    const [url] = mockFetch.mock.calls[0];
    const parsed = new URL(url);
    expect(parsed.pathname).toBe("/api/workspaces/ws1/projects");
    expect(parsed.searchParams.get("sort")).toBe("-due");
    expect(parsed.searchParams.get("limit")).toBe("10");
    expect(parsed.searchParams.get("page")).toBe("2");
  });

  it("getNestChildren passes sort", async () => {
    mockFetch.mockResolvedValue(mockResponse(200, []));
    const client = createClient();
    await client.getNestChildren("nest1", { sort: "title" });

    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.test.io/api/nests/nest1/children?sort=title");
  });

  it("listCircles, getCircleRoles and listRoles pass sort", async () => {
    mockFetch.mockResolvedValue(mockResponse(200, []));
    const client = createClient();
    await client.listCircles("ws1", { sort: "title" });
    await client.getCircleRoles("ws1", "circle1", { sort: "title" });
    await client.listRoles("ws1", { sort: "-createdAt" });

    expect(mockFetch.mock.calls[0][0]).toBe("https://api.test.io/api/workspaces/ws1/circles?sort=title");
    expect(mockFetch.mock.calls[1][0]).toBe("https://api.test.io/api/workspaces/ws1/circles/circle1/roles?sort=title");
    expect(mockFetch.mock.calls[2][0]).toBe("https://api.test.io/api/workspaces/ws1/roles?sort=-createdAt");
  });

  it("listTensions sends sort (not the legacy order param) and page", async () => {
    mockFetch.mockResolvedValue(mockResponse(200, []));
    const client = createClient();
    await client.listTensions("circle1", undefined, { sort: "-createdAt", limit: 20, page: 2 });

    const [url] = mockFetch.mock.calls[0];
    const parsed = new URL(url);
    expect(parsed.pathname).toBe("/api/nests/circle1/tensions");
    expect(parsed.searchParams.get("sort")).toBe("-createdAt");
    expect(parsed.searchParams.get("order")).toBeNull();
    expect(parsed.searchParams.get("limit")).toBe("20");
    expect(parsed.searchParams.get("page")).toBe("2");
  });

  it("omits sort from the URL when not provided", async () => {
    mockFetch.mockResolvedValue(mockResponse(200, []));
    const client = createClient();
    await client.getWorkspaceProjects("ws1", { cleanText: true });

    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.test.io/api/workspaces/ws1/projects?cleanText=true");
  });

  // ─── Elections ──────────────────────────────────────────────────

  it("createElection POSTs an election part to the tension parts endpoint", async () => {
    mockFetch.mockResolvedValue(
      mockResponse(200, { _id: "part-1", items: [{ _id: "role-1", labels: ["election"], users: ["user-1"] }] })
    );
    const client = createClient();
    const result = await client.createElection("circle-1", "tension-1", {
      roleId: "role-1",
      users: ["user-1"],
      due: "2027-01-01T00:00:00.000Z",
    });

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.test.io/api/nests/circle-1/tensions/tension-1/parts");
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body)).toEqual({
      labels: ["election"],
      roleId: "role-1",
      users: ["user-1"],
      due: "2027-01-01T00:00:00.000Z",
    });
    expect(result.items).toHaveLength(1);
  });

  it("createElection omits due when no term is given", async () => {
    mockFetch.mockResolvedValue(mockResponse(200, { _id: "part-1" }));
    const client = createClient();
    await client.createElection("circle-1", "tension-1", { roleId: "role-1", users: ["user-1"] });

    const [, opts] = mockFetch.mock.calls[0];
    expect(JSON.parse(opts.body)).toEqual({
      labels: ["election"],
      roleId: "role-1",
      users: ["user-1"],
    });
  });

  describe("getNest diagnosis flags", () => {
    it("adds provenance=true", async () => {
      mockFetch.mockResolvedValue(mockResponse(200, {}));
      await createClient().getNest("n1", { provenance: true });
      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain("provenance=true");
    });

    it("adds rights=true and forUser", async () => {
      mockFetch.mockResolvedValue(mockResponse(200, {}));
      await createClient().getNest("n1", { rights: true, forUser: "u42" });
      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain("rights=true");
      expect(url).toContain("forUser=u42");
    });

    it("adds whoCan ops (comma-encoded)", async () => {
      mockFetch.mockResolvedValue(mockResponse(200, {}));
      await createClient().getNest("n1", { whoCan: "update,delete" });
      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain("whoCan=update%2Cdelete");
    });

    it("omits the diagnosis params when not requested", async () => {
      mockFetch.mockResolvedValue(mockResponse(200, {}));
      await createClient().getNest("n1");
      const [url] = mockFetch.mock.calls[0];
      expect(url).not.toContain("provenance");
      expect(url).not.toContain("rights");
      expect(url).not.toContain("whoCan");
    });
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
  //   - "server bug"              → AUTH_PROXY_HEADER_DROPPED
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

    it("AUTH_PROXY_HEADER_DROPPED hint flags it as a server bug", async () => {
      // Empty apiKey triggers the outbound assertion guard.
      const client = new NestrClient({ apiKey: "", flow: "B", baseUrl: "https://api.test/api" });
      try {
        await client.listWorkspaces();
      } catch (err) {
        expect((err as NestrApiError).code).toBe("AUTH_PROXY_HEADER_DROPPED");
        expect((err as NestrApiError).hint).toMatch(/server bug/i);
        expect((err as NestrApiError).retryable).toBe(true);
      }
    });
  });
});
