import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { handleToolCall, toolDefinitions } from "../../src/tools/index.js";
import { NestrClient } from "../../src/api/client.js";

// A due date, once set, could not be removed through the MCP: `due` was a plain
// string, so `due: null` failed validation before any request was made, and the
// date could only be cleared in the app. start and allDay already took null.
// This pins what the MCP sends; the server clears the date on null.
describe("nestr_update_nest clears due with null", () => {
  let client: NestrClient;
  let sentBody: Record<string, unknown>;

  beforeEach(() => {
    sentBody = {};
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: { body?: string }) => {
      sentBody = JSON.parse(init?.body || "{}");
      const body = { status: "success", data: { _id: "n1", title: "Deadline test", due: null } };
      return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
    }));
    client = new NestrClient({ apiKey: "t", baseUrl: "https://api.test.io/api" });
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("sends due: null rather than refusing it", async () => {
    const result = await handleToolCall(client, "nestr_update_nest", { nestId: "n1", due: null });
    expect(result.isError).toBeFalsy();
    // null and absent are different requests: absent leaves the date alone.
    expect("due" in sentBody).toBe(true);
    expect(sentBody.due).toBeNull();
  });

  // Inline accountabilities route update_nest to the role/circle endpoint, a
  // separate request built from its own field list.
  it("sends due: null on the role path too", async () => {
    const result = await handleToolCall(client, "nestr_update_nest", {
      nestId: "n1", workspaceId: "ws-1", accountabilities: ["Keep notes"], due: null,
    });
    expect(result.isError).toBeFalsy();
    expect("due" in sentBody).toBe(true);
    expect(sentBody.due).toBeNull();
  });

  it("sends due: null from nestr_update_occurrence", async () => {
    const result = await handleToolCall(client, "nestr_update_occurrence", {
      nestId: "n1", instant: "2026-09-01T09:00:00.000Z", due: null,
    });
    expect(result.isError).toBeFalsy();
    expect("due" in sentBody).toBe(true);
    expect(sentBody.due).toBeNull();
  });

  it("leaves due out when it is not passed", async () => {
    await handleToolCall(client, "nestr_update_nest", { nestId: "n1", title: "Renamed" });
    expect("due" in sentBody).toBe(false);
  });

  it("advertises due as nullable and says null clears it", () => {
    const tool = toolDefinitions.find((t) => { return t.name === "nestr_update_nest"; });
    const due = (tool?.inputSchema.properties as Record<string, { type?: unknown; description?: string }>).due;
    expect(due.type).toEqual(["string", "null"]);
    expect(due.description).toMatch(/null clears/i);
  });
});
