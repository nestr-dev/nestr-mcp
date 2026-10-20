import { describe, it, expect, vi } from "vitest";
import { handleToolCall, toolDefinitions, schemas } from "../../src/tools/index.js";
import { NestrClient } from "../../src/api/client.js";
import { HELP_TOPICS } from "../../src/help/topics.js";
import { TENSION_PROCESSING_INSTRUCTIONS } from "../../src/skills/tension-processing.js";

// Behaviour an integrator could only learn by probing the live API. None of it
// is a code change; each is something the tool text did not say, and each cost
// a wrong conclusion before it was understood.

type Props = Record<string, { description?: string; enum?: unknown[] }>;
const tool = (name: string) => {
  const def = toolDefinitions.find((t) => { return t.name === name; });
  if (!def) throw new Error(`no tool ${name}`);
  return { description: def.description, props: def.inputSchema.properties as Props };
};

describe("fieldsMetaData returns the declared schema, not only the values", () => {
  // A field holding no value is exactly the one you need to see when a write
  // fails, and "field schemas" did not say those are included.
  it("get_nest says so in the parameter and the description", () => {
    const t = tool("nestr_get_nest");
    expect(t.props.fieldsMetaData.description).toMatch(/every label on the nest/i);
    expect(t.props.fieldsMetaData.description).toMatch(/no value/i);
    expect(t.description).toMatch(/every label on the nest/i);
    expect(schemas.getNest.shape.fieldsMetaData.description).toMatch(/no value/i);
  });

  it("the nest-model help topic says so", () => {
    expect(HELP_TOPICS["nest-model"]).toMatch(/including fields that hold no value/i);
  });
});

describe("field key conventions", () => {
  // A write key is <labelId>.<fieldCode>; a bare code is refused with a 422, and
  // nothing said so up front. Read keys carry a workspace prefix for workspace
  // labels and none for built-ins, and codes can contain hyphens.
  it("create and update say a write key is <labelId>.<fieldCode>", () => {
    expect(tool("nestr_create_nest").props.fields.description).toContain("<labelId>.<fieldCode>");
    expect(tool("nestr_update_nest").props.fields.description).toContain("<labelId>.<fieldCode>");
    expect(schemas.updateNest.shape.fields.description).toContain("<labelId>.<fieldCode>");
  });

  it("nest-model help explains both read-back conventions and hyphenated codes", () => {
    const t = HELP_TOPICS["nest-model"];
    expect(t).toContain("<labelId>.<fieldCode>");
    expect(t).toContain("{workspaceId}:<labelId>.<fieldCode>");
    expect(t).toMatch(/built-in labels? come back bare/i);
    expect(t).toMatch(/hyphen/i);
  });
});

describe("tension status", () => {
  // The enum is deliberately not widened here. What was missing is the fact that
  // resolving a tension is not something this tool does.
  it("keeps the enum and says resolution happens in a meeting", () => {
    const t = tool("nestr_update_tension_status");
    expect(t.props.status.enum).toEqual(["proposed", "draft"]);
    expect(t.description).toMatch(/governance meeting/i);
    expect(t.description).toContain("nestr_get_tension_status");
  });

  // The REST status route reports an objection as `escalated`.
  it("the lifecycle names the states the API reports", () => {
    expect(TENSION_PROCESSING_INSTRUCTIONS).toContain("`escalated`");
    expect(TENSION_PROCESSING_INSTRUCTIONS).not.toContain("`objected`");
  });
});

describe("create_nest and the automatic task label", () => {
  it("says a completable nest gains `task` unless a label opts out", () => {
    const d = tool("nestr_create_nest").description;
    expect(d).toMatch(/adds a `task` label/i);
    expect(d).toContain("autoTaskLabel: false");
  });
});

describe("list_labels is a lean list", () => {
  it("says it returns only _id and title, and where the schema is", () => {
    const d = tool("nestr_list_labels").description;
    expect(d).toMatch(/only `_id` and `title`/);
    expect(d).toContain("nestr_get_label");
  });
});

// The text above says list rows are lean, and list_labels runs through the same
// compactResponse allowlist that now keeps `fields`. The REST list projects only
// these keys and translateLabel deletes a label's `fields`. The row here carries
// `fields` anyway, so the test pins the MCP's own allowlist rather than the server.
describe("nestr_list_labels rows", () => {
  it("stay _id and title", async () => {
    const body = {
      status: "success",
      meta: { total: 1 },
      data: [{ _id: "agent", title: "Agent", workspaceId: "ws-1", fields: { "agent.model": { type: "text" } }, createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-02T00:00:00.000Z" }],
    };
    vi.stubGlobal("fetch", vi.fn(async () => {
      return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
    }));
    try {
      const client = new NestrClient({ apiKey: "t", baseUrl: "https://api.test.io/api" });
      const result = await handleToolCall(client, "nestr_list_labels", { workspaceId: "ws-1" });
      const out = JSON.parse(result.content[0].text);
      expect(Object.keys(out.data[0]).sort()).toEqual(["_id", "title"]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
