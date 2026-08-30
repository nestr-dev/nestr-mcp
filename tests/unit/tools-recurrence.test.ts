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
      mockResponse(200, { status: "success", data: { rrule: "FREQ=DAILY;COUNT=15", generated: 10 } })
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
    expect(parsed.message).toMatch(/10 instance/);
    expect(parsed.recurrence).toEqual({ rrule: "FREQ=DAILY;COUNT=15", generated: 10 });
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
      mockResponse(200, { status: "success", data: { rrule: "FREQ=WEEKLY;COUNT=3", generated: 3 } })
    );
    const setResult = await client.setRecurrence("nest-1", "FREQ=WEEKLY;COUNT=3");
    expect(setResult).toEqual({ rrule: "FREQ=WEEKLY;COUNT=3", generated: 3 });

    mockFetch.mockResolvedValueOnce(mockResponse(200, { status: "success", data: { removed: true } }));
    const removeResult = await client.setRecurrence("nest-1", null);
    expect(removeResult).toEqual({ removed: true });
  });
});
