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

// The route behind this tool refuses what it cannot write (an unknown field, an
// empty body, a blank name, roleAssignable:false while roles are still filled)
// with a 422 whose message says why. Before the tool existed the assistant told
// people it could not change an agent's description at all; with it, the one
// thing that matters is that a refusal reaches the caller as the route said it.
describe("nestr_update_agent", () => {
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

  const update = (args: Record<string, unknown>) => handleToolCall(client, "nestr_update_agent", args);

  it("PATCHes only the fields sent to the agent's route and unwraps the user", async () => {
    const updated = { _id: "u-collab", username: "Collab", profile: { agentDescription: "Precise" } };
    mockFetch.mockResolvedValue(mockResponse(200, { status: "success", data: updated }));

    const result = await update({ workspaceId: "ws1", userId: "u-collab", description: "Precise" });
    expect(result.isError).toBeFalsy();

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.test.io/api/workspaces/ws1/agents/u-collab");
    expect(opts.method).toBe("PATCH");
    expect(JSON.parse(opts.body)).toEqual({ description: "Precise" });

    const parsed = parseResult(result.content[0].text);
    expect(parsed.agent).toEqual(updated);
    expect(String(parsed.message)).toMatch(/landed/);
  });

  it("carries every supported field through under the API's names", async () => {
    mockFetch.mockResolvedValue(mockResponse(200, { status: "success", data: { _id: "u1", username: "Collab" } }));

    await update({
      workspaceId: "ws1",
      userId: "u1",
      name: "Collab 2",
      webSearch: false,
      status: "paused",
      agentConfig: { runtimeCallbackUrl: "https://runtime.example.com/hook" },
    });
    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({
      name: "Collab 2",
      webSearch: false,
      status: "paused",
      agentConfig: { runtimeCallbackUrl: "https://runtime.example.com/hook" },
    });
  });

  it("accepts agentConfig as a JSON string, as clients that cannot send objects do", async () => {
    mockFetch.mockResolvedValue(mockResponse(200, { status: "success", data: { _id: "u1", username: "Collab" } }));

    await update({ workspaceId: "ws1", userId: "u1", agentConfig: '{"tokenTtlSeconds":600}' });
    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({ agentConfig: { tokenTtlSeconds: 600 } });
  });

  it("requires a workspaceId and a userId", async () => {
    const noUser = await update({ workspaceId: "ws1", name: "Collab" });
    expect(noUser.isError).toBe(true);
    expect(parseResult(noUser.content[0].text).code).toBe("VALIDATION");

    const noWorkspace = await update({ userId: "u1", name: "Collab" });
    expect(noWorkspace.isError).toBe(true);
    expect(parseResult(noWorkspace.content[0].text).code).toBe("VALIDATION");

    expect(mockFetch).not.toHaveBeenCalled();
  });

  // The route answers an empty body with 422; refusing here saves the round
  // trip and names the fields, which the route's message also does.
  it("refuses a call that changes nothing without calling the API", async () => {
    const result = await update({ workspaceId: "ws1", userId: "u1" });
    expect(result.isError).toBe(true);
    const parsed = parseResult(result.content[0].text);
    expect(parsed.code).toBe("VALIDATION");
    expect(String(parsed.message)).toMatch(/Nothing to update/);
    expect(String(parsed.message)).toContain("roleAssignable");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("refuses a status outside active, paused and disabled before calling the API", async () => {
    const result = await update({ workspaceId: "ws1", userId: "u1", status: "suspended" });
    expect(result.isError).toBe(true);
    expect(parseResult(result.content[0].text).code).toBe("VALIDATION");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // The one refusal a caller has to act on: the message names the roles to
  // unassign first, so it must arrive as the route wrote it.
  it("relays the route's still-fills-roles refusal verbatim as a 422 validation error", async () => {
    const message = "This agent still fills a role: Marketing. Unassign it there first, then make it an assistant.";
    mockFetch.mockResolvedValue(mockResponse(422, { status: "error", message }));

    const result = await update({ workspaceId: "ws1", userId: "u1", roleAssignable: false });
    expect(result.isError).toBe(true);
    const parsed = parseResult(result.content[0].text);
    expect(parsed.code).toBe("VALIDATION");
    expect(parsed.status).toBe(422);
    expect(parsed.message).toBe(message);
    expect("stack" in parsed).toBe(false);
  });

  // The description promises that a field the tool does not list is refused,
  // not dropped. A plain z.object strips unknown keys, which would PATCH the
  // known ones and answer "every field you sent has landed" for one that
  // never left the process.
  it("refuses a field it does not list, naming it, without calling the API", async () => {
    const result = await update({ workspaceId: "ws1", userId: "u1", name: "Collab", instructions: "Be brief" });
    expect(result.isError).toBe(true);
    const parsed = parseResult(result.content[0].text);
    expect(parsed.code).toBe("VALIDATION");
    expect(String(parsed.message)).toContain("instructions");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("relays the route's own unknown-field refusal should the API ever see one", async () => {
    const message = "Unsupported parameter: purpose. Accepted: name, description, webSearch, status, roleAssignable, agentConfig.";
    mockFetch.mockResolvedValue(mockResponse(422, { status: "error", message }));

    const result = await update({ workspaceId: "ws1", userId: "u1", name: "Collab" });
    expect(result.isError).toBe(true);
    expect(parseResult(result.content[0].text).message).toBe(message);
  });

  // Admin-only at the route; the tool must surface that rather than swallow it.
  it("surfaces a non-admin refusal", async () => {
    mockFetch.mockResolvedValue(mockResponse(403, { status: "error", message: "Workspace admin access is required to manage agents" }));

    const result = await update({ workspaceId: "ws1", userId: "u1", name: "Collab" });
    expect(result.isError).toBe(true);
    expect(parseResult(result.content[0].text).code).toBe("AUTH_SCOPE_INSUFFICIENT");
  });

  it("surfaces an agent the workspace does not have as not found", async () => {
    mockFetch.mockResolvedValue(mockResponse(404, { status: "error", message: "Agent not found in this workspace" }));

    const result = await update({ workspaceId: "ws1", userId: "nobody", name: "Collab" });
    expect(result.isError).toBe(true);
    expect(parseResult(result.content[0].text).code).toBe("NOT_FOUND");
  });
});

// Turning an agent into an assistant, or back, changes where it belongs: on
// the task beside a person, or in a role's users. Saying so at the moment of the
// change is what keeps "assign it to the role" from being the next step after
// making the one thing that must never be assigned.
describe("nestr_update_agent roleAssignable", () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  let client: NestrClient;

  beforeEach(() => {
    mockFetch = vi.fn(async () => mockResponse(200, { status: "success", data: { _id: "bot-1", username: "aide-x" } }));
    vi.stubGlobal("fetch", mockFetch);
    client = new NestrClient({ apiKey: "t", baseUrl: "https://api.test.io/api" });
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  const update = async (args: Record<string, unknown>) => {
    const res = await handleToolCall(client, "nestr_update_agent", { workspaceId: "ws-1", userId: "bot-1", ...args });
    return parseResult((res.content[0] as { text: string }).text);
  };

  it("tells a new assistant's caller to put it on the task, not the role", async () => {
    const out = await update({ roleAssignable: false });
    expect(out.message as string).toContain("TASK");
    expect(out.message as string).toContain("never be assigned to a role");
  });

  it("tells the caller an agent made assignable again assists until it is assigned", async () => {
    const out = await update({ roleAssignable: true });
    expect(out.message as string).toMatch(/assigned to roles again/);
    expect(out.message as string).toMatch(/assists while it holds none/);
  });

  it("says nothing about roles for a change that does not touch assignability", async () => {
    const out = await update({ description: "Precise, invents little" });
    expect(out.message as string).not.toContain("TASK");
    expect(out.message as string).toMatch(/landed/);
  });
});
