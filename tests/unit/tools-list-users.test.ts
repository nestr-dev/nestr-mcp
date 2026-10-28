import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { handleToolCall, toolDefinitions } from "../../src/tools/index.js";
import { NestrClient } from "../../src/api/client.js";

// Finding the other agents is how a role-filling agent answers "use my Drive".
// It cannot: a personal connector belongs to the person, not to the role it
// fills. What it CAN do is name the workspace's assistant, and this is the only
// tool that tells it one exists.

describe("nestr_list_users agent filter", () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  let client: NestrClient;
  let lastUrl: string;

  beforeEach(() => {
    lastUrl = "";
    const body = {
      status: "success",
      data: [
        {
          _id: "bot-1",
          username: "digest-abc",
          bot: true,
          assistant: true,
          profile: { fullName: "Digest", agentDescription: "Summarises Drive" },
          // Stripped by compactResponse, and must be: it is noise in a list.
          agentConfig: { capabilities: { web_search: true } },
        },
      ],
    };
    mockFetch = vi.fn(async (url: string) => {
      lastUrl = url;
      // The client reads text() and parses it itself, so json() is never called.
      return { ok: true, status: 200, text: async () => JSON.stringify(body) };
    });
    vi.stubGlobal("fetch", mockFetch);
    client = new NestrClient({ apiKey: "t", baseUrl: "https://api.test.io/api" });
  });

  afterEach(() => { vi.unstubAllGlobals(); });

  const call = async (args: Record<string, unknown>) => {
    const res = await handleToolCall(client, "nestr_list_users", args);
    return JSON.parse((res.content[0] as { text: string }).text);
  };

  it("asks the API for agents only", async () => {
    await call({ workspaceId: "ws-1", agents: "only" });
    expect(lastUrl).toContain("/workspaces/ws-1/users");
    expect(lastUrl).toContain("agents=only");
  });

  it("asks for people when excluding agents", async () => {
    await call({ workspaceId: "ws-1", agents: "exclude" });
    expect(lastUrl).toContain("agents=exclude");
  });

  it("asks for everyone when the filter is omitted", async () => {
    await call({ workspaceId: "ws-1" });
    expect(lastUrl).not.toContain("agents=");
  });

  it("refuses a filter that is neither, rather than quietly listing everyone", async () => {
    const result = await call({ workspaceId: "ws-1", agents: "sometimes" });
    expect(result.error).toBe(true);
    expect(lastUrl).toBe("");
  });

  // The whole point of asking. Stripping these leaves an agent
  // indistinguishable from a person, and "which of these can act on my own
  // credentials for me" then has no answer in the data.
  it("keeps bot and assistant through the compacting", async () => {
    const agent = (await call({ workspaceId: "ws-1", agents: "only" })).data[0];
    expect(agent.bot).toBe(true);
    expect(agent.assistant).toBe(true);
    expect(agent.profile.agentDescription).toBe("Summarises Drive");
    expect(agent.agentConfig).toBeUndefined();
  });

  it("advertises the filter on the tool, so a model can find it", () => {
    const tool = toolDefinitions.find((t) => { return t.name === "nestr_list_users"; });
    const props = tool?.inputSchema.properties as Record<string, { enum?: string[] }>;
    expect(props.agents?.enum).toEqual(["only", "exclude"]);
  });
});
