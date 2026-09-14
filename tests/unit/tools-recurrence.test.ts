import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { handleToolCall, toolDefinitions, schemas, READONLY_TOOL_NAMES } from "../../src/tools/index.js";
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

describe("nestr_list_occurrences", () => {
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

  it("client.listOccurrences unwraps { status, data }", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(200, { status: "success", data: page }));
    expect(await client.listOccurrences("series-1")).toEqual(page);
  });
});

describe("occurrence writes: nestr_skip_occurrence, nestr_update_occurrence, nestr_delete_series", () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  let client: NestrClient;

  const AT = Date.UTC(2026, 0, 19, 9, 0, 0);

  type Annotated = { annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean } };
  const tool = (name: string) => {
    const found = toolDefinitions.find((t) => t.name === name);
    if (!found) throw new Error(`no tool named ${name}`);
    return found as (typeof toolDefinitions)[number] & Annotated;
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

  it("registers nestr_skip_occurrence as destructive, taking nestId, instant and an optional scope", () => {
    const skip = tool("nestr_skip_occurrence");
    expect(skip.inputSchema.required).toEqual(["nestId", "instant"]);
    const scope = (skip.inputSchema.properties as Record<string, { enum?: string[] }>).scope;
    expect(scope.enum).toEqual(["occurrence", "following"]);
    expect(skip.annotations?.readOnlyHint).toBe(false);
    expect(skip.annotations?.destructiveHint).toBe(true);
    expect(READONLY_TOOL_NAMES.has("nestr_skip_occurrence")).toBe(false);
  });

  it("registers nestr_update_occurrence as mutating, with every field nestr_update_nest edits", () => {
    const update = tool("nestr_update_occurrence");
    expect(update.inputSchema.required).toEqual(["nestId", "instant"]);
    expect(update.annotations?.readOnlyHint).toBe(false);
    expect(update.annotations?.destructiveHint).toBe(false);
    expect(READONLY_TOOL_NAMES.has("nestr_update_occurrence")).toBe(false);

    const nestFields = Object.keys(tool("nestr_update_nest").inputSchema.properties ?? {})
      .filter((key) => !["nestId", "accountabilities", "domains", "workspaceId"].includes(key));
    const occurrenceProps = update.inputSchema.properties as Record<string, unknown>;
    const nestProps = tool("nestr_update_nest").inputSchema.properties as Record<string, unknown>;
    expect(nestFields.length).toBeGreaterThanOrEqual(10);
    for (const key of nestFields) expect(occurrenceProps[key]).toEqual(nestProps[key]);
    expect(Object.keys(schemas.updateOccurrence.shape).sort()).toEqual(
      ["nestId", "instant", ...nestFields].sort()
    );
  });

  it("registers nestr_delete_series as destructive, taking only nestId", () => {
    const series = tool("nestr_delete_series");
    expect(series.inputSchema.required).toEqual(["nestId"]);
    expect(Object.keys(series.inputSchema.properties ?? {})).toEqual(["nestId"]);
    expect(series.annotations?.readOnlyHint).toBe(false);
    expect(series.annotations?.destructiveHint).toBe(true);
    expect(READONLY_TOOL_NAMES.has("nestr_delete_series")).toBe(false);
  });

  // ─── descriptions ───────────────────────────────────────────────
  // The failure these tools exist for is an agent bounding a series with a COUNT
  // and creating a second one after the gap, or deleting a series nest expecting
  // the series to end. The descriptions are what it reads to decide.

  it("tells an agent the skip never ends the series and that splitting is not the same thing", () => {
    const description = tool("nestr_skip_occurrence").description;
    expect(description).toMatch(/does NOT end the series/);
    expect(description).toMatch(/COUNT/);
    expect(description).toMatch(/not the same/i);
    expect(description).toMatch(/restoreId/);
  });

  it("points nestr_delete_nest at the recurrence tools and says it never ends a series", () => {
    const description = tool("nestr_delete_nest").description;
    expect(description).toMatch(/nestr_skip_occurrence/);
    expect(description).toMatch(/scope 'following'/);
    expect(description).toMatch(/nestr_delete_series/);
    expect(description).toMatch(/never ends the series/);
    expect(description).toMatch(/next occurrence/);
    expect(description).toMatch(/403/);
  });

  it("warns in nestr_set_recurrence against the COUNT-plus-second-series workaround", () => {
    const description = tool("nestr_set_recurrence").description;
    expect(description).toMatch(/COUNT/);
    expect(description).toMatch(/second recurring nest/);
    expect(description).toMatch(/nestr_skip_occurrence/);
  });

  it("says in nestr_list_occurrences what to do with an instant", () => {
    const description = tool("nestr_list_occurrences").description;
    expect(description).toMatch(/nestr_skip_occurrence/);
    expect(description).toMatch(/nestr_update_occurrence/);
    expect(description).toMatch(/nestr_delete_series/);
  });

  it("keeps nestr_update_occurrence and nestr_delete_series pointing at the right neighbours", () => {
    expect(tool("nestr_update_occurrence").description).toMatch(/nestr_set_recurrence/);
    expect(tool("nestr_update_occurrence").description).toMatch(/_id/);
    expect(tool("nestr_update_occurrence").description).toMatch(/Not all-or-nothing/);
    expect(tool("nestr_delete_series").description).toMatch(/rrule: null/);
  });

  it("uses no em dashes in the descriptions this change wrote", () => {
    for (const name of [
      "nestr_skip_occurrence", "nestr_update_occurrence", "nestr_delete_series",
      "nestr_delete_nest", "nestr_set_recurrence", "nestr_list_occurrences",
    ]) {
      expect(tool(name).description, name).not.toMatch(/—/);
    }
  });

  // ─── nestr_skip_occurrence ──────────────────────────────────────

  it("DELETEs /nests/:id/recurrence/:instant with no scope query by default", async () => {
    mockFetch.mockResolvedValue(
      mockResponse(200, { status: "success", data: { excluded: true, seriesId: "series-1", instant: AT } })
    );

    const result = await handleToolCall(client, "nestr_skip_occurrence", { nestId: "series-1", instant: AT });
    expect(result.isError).toBeFalsy();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe(`https://api.test.io/api/nests/series-1/recurrence/${AT}`);
    expect(opts.method).toBe("DELETE");
    expect(opts.body).toBeUndefined();

    const parsed = parseResult(result.content[0].text);
    expect(parsed.message).toMatch(/2026-01-19T09:00:00.000Z/);
    expect(parsed.message).toMatch(/series continues/i);
    expect(parsed.occurrence).toEqual({ excluded: true, seriesId: "series-1", instant: AT });
  });

  it("sends no scope query when scope is 'occurrence' either", async () => {
    mockFetch.mockResolvedValue(
      mockResponse(200, { status: "success", data: { excluded: true, seriesId: "series-1", instant: AT } })
    );
    await handleToolCall(client, "nestr_skip_occurrence", { nestId: "series-1", instant: AT, scope: "occurrence" });
    expect(mockFetch.mock.calls[0][0]).toBe(`https://api.test.io/api/nests/series-1/recurrence/${AT}`);
  });

  it("adds ?scope=following when asked, and names the restoreId that undoes it", async () => {
    mockFetch.mockResolvedValue(
      mockResponse(200, {
        status: "success",
        data: { deleted: true, seriesId: "series-1", instant: AT, restoreId: "future-root" },
      })
    );

    const result = await handleToolCall(client, "nestr_skip_occurrence", {
      nestId: "series-1",
      instant: AT,
      scope: "following",
    });
    expect(result.isError).toBeFalsy();

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe(`https://api.test.io/api/nests/series-1/recurrence/${AT}?scope=following`);
    expect(opts.method).toBe("DELETE");

    const parsed = parseResult(result.content[0].text);
    expect(parsed.message).toMatch(/every later one deleted/);
    expect(parsed.message).toMatch(/future-root/);
    expect(parsed.message).not.toMatch(/series continues/i);
    expect(parsed.occurrence).toEqual({ deleted: true, seriesId: "series-1", instant: AT, restoreId: "future-root" });
  });

  it("converts an ISO-8601 instant to the epoch milliseconds the route takes", async () => {
    mockFetch.mockResolvedValue(
      mockResponse(200, { status: "success", data: { excluded: true, seriesId: "series-1", instant: AT } })
    );
    await handleToolCall(client, "nestr_skip_occurrence", { nestId: "series-1", instant: "2026-01-19T09:00:00.000Z" });
    expect(mockFetch.mock.calls[0][0]).toBe(`https://api.test.io/api/nests/series-1/recurrence/${AT}`);
  });

  it("refuses a missing or unreadable instant, a missing nestId and an unknown scope, without calling the API", async () => {
    const bad = [
      { nestId: "series-1" },
      { nestId: "series-1", instant: "next tuesday" },
      { nestId: "series-1", instant: "" },
      { instant: AT },
      { nestId: "series-1", instant: AT, scope: "series" },
    ];
    for (const args of bad) {
      const result = await handleToolCall(client, "nestr_skip_occurrence", args);
      expect(result.isError, JSON.stringify(args)).toBe(true);
      expect(parseResult(result.content[0].text).code).toBe("VALIDATION");
    }
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("surfaces a 422 for an instant the series does not have as a clean validation error", async () => {
    mockFetch.mockResolvedValue(
      mockResponse(422, { status: "error", message: "This series has no occurrence at that instant." })
    );
    const result = await handleToolCall(client, "nestr_skip_occurrence", { nestId: "series-1", instant: AT + 1000 });
    expect(result.isError).toBe(true);
    const parsed = parseResult(result.content[0].text);
    expect(parsed.code).toBe("VALIDATION");
    expect(parsed.status).toBe(422);
    expect(parsed.message).toMatch(/no occurrence/);
    expect("stack" in parsed).toBe(false);
  });

  it("surfaces a 403 for a following cut the caller cannot make as a clean refusal", async () => {
    mockFetch.mockResolvedValue(
      mockResponse(403, { status: "error", message: "You do not have the rights to delete this nest." })
    );
    const result = await handleToolCall(client, "nestr_skip_occurrence", {
      nestId: "series-1",
      instant: AT,
      scope: "following",
    });
    expect(result.isError).toBe(true);
    const parsed = parseResult(result.content[0].text);
    expect(parsed.status).toBe(403);
    expect(parsed.code).toBe("AUTH_SCOPE_INSUFFICIENT");
    expect(parsed.message).toMatch(/rights/);
    expect("stack" in parsed).toBe(false);
  });

  // ─── nestr_update_occurrence ────────────────────────────────────

  it("PATCHes /nests/:id/recurrence/:instant with only the fields given, and names the new _id", async () => {
    const nest = { _id: "occ-9", title: "Moved sync", data: { "mcp.x": 1 }, due: "2026-01-20T09:00:00.000Z" };
    mockFetch.mockResolvedValue(mockResponse(200, { status: "success", data: nest }));

    const result = await handleToolCall(client, "nestr_update_occurrence", {
      nestId: "series-1",
      instant: AT,
      title: "Moved sync",
      due: "2026-01-20T09:00:00.000Z",
      users: '["user-1"]',
    });
    expect(result.isError).toBeFalsy();

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe(`https://api.test.io/api/nests/series-1/recurrence/${AT}`);
    expect(opts.method).toBe("PATCH");
    expect(JSON.parse(opts.body)).toEqual({
      title: "Moved sync",
      due: "2026-01-20T09:00:00.000Z",
      users: ["user-1"],
    });

    const parsed = parseResult(result.content[0].text);
    expect(parsed.message).toMatch(/Occurrence updated/);
    expect(parsed.message).toMatch(/occ-9/);
    expect((parsed.nest as Record<string, unknown>)._id).toBe("occ-9");
  });

  it("sends an empty body when given no fields, which only materializes", async () => {
    mockFetch.mockResolvedValue(mockResponse(200, { status: "success", data: { _id: "occ-9", title: "Sync" } }));
    const result = await handleToolCall(client, "nestr_update_occurrence", { nestId: "series-1", instant: String(AT) });
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe(`https://api.test.io/api/nests/series-1/recurrence/${AT}`);
    expect(JSON.parse(opts.body)).toEqual({});
    expect(parseResult(result.content[0].text).message).toMatch(/Occurrence materialized/);
  });

  it("refuses a missing instant, a wrongly typed field and conflicting prime labels, without calling the API", async () => {
    for (const args of [
      { nestId: "series-1", title: "x" },
      { nestId: "series-1", instant: AT, completed: "yes" },
      { nestId: "series-1", instant: AT, labels: ["project", "tension"] },
    ]) {
      const result = await handleToolCall(client, "nestr_update_occurrence", args);
      expect(result.isError, JSON.stringify(args)).toBe(true);
      expect(parseResult(result.content[0].text).code).toBe("VALIDATION");
    }
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("surfaces a refused edit cleanly and says the occurrence may already be materialized", async () => {
    mockFetch.mockResolvedValue(
      mockResponse(403, { status: "error", message: "You do not have the rights to update this nest." })
    );
    const result = await handleToolCall(client, "nestr_update_occurrence", {
      nestId: "series-1",
      instant: AT,
      title: "Nope",
    });
    expect(result.isError).toBe(true);
    const parsed = parseResult(result.content[0].text);
    expect(parsed.status).toBe(403);
    expect(parsed.code).toBe("AUTH_SCOPE_INSUFFICIENT");
    expect(parsed.hint).toMatch(/may already be materialized/);
    expect("stack" in parsed).toBe(false);
  });

  it("surfaces a 422 edit refusal as a validation error with the same note", async () => {
    mockFetch.mockResolvedValue(mockResponse(422, { status: "error", message: "Invalid due date" }));
    const result = await handleToolCall(client, "nestr_update_occurrence", {
      nestId: "series-1",
      instant: AT,
      due: "not a date",
    });
    const parsed = parseResult(result.content[0].text);
    expect(parsed.code).toBe("VALIDATION");
    expect(parsed.status).toBe(422);
    expect(parsed.hint).toMatch(/may already be materialized/);
  });

  // ─── nestr_delete_series ────────────────────────────────────────

  it("DELETEs /nests/:id/recurrence and names the restoreId", async () => {
    mockFetch.mockResolvedValue(
      mockResponse(200, { status: "success", data: { deleted: true, seriesId: "series-1", restoreId: "series-1" } })
    );
    const result = await handleToolCall(client, "nestr_delete_series", { nestId: "occ-3" });
    expect(result.isError).toBeFalsy();

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.test.io/api/nests/occ-3/recurrence");
    expect(opts.method).toBe("DELETE");
    expect(opts.body).toBeUndefined();

    const parsed = parseResult(result.content[0].text);
    expect(parsed.message).toMatch(/past ones included/);
    expect(parsed.message).toMatch(/series-1/);
    expect(parsed.series).toEqual({ deleted: true, seriesId: "series-1", restoreId: "series-1" });
  });

  it("requires nestId", async () => {
    const result = await handleToolCall(client, "nestr_delete_series", {});
    expect(result.isError).toBe(true);
    expect(parseResult(result.content[0].text).code).toBe("VALIDATION");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("surfaces 403 and 422 refusals cleanly", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(403, { status: "error", message: "Not allowed to delete an occurrence." }));
    const refused = parseResult((await handleToolCall(client, "nestr_delete_series", { nestId: "series-1" })).content[0].text);
    expect(refused.status).toBe(403);
    expect(refused.code).toBe("AUTH_SCOPE_INSUFFICIENT");

    mockFetch.mockResolvedValueOnce(mockResponse(422, { status: "error", message: "This nest has no recurrence." }));
    const plain = parseResult((await handleToolCall(client, "nestr_delete_series", { nestId: "plain" })).content[0].text);
    expect(plain.status).toBe(422);
    expect(plain.code).toBe("VALIDATION");
    expect(plain.message).toMatch(/no recurrence/);
    expect("stack" in plain).toBe(false);
  });

  // ─── client methods ─────────────────────────────────────────────

  it("client.skipOccurrence, updateOccurrence and deleteSeries unwrap { status, data }", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse(200, { status: "success", data: { excluded: true, seriesId: "series-1", instant: AT } })
    );
    expect(await client.skipOccurrence("series-1", AT)).toEqual({ excluded: true, seriesId: "series-1", instant: AT });
    expect(mockFetch.mock.calls[0][0]).toBe(`https://api.test.io/api/nests/series-1/recurrence/${AT}`);

    mockFetch.mockResolvedValueOnce(
      mockResponse(200, { status: "success", data: { deleted: true, seriesId: "series-1", instant: AT, restoreId: "r1" } })
    );
    expect(await client.skipOccurrence("series-1", AT, "following")).toEqual({
      deleted: true, seriesId: "series-1", instant: AT, restoreId: "r1",
    });
    expect(mockFetch.mock.calls[1][0]).toBe(`https://api.test.io/api/nests/series-1/recurrence/${AT}?scope=following`);

    const nest = { _id: "occ-9", title: "Sync", data: { key: "value" } };
    mockFetch.mockResolvedValueOnce(mockResponse(200, { status: "success", data: nest }));
    expect(await client.updateOccurrence("series-1", AT, { title: "Sync" })).toEqual(nest);

    // A bare nest carries its own `data` store; that must not be mistaken for an envelope.
    mockFetch.mockResolvedValueOnce(mockResponse(200, nest));
    expect(await client.updateOccurrence("series-1", AT, {})).toEqual(nest);

    mockFetch.mockResolvedValueOnce(
      mockResponse(200, { status: "success", data: { deleted: true, seriesId: "series-1", restoreId: "series-1" } })
    );
    expect(await client.deleteSeries("series-1")).toEqual({ deleted: true, seriesId: "series-1", restoreId: "series-1" });
  });
});
