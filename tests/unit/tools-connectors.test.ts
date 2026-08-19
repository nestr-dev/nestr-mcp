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

describe("connector tools", () => {
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

  // ─── nestr_list_connectors ──────────────────────────────────────

  it("nestr_list_connectors GETs the catalog and unwraps data", async () => {
    const entries = [
      { _id: "c1", workspaceId: "ws1", type: "mcp", name: "Slack", enabled: true },
    ];
    mockFetch.mockResolvedValue(mockResponse(200, { status: "success", data: entries }));

    const result = await handleToolCall(client, "nestr_list_connectors", { workspaceId: "ws1" });
    expect(result.isError).toBeFalsy();

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.test.io/api/workspaces/ws1/connectors");
    expect(opts.method ?? "GET").toBe("GET");

    // Handler returns the unwrapped array as the tool payload.
    const parsed = parseResult(result.content[0].text);
    expect(parsed).toEqual(entries);
  });

  it("nestr_list_connectors requires workspaceId", async () => {
    const result = await handleToolCall(client, "nestr_list_connectors", {});
    expect(result.isError).toBe(true);
    const parsed = parseResult(result.content[0].text);
    expect(parsed.code).toBe("VALIDATION");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // ─── nestr_register_connector ───────────────────────────────────

  it("nestr_register_connector POSTs the body to /connectors", async () => {
    const created = { _id: "c9", workspaceId: "ws1", type: "mcp", name: "Slack", enabled: true };
    mockFetch.mockResolvedValue(mockResponse(200, { status: "success", data: created }));

    const result = await handleToolCall(client, "nestr_register_connector", {
      workspaceId: "ws1",
      type: "mcp",
      name: "Slack",
      config: { url: "https://mcp.example.com" },
      exposure: { domainGated: true },
      authStrategy: "secret",
    });
    expect(result.isError).toBeFalsy();

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.test.io/api/workspaces/ws1/connectors");
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body)).toEqual({
      type: "mcp",
      name: "Slack",
      config: { url: "https://mcp.example.com" },
      exposure: { domainGated: true },
      authStrategy: "secret",
    });

    const parsed = parseResult(result.content[0].text);
    expect(parsed.connector).toEqual(created);
    // A connector nobody has access to does nothing, and the credential is a
    // separate step that must not pass through the agent.
    expect(parsed.message).toMatch(/nestr_bind_connector/i);
    expect(parsed.message).toMatch(/nestr_get_connect_link/i);
  });

  it("nestr_register_connector accepts JSON-stringified config/exposure (client coercion)", async () => {
    const created = { _id: "c9", workspaceId: "ws1", type: "api", name: "Billing", enabled: true };
    mockFetch.mockResolvedValue(mockResponse(200, { status: "success", data: created }));

    await handleToolCall(client, "nestr_register_connector", {
      workspaceId: "ws1",
      type: "api",
      name: "Billing",
      config: '{"url":"https://api.example.com"}',
    });

    const [, opts] = mockFetch.mock.calls[0];
    expect(JSON.parse(opts.body)).toMatchObject({
      type: "api",
      name: "Billing",
      config: { url: "https://api.example.com" },
    });
  });

  it("nestr_register_connector surfaces a 403 as a not-authorized error (admin-only)", async () => {
    mockFetch.mockResolvedValue(
      mockResponse(403, { status: "error", message: "Workspace admin access is required to manage connectors" })
    );

    const result = await handleToolCall(client, "nestr_register_connector", {
      workspaceId: "ws1",
      type: "mcp",
      name: "Slack",
    });

    expect(result.isError).toBe(true);
    const parsed = parseResult(result.content[0].text);
    expect(parsed.code).toBe("AUTH_SCOPE_INSUFFICIENT");
    expect(parsed.status).toBe(403);
    expect(parsed.message).toMatch(/admin access is required/i);
  });

  it("nestr_register_connector requires type and name", async () => {
    const result = await handleToolCall(client, "nestr_register_connector", { workspaceId: "ws1" });
    expect(result.isError).toBe(true);
    const parsed = parseResult(result.content[0].text);
    expect(parsed.code).toBe("VALIDATION");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // ─── nestr_bind_connector ───────────────────────────────────────

  it("nestr_bind_connector assembles owner from ownerType/ownerId and POSTs to /connections", async () => {
    const connection = {
      _id: "conn1",
      workspaceId: "ws1",
      owner: { type: "workspace", id: "ws1" },
      status: "active",
    };
    mockFetch.mockResolvedValue(mockResponse(200, { status: "success", data: connection }));

    const result = await handleToolCall(client, "nestr_bind_connector", {
      workspaceId: "ws1",
      connectorId: "c9",
      ownerType: "workspace",
      ownerId: "ws1",
    });
    expect(result.isError).toBeFalsy();

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.test.io/api/workspaces/ws1/connections");
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body)).toEqual({
      connectorId: "c9",
      owner: { type: "workspace", id: "ws1" },
    });

    const parsed = parseResult(result.content[0].text);
    expect(parsed.connection).toEqual(connection);
    // Giving access is not the same as connecting an account, and the agent must
    // never handle the token, so the note sends it to the link tool.
    expect(parsed.message).toMatch(/nestr_get_connect_link/i);
    expect(parsed.message).toMatch(/never seen by the agent/i);
    expect(parsed.message).not.toMatch(/role's domain/i);
  });

  // Attaching a credential to a person or a bot is not a decision to make from a
  // tool call, and one agent handing another agent access is the case that makes
  // it dangerous. Personal bindings go through an admin in the UI.
  it("nestr_bind_connector refuses a personal owner", async () => {
    for (const ownerType of ["user", "agent"]) {
      // eslint-disable-next-line no-await-in-loop
      const result = await handleToolCall(client, "nestr_bind_connector", {
        workspaceId: "ws1",
        connectorId: "c9",
        ownerType,
        ownerId: "user-2",
      });
      expect(result.isError, `${ownerType} must be refused`).toBe(true);
      expect(parseResult(result.content[0].text).code).toBe("VALIDATION");
    }
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("nestr_bind_connector reports the domain a role binding landed on", async () => {
    const connection = {
      _id: "conn2",
      workspaceId: "ws1",
      owner: { type: "role-domain", id: "domain-7" },
      status: "active",
      domainId: "domain-7",
      domainCreated: true,
    };
    mockFetch.mockResolvedValue(mockResponse(200, { status: "success", data: connection }));

    const result = await handleToolCall(client, "nestr_bind_connector", {
      workspaceId: "ws1",
      connectorId: "c9",
      ownerType: "role",
      ownerId: "role-7",
    });
    expect(result.isError).toBeFalsy();

    const parsed = parseResult(result.content[0].text);
    const conn = parsed.connection as { domainId?: string; domainCreated?: boolean };
    expect(conn.domainId).toBe("domain-7");
    expect(conn.domainCreated).toBe(true);
    expect(parsed.message).toMatch(/role's domain/i);
    // Access alone grants nothing until a person connects an account.
    expect(parsed.message).toMatch(/nestr_get_connect_link/i);
  });

  it("nestr_bind_connector requires connectorId, ownerType and ownerId", async () => {
    const result = await handleToolCall(client, "nestr_bind_connector", { workspaceId: "ws1" });
    expect(result.isError).toBe(true);
    const parsed = parseResult(result.content[0].text);
    expect(parsed.code).toBe("VALIDATION");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("nestr_bind_connector rejects an invalid ownerType before calling the API", async () => {
    const result = await handleToolCall(client, "nestr_bind_connector", {
      workspaceId: "ws1",
      connectorId: "c9",
      ownerType: "team",
      ownerId: "x",
    });
    expect(result.isError).toBe(true);
    const parsed = parseResult(result.content[0].text);
    expect(parsed.code).toBe("VALIDATION");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("nestr_update_connector PATCHes only what was sent", async () => {
    const connector = { _id: "c9", workspaceId: "ws1", name: "Ledger renamed", enabled: true };
    mockFetch.mockResolvedValue(mockResponse(200, { status: "success", data: connector }));

    const result = await handleToolCall(client, "nestr_update_connector", {
      workspaceId: "ws1",
      connectorId: "c9",
      name: "Ledger renamed",
    });
    expect(result.isError).toBeFalsy();

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.test.io/api/workspaces/ws1/connectors/c9");
    expect(opts.method).toBe("PATCH");
    // Only the field asked for: a partial update must not blank the rest.
    expect(JSON.parse(opts.body)).toEqual({ name: "Ledger renamed" });
    expect(parseResult(result.content[0].text).connector).toEqual(connector);
  });

  it("nestr_update_connector can switch a connector off workspace-wide", async () => {
    mockFetch.mockResolvedValue(mockResponse(200, {
      status: "success",
      data: { _id: "c9", workspaceId: "ws1", enabled: false },
    }));

    const result = await handleToolCall(client, "nestr_update_connector", {
      workspaceId: "ws1",
      connectorId: "c9",
      enabled: false,
    });
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({ enabled: false });
  });

  it("nestr_update_connector requires the connector to update", async () => {
    const result = await handleToolCall(client, "nestr_update_connector", { workspaceId: "ws1" });
    expect(result.isError).toBe(true);
    expect(parseResult(result.content[0].text).code).toBe("VALIDATION");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("nestr_remove_connector DELETEs it and says what that costs", async () => {
    mockFetch.mockResolvedValue(mockResponse(200, { status: "success", data: { _id: "c9" } }));

    const result = await handleToolCall(client, "nestr_remove_connector", {
      workspaceId: "ws1",
      connectorId: "c9",
    });
    expect(result.isError).toBeFalsy();

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.test.io/api/workspaces/ws1/connectors/c9");
    expect(opts.method).toBe("DELETE");
    // Removing a connector is not the same as pausing it, so the reply says so.
    expect(parseResult(result.content[0].text).message).toMatch(/stop resolving/i);
  });

  it("nestr_remove_connector requires the connector to remove", async () => {
    const result = await handleToolCall(client, "nestr_remove_connector", { workspaceId: "ws1" });
    expect(result.isError).toBe(true);
    expect(parseResult(result.content[0].text).code).toBe("VALIDATION");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("nestr_list_connections reads the bindings without asking for a secret", async () => {
    const rows = [
      {
        connectionId: "conn1",
        connectorId: "c9",
        connectorName: "Ledger API",
        owner: { type: "role-domain", id: "domain-7" },
        ownerLabel: "Finance Lead (Ops) / Ledger API",
        connectedCount: 1,
        authorizations: [],
      },
    ];
    mockFetch.mockResolvedValue(mockResponse(200, { status: "success", data: rows }));

    const result = await handleToolCall(client, "nestr_list_connections", { workspaceId: "ws1" });
    expect(result.isError).toBeFalsy();

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.test.io/api/workspaces/ws1/connections/list");
    expect(opts.method ?? "GET").toBe("GET");
    expect(parseResult(result.content[0].text)).toEqual(rows);
  });

  it("nestr_get_connect_link hands the credential step to a person", async () => {
    mockFetch.mockResolvedValue(mockResponse(200, {
      status: "success",
      data: { connectionId: "conn1", url: "https://app.test/n/ws1?connect=conn1" },
    }));

    const result = await handleToolCall(client, "nestr_get_connect_link", {
      workspaceId: "ws1",
      connectionId: "conn1",
    });
    expect(result.isError).toBeFalsy();

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.test.io/api/workspaces/ws1/connections/conn1/connect-link");
    expect(opts.method).toBe("POST");

    const parsed = parseResult(result.content[0].text);
    expect(parsed.url).toBe("https://app.test/n/ws1?connect=conn1");
    // The whole point of the link: the secret never passes through the agent.
    expect(parsed.message).toMatch(/never passes through you/i);
  });

  it("nestr_get_agent_connectors reports why a connector is unavailable", async () => {
    const reach = [
      {
        connectionId: "conn1",
        connectorName: "Ledger API",
        source: "role-domain",
        available: false,
        reason: "no-credential",
        canConnect: true,
      },
    ];
    mockFetch.mockResolvedValue(mockResponse(200, { status: "success", data: reach }));

    const result = await handleToolCall(client, "nestr_get_agent_connectors", {
      workspaceId: "ws1",
      agentUserId: "bot-1",
    });
    expect(result.isError).toBeFalsy();

    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.test.io/api/workspaces/ws1/agents/bot-1/connectors");
    expect(parseResult(result.content[0].text)).toEqual(reach);
  });

  it("nestr_run_agent pins the run to a nest and passes what was asked", async () => {
    mockFetch.mockResolvedValue(mockResponse(200, {
      status: "success",
      data: { agentUserId: "bot-1", nestId: "role-7", dispatched: true },
    }));

    const result = await handleToolCall(client, "nestr_run_agent", {
      workspaceId: "ws1",
      agentUserId: "bot-1",
      nestId: "role-7",
      message: "Reconcile the July invoices.",
    });
    expect(result.isError).toBeFalsy();

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.test.io/api/workspaces/ws1/agents/bot-1/run");
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body)).toEqual({
      nestId: "role-7",
      message: "Reconcile the July invoices.",
    });
    expect(parseResult(result.content[0].text).dispatched).toBe(true);
  });

  it("nestr_run_agent requires the nest the run is pinned to", async () => {
    const result = await handleToolCall(client, "nestr_run_agent", {
      workspaceId: "ws1",
      agentUserId: "bot-1",
    });
    expect(result.isError).toBe(true);
    expect(parseResult(result.content[0].text).code).toBe("VALIDATION");
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
