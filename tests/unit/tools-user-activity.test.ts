import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { handleToolCall } from "../../src/tools/index.js";
import { NestrClient } from "../../src/api/client.js";

function mockResponse(status: number, body: unknown) {
  return {
    ok: status < 400,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function parseResult(text: string): Record<string, unknown> {
  return JSON.parse(text);
}

const SAMPLE_ACTIVITY = [
  {
    date: "2026-07-16T10:00:00.000Z",
    workspaceId: "ws-1",
    nestId: "nest-1",
    nestTitle: "Marketing",
    type: "comment",
    description: "Commented on Marketing",
  },
  {
    date: "2026-07-15T09:00:00.000Z",
    workspaceId: "ws-1",
    nestId: "nest-2",
    nestTitle: "Ops",
    type: "consideration",
    summary: "2 considerations during a direct message",
    tools: [],
    outcome: "answered",
    considerationCount: 2,
    dm: true,
    redacted: true,
  },
];

describe("another user's activity", () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  let client: NestrClient;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    client = new NestrClient({ apiKey: "test-token", baseUrl: "https://api.test.io/api" });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ─── nestr_user_activity ────────────────────────────────────────

  it("nestr_user_activity GETs /users/:userId/activity and returns the activity list", async () => {
    mockFetch.mockResolvedValue(
      mockResponse(200, { status: "success", data: { activity: SAMPLE_ACTIVITY } })
    );

    const result = await handleToolCall(client, "nestr_user_activity", { userId: "user-42" });
    expect(result.isError).toBeFalsy();

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.test.io/api/users/user-42/activity");
    expect(opts.method ?? "GET").toBe("GET");

    const parsed = parseResult((result.content[0] as { type: "text"; text: string }).text);
    expect(parsed.count).toBe(2);
    expect(Array.isArray(parsed.activity)).toBe(true);
    expect((parsed.activity as unknown[]).length).toBe(2);
    const first = (parsed.activity as Array<Record<string, unknown>>)[0];
    expect(first.type).toBe("comment");
    expect(first.nestTitle).toBe("Marketing");
  });

  it("nestr_user_activity passes limit as a query param (no withUser warp for other users)", async () => {
    mockFetch.mockResolvedValue(
      mockResponse(200, { status: "success", data: { activity: [] } })
    );

    await handleToolCall(client, "nestr_user_activity", { userId: "user-42", limit: 25 });

    const [url] = mockFetch.mock.calls[0];
    const parsed = new URL(url);
    expect(parsed.pathname).toBe("/api/users/user-42/activity");
    expect(parsed.searchParams.get("limit")).toBe("25");
    expect(parsed.searchParams.get("withUser")).toBeNull();
  });

  it("nestr_user_activity requires userId", async () => {
    const result = await handleToolCall(client, "nestr_user_activity", {});
    expect(result.isError).toBe(true);
    const parsed = parseResult((result.content[0] as { type: "text"; text: string }).text);
    expect(parsed.code).toBe("VALIDATION");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("nestr_user_activity rejects a non-numeric limit", async () => {
    const result = await handleToolCall(client, "nestr_user_activity", { userId: "user-42", limit: "lots" });
    expect(result.isError).toBe(true);
    const parsed = parseResult((result.content[0] as { type: "text"; text: string }).text);
    expect(parsed.code).toBe("VALIDATION");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("nestr_user_activity surfaces a 401 as AUTH_TOKEN_REJECTED_BY_NESTR", async () => {
    mockFetch.mockResolvedValue(mockResponse(401, { message: "Unauthorized" }));
    const result = await handleToolCall(client, "nestr_user_activity", { userId: "user-42" });
    expect(result.isError).toBe(true);
    const parsed = parseResult((result.content[0] as { type: "text"; text: string }).text);
    expect(parsed.code).toBe("AUTH_TOKEN_REJECTED_BY_NESTR");
  });

  // ─── client method ──────────────────────────────────────────────

  it("getUserActivity unwraps { status, data: { activity } }", async () => {
    mockFetch.mockResolvedValue(
      mockResponse(200, { status: "success", data: { activity: SAMPLE_ACTIVITY } })
    );
    const activity = await client.getUserActivity("user-42");
    expect(activity).toEqual(SAMPLE_ACTIVITY);
  });

  it("getUserActivity builds the path from userId and the query string from limit", async () => {
    mockFetch.mockResolvedValue(
      mockResponse(200, { status: "success", data: { activity: [] } })
    );
    await client.getUserActivity("user-7", { limit: 200 });
    const [url] = mockFetch.mock.calls[0];
    const parsed = new URL(url);
    expect(parsed.pathname).toBe("/api/users/user-7/activity");
    expect(parsed.searchParams.get("limit")).toBe("200");
  });
});
