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

describe("the template hint becomes a tool call", () => {
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

  // A hand-written url pointing at a vendor we ship a template for is how the
  // Xero connector ended up on api.xero.com: it authorised and then failed
  // every call. The hint has to arrive as something the model can act on.
  it("enriches the hint so the model can go look at the templates", async () => {
    mockFetch.mockResolvedValue(mockResponse(200, {
      status: "success",
      data: { _id: "c9", workspaceId: "ws1", type: "api", name: "Xero" },
      hints: [{
        type: "connector_template_available",
        severity: "warning",
        label: "This deployment ships a Xero template pointing at https://mcp.xero.com/mcp.",
        templateId: "xero",
        workspaceId: "ws1",
      }],
    }));

    const result = await handleToolCall(client, "nestr_register_connector", {
      workspaceId: "ws1",
      type: "api",
      name: "Xero",
      config: { url: "https://api.xero.com/api.xro/2.0" },
    });
    expect(result.isError).toBeFalsy();

    const parsed = parseResult(result.content[0].text);
    const connector = parsed.connector as Record<string, unknown>;
    const hints = connector.hints as Array<Record<string, unknown>>;
    expect(hints).toHaveLength(1);
    expect(hints[0].toolCall).toEqual({
      tool: "nestr_list_connector_templates",
      params: { workspaceId: "ws1" },
    });
  });

  it("leaves a connector with no hint alone", async () => {
    mockFetch.mockResolvedValue(mockResponse(200, {
      status: "success",
      data: { _id: "c9", workspaceId: "ws1", type: "api", name: "Something bespoke" },
    }));

    const result = await handleToolCall(client, "nestr_register_connector", {
      workspaceId: "ws1",
      type: "api",
      name: "Something bespoke",
      config: { url: "https://bespoke.example/api" },
    });
    const connector = parseResult(result.content[0].text).connector as Record<string, unknown>;
    expect(connector.hints).toBeUndefined();
  });
  // Listing templates was not enough on its own: a caller that could SEE the
  // Xero template still hand-built a connector from what the template told it,
  // and a hand-built copy carries no OAuth client and fails at first use. The
  // hint on the listing has to arrive as the register call itself.
  it("turns the template listing hint into a pre-filled register call", async () => {
    mockFetch.mockResolvedValue(mockResponse(200, {
      status: "success",
      data: [{ id: "xero", name: "Xero", available: true }],
      hints: [{
        type: "connector_template_create",
        severity: "info",
        label: "Register one of these directly with { templateId: <id> }.",
        templateIds: ["xero"],
        workspaceId: "ws1",
      }],
    }));

    const result = await handleToolCall(client, "nestr_list_connector_templates", {
      workspaceId: "ws1",
    });
    expect(result.isError).toBeFalsy();

    const parsed = parseResult(result.content[0].text);
    const hints = parsed.hints as Array<Record<string, unknown>>;
    expect(hints).toHaveLength(1);
    // One template, so the id is filled in rather than left as a placeholder.
    expect(hints[0].toolCall).toEqual({
      tool: "nestr_register_connector",
      params: { workspaceId: "ws1", templateId: "xero" },
    });
  });

  it("leaves the template id to the caller when several are on offer", async () => {
    mockFetch.mockResolvedValue(mockResponse(200, {
      status: "success",
      data: [{ id: "xero", name: "Xero" }, { id: "notion", name: "Notion" }],
      hints: [{
        type: "connector_template_create",
        templateIds: ["xero", "notion"],
        workspaceId: "ws1",
      }],
    }));

    const result = await handleToolCall(client, "nestr_list_connector_templates", {
      workspaceId: "ws1",
    });
    const parsed = parseResult(result.content[0].text);
    const hints = parsed.hints as Array<Record<string, unknown>>;
    const call = hints[0].toolCall as { params: Record<string, unknown> };
    expect(call.params.workspaceId).toBe("ws1");
    expect(String(call.params.templateId)).toContain("template you want");
  });
});

// The gap this closes: the tool could not express an assistant at all, so every
// agent it made was role-assignable, an onboarding run then assigned one to the
// role, and the run could not reach anything belonging to the person it was
// meant to be helping. Prose in a skill cannot fix a parameter that is missing.
describe("nestr_create_agent roleAssignable", () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  let client: NestrClient;
  let sentBody: Record<string, unknown>;

  beforeEach(() => {
    sentBody = {};
    mockFetch = vi.fn(async (_url: string, init: { body?: string }) => {
      sentBody = JSON.parse(init?.body || "{}");
      return mockResponse(200, { status: "success", data: { _id: "bot-1", username: "aide-x" } });
    });
    vi.stubGlobal("fetch", mockFetch);
    client = new NestrClient({ apiKey: "t", baseUrl: "https://api.test.io/api" });
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  const create = async (args: Record<string, unknown>) => {
    const res = await handleToolCall(client, "nestr_create_agent", args);
    return parseResult((res.content[0] as { text: string }).text);
  };

  it("sends roleAssignable false so the server can make an assistant", async () => {
    await create({ workspaceId: "ws-1", name: "Aide", roleAssignable: false });
    expect(sentBody.roleAssignable).toBe(false);
  });

  it("leaves it off when the caller did not say, so the server default stands", async () => {
    await create({ workspaceId: "ws-1", name: "Collab" });
    expect(sentBody.roleAssignable).toBeUndefined();
  });

  it("carries the character through", async () => {
    await create({ workspaceId: "ws-1", name: "Collab", description: "Precise, invents little" });
    expect(sentBody.description).toBe("Precise, invents little");
  });

  // Telling someone who just made an assistant to "assign it to the role" is
  // the exact mistake the parameter exists to prevent.
  it("tells an assistant's caller to put it on the task, not the role", async () => {
    const out = await create({ workspaceId: "ws-1", name: "Aide", roleAssignable: false });
    expect(out.message as string).toContain("TASK");
    expect(out.message as string).toContain("never be assigned to a role");
  });

  // An assignable agent is not thereby a filler: it assists until someone
  // assigns it to a role. Saying only "assign it to a role" reads as the one
  // thing it is for, which is how the assisting shape got lost.
  it("tells an assignable agent's caller about both shapes", async () => {
    const out = await create({ workspaceId: "ws-1", name: "Collab" });
    expect(out.message as string).toContain("assignable to roles");
    expect(out.message as string).toContain("assists while it holds none");
    expect(out.message as string).toContain("task beside them");
  });
});
