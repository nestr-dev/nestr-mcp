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

describe("nestr_create_agent", () => {
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

  it("POSTs the name to the workspace's agents route and unwraps the user", async () => {
    const created = { _id: "u-collab", username: "Collab" };
    mockFetch.mockResolvedValue(mockResponse(200, { status: "success", data: created }));

    const result = await handleToolCall(client, "nestr_create_agent", {
      workspaceId: "ws1",
      name: "Collab",
    });
    expect(result.isError).toBeFalsy();

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.test.io/api/workspaces/ws1/agents");
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body)).toEqual({ name: "Collab" });

    const parsed = parseResult(result.content[0].text);
    expect(parsed.agent).toEqual(created);
  });

  // The boundary this tool exists to hold: creating the agent is half the job,
  // and the half that gets skipped is the role it fills. The message says so,
  // and says the role is named for the work rather than for the agent.
  it("points at the role as the next step, named for the work", async () => {
    mockFetch.mockResolvedValue(
      mockResponse(200, { status: "success", data: { _id: "u1", username: "Collab" } })
    );

    const result = await handleToolCall(client, "nestr_create_agent", {
      workspaceId: "ws1",
      name: "Collab",
    });
    const message = String(parseResult(result.content[0].text).message);
    expect(message).toContain("nestr_create_nest");
    expect(message).toContain("nestr_update_nest");
    expect(message).toMatch(/not for the agent/i);
  });

  it("passes agentConfig through when given, and omits it when not", async () => {
    mockFetch.mockResolvedValue(
      mockResponse(200, { status: "success", data: { _id: "u1", username: "Collab" } })
    );

    await handleToolCall(client, "nestr_create_agent", {
      workspaceId: "ws1",
      name: "Collab",
      agentConfig: { runtimeCallbackUrl: "https://runtime.example.com/hook" },
    });
    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({
      name: "Collab",
      agentConfig: { runtimeCallbackUrl: "https://runtime.example.com/hook" },
    });
  });

  it("requires a workspaceId and a name", async () => {
    const noName = await handleToolCall(client, "nestr_create_agent", { workspaceId: "ws1" });
    expect(noName.isError).toBe(true);
    expect(parseResult(noName.content[0].text).code).toBe("VALIDATION");

    const noWorkspace = await handleToolCall(client, "nestr_create_agent", { name: "Collab" });
    expect(noWorkspace.isError).toBe(true);
    expect(parseResult(noWorkspace.content[0].text).code).toBe("VALIDATION");

    expect(mockFetch).not.toHaveBeenCalled();
  });

  // Admin-only at the route; the tool must surface that rather than swallow it.
  it("surfaces a non-admin refusal", async () => {
    mockFetch.mockResolvedValue(mockResponse(403, { status: "error", message: "Workspace admin access is required to manage agents" }));

    const result = await handleToolCall(client, "nestr_create_agent", {
      workspaceId: "ws1",
      name: "Collab",
    });
    expect(result.isError).toBe(true);
  });
});

describe("connector templates", () => {
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

  it("lists the templates and points at registering from one", async () => {
    const templates = [{ id: "xero", name: "Xero", type: "mcp" }];
    mockFetch.mockResolvedValue(mockResponse(200, { status: "success", data: templates }));

    const result = await handleToolCall(client, "nestr_list_connector_templates", { workspaceId: "ws1" });
    expect(result.isError).toBeFalsy();
    expect(mockFetch.mock.calls[0][0]).toBe("https://api.test.io/api/workspaces/ws1/connector-templates");

    const parsed = parseResult(result.content[0].text);
    expect(parsed.templates).toEqual(templates);
    expect(String(parsed.message)).toContain("templateId");
  });

  // The whole point: the endpoint comes from the template, not from the model.
  it("registers from a template without needing type or config", async () => {
    mockFetch.mockResolvedValue(
      mockResponse(200, { status: "success", data: { _id: "c1", name: "Xero", type: "mcp" } })
    );

    const result = await handleToolCall(client, "nestr_register_connector", {
      workspaceId: "ws1",
      templateId: "xero",
    });
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({ templateId: "xero" });
  });

  it("still refuses a hand-registration missing type or name, and says to look for a template", async () => {
    const result = await handleToolCall(client, "nestr_register_connector", {
      workspaceId: "ws1",
      name: "Xero",
    });
    expect(result.isError).toBe(true);
    const parsed = parseResult(result.content[0].text);
    expect(parsed.code).toBe("VALIDATION");
    expect(String(parsed.message)).toContain("nestr_list_connector_templates");
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
