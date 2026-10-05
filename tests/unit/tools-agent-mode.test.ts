import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { handleToolCall, toolDefinitions } from "../../src/tools/index.js";
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

describe("agent mode tools", () => {
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

  it("nestr_get_agent_mode reads the mode of one agent on one nest", async () => {
    const mode = {
      agentUserId: "bot-1", nestId: "role-7", mode: "autonomous", recheck: "hourly", source: "own",
    };
    mockFetch.mockResolvedValue(mockResponse(200, { status: "success", data: mode }));

    const result = await handleToolCall(client, "nestr_get_agent_mode", {
      nestId: "role-7",
      agentUserId: "bot-1",
    });
    expect(result.isError).toBeFalsy();

    const [url] = mockFetch.mock.calls[0];
    // The nest is in the path: the mode is a setting of an agent on a nest.
    expect(url).toBe("https://api.test.io/api/nests/role-7/agents/bot-1/mode");
    expect(parseResult(result.content[0].text)).toEqual(mode);
  });

  it("nestr_set_agent_mode PUTs the cadence to the nest and keeps the server's hint", async () => {
    const hint = { type: "agent_prefer_scheduled_task", severity: "info", label: "Use a repeating task." };
    mockFetch.mockResolvedValue(mockResponse(200, {
      status: "success",
      data: { agentUserId: "bot-1", nestId: "proj-3", mode: "autonomous", recheck: "hourly" },
      hints: [hint],
    }));

    const result = await handleToolCall(client, "nestr_set_agent_mode", {
      nestId: "proj-3",
      agentUserId: "bot-1",
      mode: "autonomous",
      recheck: "hourly",
    });
    expect(result.isError).toBeFalsy();

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.test.io/api/nests/proj-3/agents/bot-1/mode");
    expect(opts.method).toBe("PUT");
    expect(JSON.parse(opts.body)).toEqual({ mode: "autonomous", recheck: "hourly" });

    const parsed = parseResult(result.content[0].text);
    expect(parsed.recheck).toBe("hourly");
    expect(parsed.hints).toEqual([hint]);
  });

  it("nestr_set_agent_mode sends no cadence with reactive", async () => {
    mockFetch.mockResolvedValue(mockResponse(200, {
      status: "success",
      data: { agentUserId: "bot-1", nestId: "proj-3", mode: "reactive", recheck: null },
    }));

    await handleToolCall(client, "nestr_set_agent_mode", {
      nestId: "proj-3",
      agentUserId: "bot-1",
      mode: "reactive",
      recheck: "weekly",
    });
    const [, opts] = mockFetch.mock.calls[0];
    expect(JSON.parse(opts.body)).toEqual({ mode: "reactive" });
  });

  it("nestr_set_agent_mode passes null through to clear the nest's own setting", async () => {
    mockFetch.mockResolvedValue(mockResponse(200, {
      status: "success",
      data: { agentUserId: "bot-1", nestId: "proj-3", cleared: true },
    }));

    const result = await handleToolCall(client, "nestr_set_agent_mode", {
      nestId: "proj-3",
      agentUserId: "bot-1",
      mode: null,
    });
    expect(result.isError).toBeFalsy();
    const [, opts] = mockFetch.mock.calls[0];
    expect(JSON.parse(opts.body)).toEqual({ mode: null });
    expect(parseResult(result.content[0].text).cleared).toBe(true);
  });

  it("nestr_set_agent_mode refuses autonomous without a cadence before calling the server", async () => {
    const result = await handleToolCall(client, "nestr_set_agent_mode", {
      nestId: "proj-3",
      agentUserId: "bot-1",
      mode: "autonomous",
    });
    expect(result.isError).toBe(true);
    expect(parseResult(result.content[0].text).code).toBe("VALIDATION");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("nestr_set_agent_mode steers a repeating job to a repeating task in its description", () => {
    // The model reads this before it ever calls the tool, so this is where the
    // "weekly report on a weekly cadence" mistake has to be headed off.
    const def = toolDefinitions.find((t) => t.name === "nestr_set_agent_mode");
    expect(def?.description).toContain("nestr_set_recurrence");
    expect(def?.description).toMatch(/per nest|one nest/);
  });
});
