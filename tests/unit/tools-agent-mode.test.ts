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

  it("nestr_set_agent_mode sends an RRULE with its start and time zone", async () => {
    mockFetch.mockResolvedValue(mockResponse(200, {
      status: "success",
      data: {
        agentUserId: "bot-1",
        nestId: "role-7",
        mode: "autonomous",
        recheck: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
        start: "2026-10-12T07:00:00.000Z",
        tzid: "Europe/Amsterdam",
        nextRunAt: "2026-10-13T07:00:00.000Z",
      },
    }));

    const result = await handleToolCall(client, "nestr_set_agent_mode", {
      nestId: "role-7",
      agentUserId: "bot-1",
      mode: "autonomous",
      recheck: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
      start: "2026-10-12T09:00:00+02:00",
      tzid: "Europe/Amsterdam",
    });
    expect(result.isError).toBeFalsy();

    const [, opts] = mockFetch.mock.calls[0];
    expect(JSON.parse(opts.body)).toEqual({
      mode: "autonomous",
      recheck: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
      start: "2026-10-12T09:00:00+02:00",
      tzid: "Europe/Amsterdam",
    });
    expect(parseResult(result.content[0].text).nextRunAt).toBe("2026-10-13T07:00:00.000Z");
  });

  it("nestr_set_agent_mode still accepts the shorthand words and sends no empty anchor", async () => {
    mockFetch.mockResolvedValue(mockResponse(200, {
      status: "success",
      data: { agentUserId: "bot-1", nestId: "proj-3", mode: "autonomous", recheck: "FREQ=DAILY;INTERVAL=1" },
    }));

    await handleToolCall(client, "nestr_set_agent_mode", {
      nestId: "proj-3", agentUserId: "bot-1", mode: "autonomous", recheck: "daily",
    });
    const [, opts] = mockFetch.mock.calls[0];
    expect(JSON.parse(opts.body)).toEqual({ mode: "autonomous", recheck: "daily" });
  });

  it("nestr_set_agent_mode drops start and tzid on reactive", async () => {
    mockFetch.mockResolvedValue(mockResponse(200, {
      status: "success",
      data: { agentUserId: "bot-1", nestId: "proj-3", mode: "reactive", recheck: null },
    }));

    await handleToolCall(client, "nestr_set_agent_mode", {
      nestId: "proj-3", agentUserId: "bot-1", mode: "reactive", start: "2026-10-12T09:00:00Z", tzid: "UTC",
    });
    const [, opts] = mockFetch.mock.calls[0];
    expect(JSON.parse(opts.body)).toEqual({ mode: "reactive" });
  });

  it("nestr_get_agent_mode passes the schedule fields through", async () => {
    const mode = {
      agentUserId: "bot-1",
      nestId: "role-7",
      mode: "autonomous",
      recheck: "FREQ=DAILY;INTERVAL=1",
      start: "2026-10-12T07:00:00.000Z",
      tzid: "Europe/Amsterdam",
      nextRunAt: "2026-10-13T07:00:00.000Z",
      source: "own",
    };
    mockFetch.mockResolvedValue(mockResponse(200, { status: "success", data: mode }));
    const result = await handleToolCall(client, "nestr_get_agent_mode", {
      nestId: "role-7", agentUserId: "bot-1",
    });
    expect(parseResult(result.content[0].text)).toEqual(mode);
  });

  it("the set description tells the model where the time of day goes", () => {
    const def = toolDefinitions.find((t) => t.name === "nestr_set_agent_mode");
    expect(def?.description).toContain("RRULE");
    expect(def?.description).toContain("BYHOUR");
    const props = (def?.inputSchema as { properties: Record<string, unknown> }).properties;
    expect(props.start).toBeDefined();
    expect(props.tzid).toBeDefined();
    expect((props.start as { description: string }).description).toContain("no offset");
    expect((props.recheck as { enum?: unknown }).enum).toBeUndefined();
  });
});
