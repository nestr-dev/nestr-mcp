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

describe("dataseries tools", () => {
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

  it("registers the reads as read-only and the writes as writes", () => {
    const names = ["nestr_list_series", "nestr_get_series_points", "nestr_add_series_points",
      "nestr_update_series_point", "nestr_delete_series_point"];
    names.forEach((name) => {
      expect(toolDefinitions.find((t) => t.name === name), name).toBeDefined();
    });
    expect(READONLY_TOOL_NAMES.has("nestr_list_series")).toBe(true);
    expect(READONLY_TOOL_NAMES.has("nestr_get_series_points")).toBe(true);
    expect(READONLY_TOOL_NAMES.has("nestr_add_series_points")).toBe(false);
    expect(READONLY_TOOL_NAMES.has("nestr_update_series_point")).toBe(false);
    expect(READONLY_TOOL_NAMES.has("nestr_delete_series_point")).toBe(false);
  });

  it("nestr_list_series GETs /nests/:id/series", async () => {
    mockFetch.mockResolvedValue(mockResponse(200, { status: "success", data: [{ key: "metric-data" }] }));
    const result = await handleToolCall(client, "nestr_list_series", { nestId: "n1" });
    expect(result.isError).toBeFalsy();
    expect(mockFetch.mock.calls[0][0]).toBe(`${BASE}/nests/n1/series`);
    expect(result.content[0].text).toContain("metric-data");
  });

  it("nestr_get_series_points passes the range and keeps meta.has_more", async () => {
    mockFetch.mockResolvedValue(mockResponse(200, {
      status: "success", meta: { count: 1, has_more: true }, data: [{ id: "p1", date: "2026-01-05T00:00:00.000Z", value: 3 }],
    }));
    const result = await handleToolCall(client, "nestr_get_series_points", {
      nestId: "n1", series: "metric-data", from: "2026-01-01", to: "2026-02-01", limit: 10, order: "desc",
    });
    expect(result.isError).toBeFalsy();
    const url = new URL(mockFetch.mock.calls[0][0]);
    expect(url.pathname).toBe("/api/nests/n1/series/metric-data/points");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      from: "2026-01-01", to: "2026-02-01", limit: "10", order: "desc",
    });
    expect(result.content[0].text).toContain("has_more");
  });

  it("a multi-series field carries the series id in the path", async () => {
    mockFetch.mockResolvedValue(mockResponse(200, { status: "success", data: [] }));
    await handleToolCall(client, "nestr_get_series_points", { nestId: "n1", series: "burndown", seriesId: "total" });
    expect(new URL(mockFetch.mock.calls[0][0]).pathname).toBe("/api/nests/n1/series/burndown/total/points");
  });

  it("nestr_add_series_points POSTs the points as an array and returns the per-item results", async () => {
    mockFetch.mockResolvedValue(mockResponse(200, {
      status: "success", meta: { created: 1, failed: 1 }, data: [{ index: 0, status: "created" }, { index: 1, status: "error" }],
    }));
    const points = [{ date: "2026-01-05", value: 3 }, { date: "2026-01-12", value: 4 }];
    const result = await handleToolCall(client, "nestr_add_series_points", { nestId: "n1", series: "metric-data", points });
    expect(result.isError).toBeFalsy();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe(`${BASE}/nests/n1/series/metric-data/points`);
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body)).toEqual(points);
    expect(result.content[0].text).toContain("\"failed\": 1");
  });

  it("nestr_add_series_points accepts points sent as a JSON string, as some clients send arrays", async () => {
    mockFetch.mockResolvedValue(mockResponse(200, { status: "success", meta: { created: 1, failed: 0 }, data: [] }));
    const points = [{ date: "2026-01-05", value: 3 }];
    const result = await handleToolCall(client, "nestr_add_series_points", {
      nestId: "n1", series: "metric-data", points: JSON.stringify(points),
    });
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual(points);
  });

  it("nestr_get_series_points accepts from/to as epoch milliseconds", async () => {
    mockFetch.mockResolvedValue(mockResponse(200, { status: "success", data: [] }));
    const result = await handleToolCall(client, "nestr_get_series_points", {
      nestId: "n1", series: "metric-data", from: 1767225600000, to: 1769904000000,
    });
    expect(result.isError).toBeFalsy();
    const url = new URL(mockFetch.mock.calls[0][0]);
    expect(url.searchParams.get("from")).toBe("1767225600000");
    expect(url.searchParams.get("to")).toBe("1769904000000");
  });

  it("nestr_update_series_point PATCHes only what is given", async () => {
    mockFetch.mockResolvedValue(mockResponse(200, { status: "success", data: { id: "p1", value: 9 } }));
    await handleToolCall(client, "nestr_update_series_point", {
      nestId: "n1", series: "metric-data", pointId: "p1", value: 9,
    });
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe(`${BASE}/nests/n1/series/metric-data/points/p1`);
    expect(opts.method).toBe("PATCH");
    expect(JSON.parse(opts.body)).toEqual({ value: 9 });
  });

  it("nestr_update_series_point refuses a call that changes nothing", async () => {
    const result = await handleToolCall(client, "nestr_update_series_point", {
      nestId: "n1", series: "metric-data", pointId: "p1",
    });
    expect(result.isError).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("nestr_delete_series_point DELETEs the point", async () => {
    mockFetch.mockResolvedValue(mockResponse(200, { status: "success", data: { id: "p1" } }));
    await handleToolCall(client, "nestr_delete_series_point", { nestId: "n1", series: "metric-data", pointId: "p1" });
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe(`${BASE}/nests/n1/series/metric-data/points/p1`);
    expect(opts.method).toBe("DELETE");
  });

  it("nestr_get_insight_history says nest dataseries live under the series tools", () => {
    const tool = toolDefinitions.find((t) => t.name === "nestr_get_insight_history");
    expect(tool!.description).toContain("nestr_list_series");
  });
});
