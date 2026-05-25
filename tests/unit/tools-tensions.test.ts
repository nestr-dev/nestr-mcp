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

describe("nestr_add_tension_part — removeNest routing", () => {
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

  it("removeNest:true + _id → DELETE /parts with body._id", async () => {
    mockFetch.mockResolvedValue(mockResponse(200, { _id: "part-1" }));
    const result = await handleToolCall(client, "nestr_add_tension_part", {
      nestId: "circle-1",
      tensionId: "ten-1",
      _id: "role-99",
      removeNest: true,
    });
    expect(result.isError).toBeFalsy();

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.test.io/api/nests/circle-1/tensions/ten-1/parts");
    expect(opts.method).toBe("DELETE");
    expect(JSON.parse(opts.body)).toEqual({ _id: "role-99" });

    const parsed = parseResult(result.content[0].text);
    expect(parsed.message).toMatch(/deletion proposal/i);
  });

  it("_id without removeNest → PATCH /parts with body (propose change)", async () => {
    mockFetch.mockResolvedValue(mockResponse(200, { _id: "part-2" }));
    await handleToolCall(client, "nestr_add_tension_part", {
      nestId: "circle-1",
      tensionId: "ten-1",
      _id: "role-99",
      title: "new title",
    });
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.test.io/api/nests/circle-1/tensions/ten-1/parts");
    expect(opts.method).toBe("PATCH");
    expect(JSON.parse(opts.body)).toMatchObject({ _id: "role-99", title: "new title" });
  });

  it("no _id → POST /parts (propose new item)", async () => {
    mockFetch.mockResolvedValue(mockResponse(200, { _id: "part-3" }));
    await handleToolCall(client, "nestr_add_tension_part", {
      nestId: "circle-1",
      tensionId: "ten-1",
      title: "New Role",
      labels: ["role"],
    });
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.test.io/api/nests/circle-1/tensions/ten-1/parts");
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body)).toMatchObject({ title: "New Role", labels: ["role"] });
  });

  it("removeNest:true without _id → validation error", async () => {
    const result = await handleToolCall(client, "nestr_add_tension_part", {
      nestId: "circle-1",
      tensionId: "ten-1",
      removeNest: true,
    });
    expect(result.isError).toBe(true);
    const parsed = parseResult(result.content[0].text);
    expect(parsed.code).toBe("VALIDATION");
    expect(parsed.message).toMatch(/removeNest.*requires _id/i);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("removeNest:true ignores extra body fields (only _id matters)", async () => {
    mockFetch.mockResolvedValue(mockResponse(200, { _id: "part-1" }));
    await handleToolCall(client, "nestr_add_tension_part", {
      nestId: "circle-1",
      tensionId: "ten-1",
      _id: "role-99",
      removeNest: true,
      title: "ignored on delete",
      description: "also ignored",
    });
    const [, opts] = mockFetch.mock.calls[0];
    // proposeTensionDeletion only sends { _id } — title/description are intentionally dropped
    expect(JSON.parse(opts.body)).toEqual({ _id: "role-99" });
  });
});

describe("nestr_create_tension — endpoint hint enrichment", () => {
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

  it("translates hint.endpoints into toolCalls on the returned tension", async () => {
    const apiTension = {
      _id: "tension-1",
      title: "Frustrated by missing onboarding docs",
      hints: [
        {
          type: "no_proposed_output",
          label: "Every tension needs an output.",
          severity: "suggestion",
          endpoints: [
            {
              purpose: "Request a project from another role.",
              method: "POST",
              path: "/nests/circle-1/tensions/tension-1/parts",
              body_example: {
                title: "Write onboarding playbook",
                labels: ["project"],
                users: ["user-2"],
              },
            },
            {
              purpose: "Propose a structural change instead.",
              method: "POST",
              path: "/nests/circle-1/tensions/tension-1/parts",
              body_example: {
                title: "Onboarding Coordinator",
                labels: ["role"],
                purpose: "Run onboarding for new clients",
              },
            },
            {
              purpose: "Drop the tension if it's no longer needed.",
              method: "DELETE",
              path: "/nests/circle-1/tensions/tension-1",
            },
          ],
        },
      ],
    };
    mockFetch.mockResolvedValue(mockResponse(200, apiTension));

    const result = await handleToolCall(client, "nestr_create_tension", {
      nestId: "circle-1",
      title: "Frustrated by missing onboarding docs",
    });
    expect(result.isError).toBeFalsy();
    const parsed = parseResult(result.content[0].text);
    const tension = parsed.tension as { hints: Array<Record<string, unknown>> };
    const hint = tension.hints[0];

    // Original endpoints preserved
    expect(hint).toHaveProperty("endpoints");
    expect((hint.endpoints as unknown[]).length).toBe(3);

    // toolCalls added in parallel
    const toolCalls = hint.toolCalls as Array<Record<string, unknown>>;
    expect(toolCalls).toHaveLength(3);
    expect(toolCalls[0]).toMatchObject({
      tool: "nestr_add_tension_part",
      purpose: "Request a project from another role.",
      parametersExample: {
        nestId: "circle-1",
        tensionId: "tension-1",
        title: "Write onboarding playbook",
        labels: ["project"],
        users: ["user-2"],
      },
    });
    expect(toolCalls[1]).toMatchObject({
      tool: "nestr_add_tension_part",
      purpose: "Propose a structural change instead.",
    });
    expect(toolCalls[2]).toMatchObject({
      tool: "nestr_delete_tension",
      purpose: "Drop the tension if it's no longer needed.",
      parametersExample: { nestId: "circle-1", tensionId: "tension-1" },
    });
  });

  it("returns tension unchanged when API returns no hints", async () => {
    mockFetch.mockResolvedValue(mockResponse(200, { _id: "t-1", title: "x" }));
    const result = await handleToolCall(client, "nestr_create_tension", {
      nestId: "circle-1",
      title: "x",
    });
    const parsed = parseResult(result.content[0].text);
    expect(parsed.tension).toEqual({ _id: "t-1", title: "x" });
  });
});
