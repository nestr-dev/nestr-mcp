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
    expect(parsed.message).toMatch(/bind it to an owner/i);
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
      owner: { type: "agent", id: "user-2" },
      status: "active",
    };
    mockFetch.mockResolvedValue(mockResponse(200, { status: "success", data: connection }));

    const result = await handleToolCall(client, "nestr_bind_connector", {
      workspaceId: "ws1",
      connectorId: "c9",
      ownerType: "agent",
      ownerId: "user-2",
    });
    expect(result.isError).toBeFalsy();

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.test.io/api/workspaces/ws1/connections");
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body)).toEqual({
      connectorId: "c9",
      owner: { type: "agent", id: "user-2" },
    });

    const parsed = parseResult(result.content[0].text);
    expect(parsed.connection).toEqual(connection);
    // Non role-domain owner gets the generic Connect-button note.
    expect(parsed.message).toMatch(/connect button/i);
    expect(parsed.message).not.toMatch(/role's domain/i);
  });

  it("nestr_bind_connector surfaces credentialsField + role-domain note for a role-domain owner", async () => {
    const connection = {
      _id: "conn2",
      workspaceId: "ws1",
      owner: { type: "role-domain", id: "domain-7" },
      status: "active",
      credentialsField: {
        domainId: "domain-7",
        fieldId: "domain-7-credentials-connector_credentials",
        fieldCode: "connector_credentials",
      },
    };
    mockFetch.mockResolvedValue(mockResponse(200, { status: "success", data: connection }));

    const result = await handleToolCall(client, "nestr_bind_connector", {
      workspaceId: "ws1",
      connectorId: "c9",
      ownerType: "role-domain",
      ownerId: "domain-7",
    });
    expect(result.isError).toBeFalsy();

    const parsed = parseResult(result.content[0].text);
    const conn = parsed.connection as { credentialsField?: { domainId: string } };
    expect(conn.credentialsField?.domainId).toBe("domain-7");
    expect(parsed.message).toMatch(/role's domain/i);
    expect(parsed.message).toMatch(/connect button/i);
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
});
