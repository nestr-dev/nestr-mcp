import { describe, it, expect, vi, afterEach } from "vitest";
import { createServer } from "../../src/server.js";
import { handleToolCall, toolDefinitions } from "../../src/tools/index.js";
import { NestrClient, NestrApiError } from "../../src/api/client.js";
import { AGENT_EMAIL_TOOL, agentEmailGate, withoutAgentEmail } from "../../src/api/agent-email-availability.js";

// nestr_send_email only works in an agent run of a workspace with agent email
// switched on, so it is listed only where Nestr says this session may send.
// Outside clients (an OAuth user, an API key) and agents with the setting off
// never see it. Fails closed: anything but a plain yes hides it.

type Handler = (req: unknown, extra: unknown) => Promise<{ tools: { name: string }[] }>;

async function listedTools(client: Partial<NestrClient>, config: Record<string, unknown> = {}) {
  const server = createServer({ client: client as NestrClient, ...config });
  const handler = (server as unknown as { _requestHandlers: Map<string, Handler> })._requestHandlers.get("tools/list");
  if (!handler) throw new Error("tools/list handler not registered");
  const result = await handler({ method: "tools/list", params: {} }, {});
  return result.tools.map((t) => t.name);
}

const answering = (value: boolean | (() => Promise<boolean>)) => {
  const isAgentEmailAvailable = vi.fn(typeof value === "function" ? value : async () => value);
  return { isAgentEmailAvailable } as unknown as Partial<NestrClient> & { isAgentEmailAvailable: ReturnType<typeof vi.fn> };
};

describe("listing nestr_send_email", () => {
  it("lists it for an agent run of a workspace with agent email on", async () => {
    expect(await listedTools(answering(true))).toContain(AGENT_EMAIL_TOOL);
  });

  it("hides it from an outside client and from a run with the setting off", async () => {
    // Nestr answers false for both: it is the same check the send runs.
    const tools = await listedTools(answering(false));
    expect(tools).not.toContain(AGENT_EMAIL_TOOL);
    // Everything else is still there.
    expect(tools.length).toBe(toolDefinitions.length - 1);
  });

  it("hides it when the answer is unknown (the lookup fails or the route is missing)", async () => {
    const missing = answering(async () => { throw new NestrApiError("Not found", 404, "/agents/runs/email"); });
    expect(await listedTools(missing)).not.toContain(AGENT_EMAIL_TOOL);
    const down = answering(async () => { throw new Error("network"); });
    expect(await listedTools(down)).not.toContain(AGENT_EMAIL_TOOL);
  });

  it("never asks on the public or read-only surfaces, which do not carry the tool", async () => {
    const client = answering(true);
    expect(await listedTools(client, { isPublic: true })).not.toContain(AGENT_EMAIL_TOOL);
    expect(await listedTools(client, { isReadOnly: true })).not.toContain(AGENT_EMAIL_TOOL);
    expect(client.isAgentEmailAvailable).not.toHaveBeenCalled();
  });
});

describe("agentEmailGate", () => {
  it("asks once per session and remembers the answer", async () => {
    const client = answering(true);
    const gate = agentEmailGate(client as never);
    expect(await gate()).toBe(true);
    expect(await gate()).toBe(true);
    expect(client.isAgentEmailAvailable).toHaveBeenCalledTimes(1);
  });

  it("does not remember a failed lookup, so a transient error only hides it once", async () => {
    let calls = 0;
    const client = answering(async () => { calls += 1; if (calls === 1) throw new Error("blip"); return true; });
    const gate = agentEmailGate(client as never);
    expect(await gate()).toBe(false);
    expect(await gate()).toBe(true);
  });

  it("treats anything but true as no", async () => {
    const client = answering(async () => "yes" as unknown as boolean);
    expect(await agentEmailGate(client as never)()).toBe(false);
  });

  it("withoutAgentEmail drops only that tool", () => {
    const tools = [{ name: "nestr_get_me" }, { name: AGENT_EMAIL_TOOL }];
    expect(withoutAgentEmail(tools)).toEqual([{ name: "nestr_get_me" }]);
  });
});

// Drive the real client against the route's wire shape, so the envelope is what
// is asserted rather than an assumed one.
describe("NestrClient.isAgentEmailAvailable", () => {
  const respondWith = (status: number, payload: unknown) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: status < 400,
      status,
      text: async () => JSON.stringify(payload),
      json: async () => payload,
    }));
  };
  const client = () => new NestrClient({ apiKey: "t", baseUrl: "https://api.test.io/api" });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("reads available out of the { status, data } envelope", async () => {
    respondWith(200, { status: "success", data: { available: true } });
    expect(await client().isAgentEmailAvailable()).toBe(true);
    respondWith(200, { status: "success", data: { available: false } });
    expect(await client().isAgentEmailAvailable()).toBe(false);
  });

  it("asks GET /agents/runs/email", async () => {
    respondWith(200, { status: "success", data: { available: true } });
    await client().isAgentEmailAvailable();
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(url)).toMatch(/\/agents\/runs\/email$/);
    expect((init?.method ?? "GET").toUpperCase()).toBe("GET");
  });

  it("throws on an older API without the route, which the gate turns into hidden", async () => {
    respondWith(404, { status: "error", message: "Not found" });
    await expect(client().isAgentEmailAvailable()).rejects.toBeTruthy();
    expect(await agentEmailGate(client())()).toBe(false);
  });
});

// The tool stays callable by name even when it is not listed, and then gets the
// server's own refusal back, as a clean error rather than a crash.
describe("calling nestr_send_email where it is not available", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("returns the server's refusal", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => JSON.stringify({ status: "error", message: "Only an agent run can send email" }),
      json: async () => ({ status: "error", message: "Only an agent run can send email" }),
    }));
    const client = new NestrClient({ apiKey: "t", baseUrl: "https://api.test.io/api" });
    const result = await handleToolCall(client, AGENT_EMAIL_TOOL, { to: ["u1"], subject: "Hi", body: "x" }) as {
      isError?: boolean; content: { text: string }[];
    };
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Only an agent run can send email");
  });
});
