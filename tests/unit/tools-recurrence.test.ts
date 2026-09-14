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

describe("nestr_set_recurrence", () => {
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

  // ─── registration ───────────────────────────────────────────────

  it("registers with nestId and rrule (both required) in its input schema", () => {
    const tool = toolDefinitions.find((t) => t.name === "nestr_set_recurrence");
    expect(tool).toBeDefined();
    expect(Object.keys(tool!.inputSchema.properties ?? {})).toEqual(
      expect.arrayContaining(["nestId", "rrule"])
    );
    expect(tool!.inputSchema.required).toEqual(["nestId", "rrule"]);
  });

  // ─── set (rrule string) ─────────────────────────────────────────

  it("nestr_set_recurrence PATCHes /nests/:id/recurrence with the rrule and unwraps data", async () => {
    mockFetch.mockResolvedValue(
      mockResponse(200, { status: "success", data: { rrule: "FREQ=DAILY;COUNT=15" } })
    );

    const result = await handleToolCall(client, "nestr_set_recurrence", {
      nestId: "nest-1",
      rrule: "FREQ=DAILY;COUNT=15",
    });
    expect(result.isError).toBeFalsy();

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.test.io/api/nests/nest-1/recurrence");
    expect(opts.method).toBe("PATCH");
    expect(JSON.parse(opts.body)).toEqual({ rrule: "FREQ=DAILY;COUNT=15" });

    const parsed = parseResult(result.content[0].text);
    // The server creates no occurrence nests, so the message must not claim a
    // count. It said "10 instance(s) materialized" only because the mock invented
    // a `generated` field the API never returns.
    expect(parsed.message).toMatch(/Occurrences stay virtual/);
    expect(parsed.message).not.toMatch(/instance\(s\) materialized/);
    expect(parsed.recurrence).toEqual({ rrule: "FREQ=DAILY;COUNT=15" });
  });

  // ─── remove (rrule null) ────────────────────────────────────────

  it("nestr_set_recurrence passes rrule: null through to remove recurrence", async () => {
    mockFetch.mockResolvedValue(mockResponse(200, { status: "success", data: { removed: true } }));

    const result = await handleToolCall(client, "nestr_set_recurrence", {
      nestId: "nest-1",
      rrule: null,
    });
    expect(result.isError).toBeFalsy();

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.test.io/api/nests/nest-1/recurrence");
    expect(opts.method).toBe("PATCH");
    expect(JSON.parse(opts.body)).toEqual({ rrule: null });

    const parsed = parseResult(result.content[0].text);
    expect(parsed.message).toMatch(/removed/i);
    expect(parsed.recurrence).toEqual({ removed: true });
  });

  // ─── validation ─────────────────────────────────────────────────

  it("nestr_set_recurrence requires nestId", async () => {
    const result = await handleToolCall(client, "nestr_set_recurrence", { rrule: "FREQ=DAILY" });
    expect(result.isError).toBe(true);
    const parsed = parseResult(result.content[0].text);
    expect(parsed.code).toBe("VALIDATION");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("nestr_set_recurrence requires rrule to be present (explicit null is fine, omitting is not)", async () => {
    const result = await handleToolCall(client, "nestr_set_recurrence", { nestId: "nest-1" });
    expect(result.isError).toBe(true);
    const parsed = parseResult(result.content[0].text);
    expect(parsed.code).toBe("VALIDATION");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("nestr_set_recurrence rejects a non-string, non-null rrule", async () => {
    const result = await handleToolCall(client, "nestr_set_recurrence", {
      nestId: "nest-1",
      rrule: 42,
    });
    expect(result.isError).toBe(true);
    const parsed = parseResult(result.content[0].text);
    expect(parsed.code).toBe("VALIDATION");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // ─── invalid-rule error surfaced cleanly ────────────────────────

  it("nestr_set_recurrence surfaces a malformed-RRULE server error as a clean message, no stack", async () => {
    mockFetch.mockResolvedValue(
      mockResponse(422, { status: "error", message: "recurrence-invalid: Invalid RRULE string" })
    );

    const result = await handleToolCall(client, "nestr_set_recurrence", {
      nestId: "nest-1",
      rrule: "NOTANRRULE",
    });
    expect(result.isError).toBe(true);

    const parsed = parseResult(result.content[0].text);
    expect(parsed.error).toBe(true);
    expect(parsed.code).toBe("VALIDATION");
    expect(parsed.message).toMatch(/recurrence-invalid/);
    expect(parsed.status).toBe(422);
    // Clean structured error, not a raw thrown Error/stack leaking through.
    expect("stack" in parsed).toBe(false);
  });

  // ─── client method ──────────────────────────────────────────────

  it("client.setRecurrence unwraps { status, data } for both the set and remove shapes", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse(200, { status: "success", data: { rrule: "FREQ=WEEKLY;COUNT=3" } })
    );
    const setResult = await client.setRecurrence("nest-1", "FREQ=WEEKLY;COUNT=3");
    expect(setResult).toEqual({ rrule: "FREQ=WEEKLY;COUNT=3" });

    mockFetch.mockResolvedValueOnce(mockResponse(200, { status: "success", data: { removed: true } }));
    const removeResult = await client.setRecurrence("nest-1", null);
    expect(removeResult).toEqual({ removed: true });
  });
});

describe("nestr_list_occurrences / nestr_skip_occurrence", () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  let client: NestrClient;

  const AT_1 = Date.UTC(2026, 0, 12, 9, 0, 0);
  const AT_2 = Date.UTC(2026, 0, 19, 9, 0, 0);

  const page = {
    seriesId: "series-1",
    series: { _id: "series-1", title: "Weekly sync" },
    allDay: false,
    occurrences: [
      {
        instant: AT_1,
        occurrenceStart: new Date(AT_1).toISOString(),
        start: new Date(AT_1).toISOString(),
        allDay: false,
        title: "Weekly sync",
        completed: false,
        virtual: false,
        nestId: "nest-1",
        virtualId: null,
        excluded: false,
        altered: false,
      },
      {
        instant: AT_2,
        occurrenceStart: new Date(AT_2).toISOString(),
        start: new Date(AT_2).toISOString(),
        allDay: false,
        title: "Weekly sync",
        completed: false,
        virtual: true,
        nestId: null,
        virtualId: "aBcDeFgHjKmNpQrSt",
        excluded: false,
        altered: false,
      },
    ],
    hasMore: true,
    nextCursor: new Date(AT_2).toISOString(),
    nextCursorMs: AT_2,
  };

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    client = new NestrClient({ apiKey: "test-token", baseUrl: "https://api.test.io/api" });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ─── registration ───────────────────────────────────────────────

  it("registers nestr_list_occurrences as a read, with only nestId required", () => {
    const tool = toolDefinitions.find((t) => t.name === "nestr_list_occurrences");
    expect(tool).toBeDefined();
    expect(Object.keys(tool!.inputSchema.properties ?? {})).toEqual(
      expect.arrayContaining(["nestId", "direction", "cursor", "limit"])
    );
    expect(tool!.inputSchema.required).toEqual(["nestId"]);
    expect((tool as { annotations?: { readOnlyHint?: boolean } }).annotations?.readOnlyHint).toBe(true);
  });

  it("registers nestr_skip_occurrence as a destructive write taking nestId and instant", () => {
    const tool = toolDefinitions.find((t) => t.name === "nestr_skip_occurrence");
    expect(tool).toBeDefined();
    expect(tool!.inputSchema.required).toEqual(["nestId", "instant"]);
    const annotations = (tool as { annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean } }).annotations;
    expect(annotations?.readOnlyHint).toBe(false);
    expect(annotations?.destructiveHint).toBe(true);
  });

  // The description is what an agent reads to decide, and the failure this tool
  // exists for is an agent bounding the series with a COUNT and creating a second
  // one after the gap. Saying so is load-bearing, not decoration.
  it("tells an agent in the skip description that the series survives and that splitting is not the same thing", () => {
    const tool = toolDefinitions.find((t) => t.name === "nestr_skip_occurrence");
    expect(tool!.description).toMatch(/does NOT end the series/i);
    expect(tool!.description).toMatch(/COUNT/);
    expect(tool!.description).toMatch(/not the same/i);
  });

  it("tells an agent in the listing description that virtual occurrences are invisible to search", () => {
    const tool = toolDefinitions.find((t) => t.name === "nestr_list_occurrences");
    expect(tool!.description).toMatch(/nestr_search/);
    expect(tool!.description).toMatch(/virtual/i);
  });

  // ─── listing ────────────────────────────────────────────────────

  it("nestr_list_occurrences GETs /nests/:id/recurrence and returns the union", async () => {
    mockFetch.mockResolvedValue(mockResponse(200, { status: "success", data: page }));

    const result = await handleToolCall(client, "nestr_list_occurrences", { nestId: "series-1" });
    expect(result.isError).toBeFalsy();

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.test.io/api/nests/series-1/recurrence");
    expect(opts?.method ?? "GET").toBe("GET");

    const parsed = parseResult(result.content[0].text);
    const occurrences = parsed.occurrences as Array<Record<string, unknown>>;
    expect(occurrences).toHaveLength(2);
    expect(occurrences[0].nestId).toBe("nest-1");
    expect(occurrences[0].virtual).toBe(false);
    expect(occurrences[1].virtual).toBe(true);
    expect(occurrences[1].instant).toBe(AT_2);
    // An agent that reports a count must report the page's, not the series'.
    expect(parsed.message).toMatch(/1 of them virtual/);
    expect(parsed.hasMore).toBe(true);
  });

  it("nestr_list_occurrences forwards direction, cursor and limit as query parameters", async () => {
    mockFetch.mockResolvedValue(mockResponse(200, { status: "success", data: page }));

    await handleToolCall(client, "nestr_list_occurrences", {
      nestId: "series-1",
      direction: "past",
      cursor: AT_2,
      limit: 25,
    });

    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe(
      `https://api.test.io/api/nests/series-1/recurrence?direction=past&cursor=${AT_2}&limit=25`
    );
  });

  // The empty answer a nest with no rule gets. Reporting it as an empty list with
  // no explanation reads as "the series has no occurrences", which is a different
  // and wrong statement.
  it("nestr_list_occurrences says the nest has no rule rather than returning a bare empty list", async () => {
    mockFetch.mockResolvedValue(
      mockResponse(200, {
        status: "success",
        data: {
          seriesId: null, series: null, allDay: false, occurrences: [],
          hasMore: false, nextCursor: null, nextCursorMs: null,
        },
      })
    );

    const result = await handleToolCall(client, "nestr_list_occurrences", { nestId: "plain-nest" });
    const parsed = parseResult(result.content[0].text);
    expect(parsed.message).toMatch(/no recurrence rule/i);
    expect(parsed.occurrences).toEqual([]);
  });

  it("nestr_list_occurrences requires nestId and refuses an unknown direction", async () => {
    const missing = await handleToolCall(client, "nestr_list_occurrences", {});
    expect(missing.isError).toBe(true);
    expect(parseResult(missing.content[0].text).code).toBe("VALIDATION");

    const sideways = await handleToolCall(client, "nestr_list_occurrences", {
      nestId: "series-1",
      direction: "sideways",
    });
    expect(sideways.isError).toBe(true);
    expect(parseResult(sideways.content[0].text).code).toBe("VALIDATION");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // ─── skipping ───────────────────────────────────────────────────

  it("nestr_skip_occurrence DELETEs the instant and says the series survives", async () => {
    mockFetch.mockResolvedValue(
      mockResponse(200, {
        status: "success",
        data: { excluded: true, seriesId: "series-1", instant: AT_2 },
      })
    );

    const result = await handleToolCall(client, "nestr_skip_occurrence", {
      nestId: "series-1",
      instant: AT_2,
    });
    expect(result.isError).toBeFalsy();

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe(`https://api.test.io/api/nests/series-1/recurrence/${AT_2}`);
    expect(opts.method).toBe("DELETE");

    const parsed = parseResult(result.content[0].text);
    expect(parsed.message).toMatch(/2026-01-19T09:00:00.000Z/);
    expect(parsed.message).toMatch(/series continues/i);
    expect(parsed.occurrence).toEqual({ excluded: true, seriesId: "series-1", instant: AT_2 });
  });

  it("nestr_skip_occurrence converts an ISO-8601 instant to the epoch milliseconds the route takes", async () => {
    mockFetch.mockResolvedValue(
      mockResponse(200, {
        status: "success",
        data: { excluded: true, seriesId: "series-1", instant: AT_2 },
      })
    );

    await handleToolCall(client, "nestr_skip_occurrence", {
      nestId: "series-1",
      instant: "2026-01-19T09:00:00.000Z",
    });

    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe(`https://api.test.io/api/nests/series-1/recurrence/${AT_2}`);
  });

  it("nestr_skip_occurrence refuses an instant it cannot read, without calling the API", async () => {
    for (const instant of [undefined, "next tuesday", ""]) {
      const result = await handleToolCall(client, "nestr_skip_occurrence", {
        nestId: "series-1",
        ...(instant === undefined ? {} : { instant }),
      });
      expect(result.isError).toBe(true);
      expect(parseResult(result.content[0].text).code).toBe("VALIDATION");
    }
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // The hazard the route's guard exists for, seen from this side: an instant the
  // rule does not produce is refused rather than silently excluding nothing, and
  // the refusal has to reach the agent as a clean, actionable message.
  it("nestr_skip_occurrence surfaces a refused instant as a clean validation error, no stack", async () => {
    mockFetch.mockResolvedValue(
      mockResponse(422, {
        status: "error",
        message: "This series has no occurrence at 2026-01-19T09:00:01.000Z (1768813201000)."
          + " Read GET nests/:id/recurrence and use one of the instants it lists.",
      })
    );

    const result = await handleToolCall(client, "nestr_skip_occurrence", {
      nestId: "series-1",
      instant: AT_2 + 1000,
    });
    expect(result.isError).toBe(true);

    const parsed = parseResult(result.content[0].text);
    expect(parsed.error).toBe(true);
    expect(parsed.code).toBe("VALIDATION");
    expect(parsed.message).toMatch(/no occurrence at/);
    expect(parsed.status).toBe(422);
    expect("stack" in parsed).toBe(false);
  });

  it("nestr_list_occurrences surfaces a server error cleanly", async () => {
    mockFetch.mockResolvedValue(
      mockResponse(404, { status: "error", message: "Nest not found" })
    );

    const result = await handleToolCall(client, "nestr_list_occurrences", { nestId: "nope" });
    expect(result.isError).toBe(true);

    const parsed = parseResult(result.content[0].text);
    expect(parsed.code).toBe("NOT_FOUND");
    expect(parsed.message).toMatch(/not found/i);
    expect("stack" in parsed).toBe(false);
  });

  // ─── client methods ─────────────────────────────────────────────

  it("client.listOccurrences and client.skipOccurrence unwrap { status, data }", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(200, { status: "success", data: page }));
    expect(await client.listOccurrences("series-1")).toEqual(page);

    mockFetch.mockResolvedValueOnce(
      mockResponse(200, { status: "success", data: { excluded: true, seriesId: "series-1", instant: AT_2 } })
    );
    expect(await client.skipOccurrence("series-1", AT_2)).toEqual({
      excluded: true, seriesId: "series-1", instant: AT_2,
    });
  });
});
