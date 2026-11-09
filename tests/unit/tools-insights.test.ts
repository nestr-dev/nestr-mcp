import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { handleToolCall, toolDefinitions, READONLY_TOOL_NAMES } from "../../src/tools/index.js";
import { NestrClient } from "../../src/api/client.js";

function mockResponse(status: number, body: unknown) {
  return {
    ok: status < 400,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

const BASE = "https://api.test.io/api";
const META = {
  period: { from: "2026-09-01T00:00:00.000Z", to: "2026-09-30T00:00:00.000Z" },
  comparePeriod: { from: "2026-08-03T00:00:00.000Z", to: "2026-09-01T00:00:00.000Z" },
};

describe("insights tools", () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  let client: NestrClient;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    client = new NestrClient({ apiKey: "test-token", baseUrl: BASE });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const params = () => Object.fromEntries(new URL(mockFetch.mock.calls[0][0]).searchParams);

  it("nestr_get_insights passes from/to and keeps the period meta", async () => {
    mockFetch.mockResolvedValue(mockResponse(200, { status: "success", meta: META, data: [] }));
    const result = await handleToolCall(client, "nestr_get_insights", {
      workspaceId: "ws1", from: "2026-09-01", to: "2026-09-30", userId: "me",
    });
    expect(result.isError).toBeFalsy();
    expect(params()).toEqual({ from: "2026-09-01", to: "2026-09-30", userId: "me" });
    expect(result.content[0].text).toContain("comparePeriod");
  });

  it("nestr_get_insight passes from/to", async () => {
    mockFetch.mockResolvedValue(mockResponse(200, { status: "success", meta: META, data: {} }));
    await handleToolCall(client, "nestr_get_insight", { workspaceId: "ws1", metricId: "projects_new", from: "2026-09-01" });
    expect(new URL(mockFetch.mock.calls[0][0]).pathname).toBe("/api/workspaces/ws1/insights/projects_new");
    expect(params()).toEqual({ from: "2026-09-01" });
  });

  it("nestr_get_insight_history passes nestId and userId", async () => {
    mockFetch.mockResolvedValue(mockResponse(200, { status: "success", data: [] }));
    await handleToolCall(client, "nestr_get_insight_history", {
      workspaceId: "ws1", metricId: "projects_open", nestId: "c1", limit: 5,
    });
    expect(params()).toEqual({ nestId: "c1", limit: "5" });
  });

  it("nestr_compare_insight_circles GETs the circles route, read-only", async () => {
    expect(READONLY_TOOL_NAMES.has("nestr_compare_insight_circles")).toBe(true);
    mockFetch.mockResolvedValue(mockResponse(200, { status: "success", meta: META, data: [{ nestId: "c1", value: 7 }] }));
    const result = await handleToolCall(client, "nestr_compare_insight_circles", {
      workspaceId: "ws1", metricId: "projects_new", parentNestId: "p1", includeSubCircles: false,
    });
    expect(result.isError).toBeFalsy();
    expect(new URL(mockFetch.mock.calls[0][0]).pathname).toBe("/api/workspaces/ws1/insights/projects_new/circles");
    expect(params()).toEqual({ parentNestId: "p1", includeSubCircles: "false" });
  });

  it("tells the agent to quote both periods", () => {
    ["nestr_get_insights", "nestr_get_insight", "nestr_compare_insight_circles"].forEach((name) => {
      const tool = toolDefinitions.find((t) => t.name === name);
      expect(tool?.description, name).toContain("meta.comparePeriod");
    });
  });

  it("reports a 402 as PLAN_REQUIRED with the server's message", async () => {
    mockFetch.mockResolvedValue(mockResponse(402, {
      status: "error", message: "Comparing circles side by side is part of the Pro plan.",
    }));
    const result = await handleToolCall(client, "nestr_compare_insight_circles", { workspaceId: "ws1", metricId: "m" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("PLAN_REQUIRED");
    expect(result.content[0].text).toContain("part of the Pro plan");
  });

  it("passes what Pro adds from a 402 through to the hint", async () => {
    mockFetch.mockResolvedValue(mockResponse(402, {
      status: "error",
      message: "Comparing circles side by side is part of the Pro plan.",
      upgrade: {
        requiredPlan: "plan_pro",
        requested: "compare_circles",
        proAdds: [
          { id: "circle", title: "Insights for one circle", how: "nestId=<circleId>" },
          { id: "personal", title: "Personal insights for the person asking", how: "userId=me" },
        ],
      },
    }));
    const result = await handleToolCall(client, "nestr_compare_insight_circles", { workspaceId: "ws1", metricId: "m" });
    const text = result.content[0].text;
    expect(text).toContain("Insights for one circle (nestId=<circleId>)");
    expect(text).toContain("userId=me");
    expect(text).toContain("offer what Pro adds");
  });
});
