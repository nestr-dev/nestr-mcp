import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { handleToolCall, toolDefinitions } from "../../src/tools/index.js";
import { NestrClient } from "../../src/api/client.js";

// The same gap `due` had, in the same place. nestr_create_nest had no
// `completed`, while nestr_update_nest had one and the REST create route already
// accepted it: the "this nest cannot be completed" guard there is gated on the
// nest having an id, which a create does not, so it falls through and sets it.
//
// The failure is silent, which is what makes it expensive. The zod schema is a
// plain z.object(), so it strips what it does not know rather than complaining.
// An agent creating an already-done task gets "Nest created successfully", a
// nest that is open, and nothing anywhere saying the field was dropped. Eight
// tasks across two merged projects sat open for hours before a board hint, not
// the API, gave it away.
describe("nestr_create_nest completed", () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  let client: NestrClient;
  let sentBody: Record<string, unknown>;

  beforeEach(() => {
    sentBody = {};
    mockFetch = vi.fn(async (_url: string, init: { body?: string }) => {
      sentBody = JSON.parse(init?.body || "{}");
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ _id: "n1", title: "Wire the picker" }),
      };
    });
    vi.stubGlobal("fetch", mockFetch);
    client = new NestrClient({ apiKey: "t", baseUrl: "https://api.test.io/api" });
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  const create = async (args: Record<string, unknown>) => {
    return handleToolCall(client, "nestr_create_nest", args);
  };

  it("sends completed on create", async () => {
    await create({ parentId: "p1", title: "Wire the picker", completed: true });
    expect(sentBody.completed).toBe(true);
  });

  it("passes false through, rather than treating it as absent", async () => {
    await create({ parentId: "p1", title: "Wire the picker", completed: false });
    expect(sentBody.completed).toBe(false);
  });

  it("leaves it off when there is none", async () => {
    await create({ parentId: "p1", title: "Some task" });
    expect(sentBody.completed).toBeUndefined();
  });

  // Advertised as well as parsed: a parameter only in the zod schema does not
  // exist as far as any model is concerned.
  it("advertises completed, so a model can find it", () => {
    const tool = toolDefinitions.find((t) => { return t.name === "nestr_create_nest"; });
    const props = tool?.inputSchema.properties as Record<string, { description?: string }>;
    expect(props.completed).toBeTruthy();
    // Projects are the trap: they close through a field, not this flag.
    expect(props.completed.description).toContain("project.status");
  });
});
