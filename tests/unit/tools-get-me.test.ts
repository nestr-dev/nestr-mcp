import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { handleToolCall } from "../../src/tools/index.js";
import { NestrClient, NestrApiError } from "../../src/api/client.js";

describe("nestr_get_me error handling", () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  let client: NestrClient;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    client = new NestrClient({
      apiKey: "test-token",
      baseUrl: "https://api.test.io/api",
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function mockResponse(status: number, body: unknown, ok = status < 400) {
    return {
      ok,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  }

  function parseResult(text: string): Record<string, unknown> {
    return JSON.parse(text);
  }

  it("returns workspace mode when /users/me 403s and listWorkspaces succeeds (valid workspace API key)", async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes("/users/me")) {
        return mockResponse(403, {
          status: "error",
          message: "You can only access your own user data on a single user scoped api key",
        });
      }
      if (url.includes("/workspaces")) {
        return mockResponse(200, [{ _id: "ws-1", title: "Test Workspace" }]);
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const result = await handleToolCall(client, "nestr_get_me", { fullWorkspaces: true });
    expect(result.isError).toBeFalsy();
    const parsed = parseResult(result.content[0].text);
    expect(parsed).toMatchObject({
      authMode: "api-key",
      user: null,
      mode: "workspace",
    });
  });

  it("propagates 401 from /users/me without falling back to workspace mode", async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes("/users/me")) {
        return mockResponse(401, { message: "You must be logged in to do this." });
      }
      throw new Error(`Should not call other endpoints: ${url}`);
    });

    const result = await handleToolCall(client, "nestr_get_me", {});
    expect(result.isError).toBe(true);
    const parsed = parseResult(result.content[0].text);
    expect(parsed).toMatchObject({
      error: true,
      code: "AUTH_FAILED",
      status: 401,
    });
  });

  it("propagates auth failure when listWorkspaces also rejects (not really authorized)", async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes("/users/me")) {
        return mockResponse(403, { message: "Forbidden" });
      }
      if (url.includes("/workspaces")) {
        return mockResponse(401, { message: "You must be logged in to do this." });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const result = await handleToolCall(client, "nestr_get_me", {});
    expect(result.isError).toBe(true);
    const parsed = parseResult(result.content[0].text);
    expect(parsed).toMatchObject({
      error: true,
      code: "AUTH_FAILED",
    });
  });

  it("treats transient verification failures as workspace mode (5xx on listWorkspaces)", async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes("/users/me")) {
        return mockResponse(403, { message: "Forbidden" });
      }
      if (url.includes("/workspaces")) {
        return mockResponse(503, { message: "Service unavailable" });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const result = await handleToolCall(client, "nestr_get_me", {});
    expect(result.isError).toBeFalsy();
    const parsed = parseResult(result.content[0].text);
    expect(parsed).toMatchObject({
      authMode: "api-key",
      mode: "workspace",
    });
  });

  it("propagates server errors instead of masking them as workspace mode", async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes("/users/me")) {
        return mockResponse(500, { message: "Internal server error" });
      }
      throw new Error(`Should not call other endpoints: ${url}`);
    });

    const result = await handleToolCall(client, "nestr_get_me", {});
    expect(result.isError).toBe(true);
    const parsed = parseResult(result.content[0].text);
    expect(parsed.code).toBe("SERVER_ERROR");
  });

  it("returns OAuth/assistant mode when /users/me succeeds for a real user", async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes("/users/me")) {
        return mockResponse(200, {
          _id: "user-1",
          username: "alice",
          profile: { fullName: "Alice" },
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const result = await handleToolCall(client, "nestr_get_me", {});
    expect(result.isError).toBeFalsy();
    const parsed = parseResult(result.content[0].text);
    expect(parsed).toMatchObject({
      authMode: "oauth",
      mode: "assistant",
    });
    expect((parsed.user as { _id: string })._id).toBe("user-1");
  });
});
