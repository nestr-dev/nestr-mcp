import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { handleToolCall, toolDefinitions } from "../../src/tools/index.js";
import { NestrClient } from "../../src/api/client.js";

// The gap: nestr_create_nest had no `due` at all, in either schema, while
// nestr_update_nest had one and the REST create route already accepted it. So an
// agent building a dated task could not set the due date on create, never came
// back with an update, and the sweep that fires dated work never saw the task.
// Three rounds of sharpening the coach skill could not fix a missing parameter.
describe("nestr_create_nest due", () => {
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
        text: async () => JSON.stringify({ _id: "n1", title: "Daily digest" }),
      };
    });
    vi.stubGlobal("fetch", mockFetch);
    client = new NestrClient({ apiKey: "t", baseUrl: "https://api.test.io/api" });
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  const create = async (args: Record<string, unknown>) => {
    return handleToolCall(client, "nestr_create_nest", args);
  };

  it("sends the due date on create", async () => {
    await create({
      parentId: "p1", title: "Daily digest", due: "2026-08-28T08:00:00.000Z",
    });
    expect(sentBody.due).toBe("2026-08-28T08:00:00.000Z");
  });

  it("leaves it off when there is none", async () => {
    await create({ parentId: "p1", title: "Some project" });
    expect(sentBody.due).toBeUndefined();
  });

  // Advertised as well as parsed: a parameter only in the zod schema does not
  // exist as far as any model is concerned.
  it("advertises due, so a model can find it", () => {
    const tool = toolDefinitions.find((t) => { return t.name === "nestr_create_nest"; });
    const props = tool?.inputSchema.properties as Record<string, { description?: string }>;
    expect(props.due).toBeTruthy();
    // Naming the failure is the point: the title is not the field.
    expect(props.due.description).toContain("field, not a title");
  });
});
