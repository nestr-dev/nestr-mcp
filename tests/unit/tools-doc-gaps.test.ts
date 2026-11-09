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

  // `proposed` is not always a vote: the server enacts at once when nobody else
  // would be asked for consent.
  it("says proposing can enact at once, and when", () => {
    const d = tool("nestr_update_tension_status").description;
    expect(d).toMatch(/single-member circle/i);
    expect(d).toMatch(/only assignee/i);
    expect(d).toContain("enacted");
    expect(TENSION_PROCESSING_INSTRUCTIONS).toMatch(/single-member circle/i);
  });

  // The route answers { status, data: { status: "enacted", message } } when it
  // enacted on the spot, and the tool must not report that as a mere submission.
  it("reports an immediate enactment as such", async () => {
    const body = { status: "success", data: { status: "enacted", message: "Proposal has been automatically enacted (single-member circle)" } };
    vi.stubGlobal("fetch", vi.fn(async () => {
      return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
    }));
    try {
      const client = new NestrClient({ apiKey: "t", baseUrl: "https://api.test.io/api" });
      const result = await handleToolCall(client, "nestr_update_tension_status", { nestId: "circle-1", tensionId: "t-1", status: "proposed" });
      const out = JSON.parse(result.content[0].text);
      expect(out.message).toMatch(/enacted/i);
      expect(out.message).toContain("single-member circle");
    } finally {
      vi.unstubAllGlobals();
    }
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
    // get_label answers with `display`; there is no `properties` key.
    expect(d).toContain("`display`");
    expect(d).not.toMatch(/properties/);
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

// A search that returned 50 of 137 rows, with the one filter the server could
// not apply dropped, and said neither. The API reported both; the MCP's own
// response shaping discarded them, so the tool text promising `meta.total`
// described something no caller could read.
describe("nestr_search reports how complete its answer is", () => {
  const envelope = {
    status: "success",
    meta: { per_page: 50, total: 137, page: 1, total_pages: 3 },
    searchWarnings: [
      { code: "unknown_operator", message: "Unknown search operator 'project.status:'. This term was ignored." },
    ],
    data: [{ _id: "n1", title: "A project", labels: ["project"] }],
  };

  const callSearch = async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      return { ok: true, status: 200, json: async () => envelope, text: async () => JSON.stringify(envelope) };
    }));
    try {
      const client = new NestrClient({ apiKey: "t", baseUrl: "https://api.test.io/api" });
      const result = await handleToolCall(client, "nestr_search", { workspaceId: "ws-1", query: "label:project project.status:Future" });
      return JSON.parse(result.content[0].text);
    } finally {
      vi.unstubAllGlobals();
    }
  };

  it("carries meta.total through, not the page size", async () => {
    const out = await callSearch();
    expect(out.meta.total).toBe(137);
    expect(out.meta.total_pages).toBe(3);
  });

  it("says the result is partial without the caller doing arithmetic", async () => {
    const out = await callSearch();
    expect(out.hasMore).toBe(true);
    expect(out.nextPage).toBe(2);
  });

  it("names the filter the server could not apply", async () => {
    const out = await callSearch();
    expect(out.searchWarnings).toHaveLength(1);
    expect(out.searchWarnings[0].message).toContain("project.status:");
  });

  it("still returns the rows", async () => {
    const out = await callSearch();
    expect(out.items).toHaveLength(1);
    expect(out.items[0]._id).toBe("n1");
    expect(out.items[0].title).toBe("A project");
  });

  it("the tool text names the keys that say so", () => {
    const d = tool("nestr_search").description;
    expect(d).toContain("meta.total");
    expect(d).toContain("hasMore");
    expect(d).toContain("searchWarnings");
  });

  // strict used to be the only way to find out a filter was dropped, so its
  // text said so. A warning now arrives either way, and the text has to say
  // what strict still adds: a refusal instead of a wider answer.
  it("strict says what it adds now that a warning arrives either way", () => {
    const d = tool("nestr_search").props.strict.description ?? "";
    expect(d).toContain("searchWarnings");
    expect(d).toMatch(/reject/i);
  });

  it("limit says it clamps, where a caller reads it", () => {
    expect(tool("nestr_search").props.limit.description).toMatch(/maximum 50/i);
    expect(tool("nestr_get_nest_children").props.limit.description).toMatch(/maximum 50/i);
  });
});

// in: was reachable but its syntax was written down nowhere a caller would
// find it: the tool description named the operator and stopped. A multi-id
// value silently matched nothing, and no document said whether it was meant to.
describe("in: syntax is written down", () => {
  it("the search help topic shows the comma form and what it means", () => {
    const t = HELP_TOPICS["search"];
    expect(t).toContain("in:id1,id2");
    expect(t).toMatch(/under any of them|any of the listed/i);
  });

  it("the search help topic says a bad in: value is refused, not answered with nothing", () => {
    const t = HELP_TOPICS["search"];
    expect(t).toMatch(/searchWarnings/);
    expect(t).toMatch(/strict:true/);
  });

  it("the tool description carries the comma form too", () => {
    expect(tool("nestr_search").description).toContain("in:id1,id2");
  });
});

// The children route applies depth:1 when the query sets no depth and says so in
// appliedDefaults, which the tool description promises. completableResponse
// discarded that key too, so the scope was narrowed with no way to find out: the
// same failure as a dropped filter, in the API's own words.
describe("nestr_get_nest_children reports a default it applied", () => {
  it("carries appliedDefaults through", async () => {
    const body = {
      status: "success",
      meta: { per_page: 50, total: 3, page: 1, total_pages: 1 },
      appliedDefaults: [{
        operator: "depth:1",
        reason: "This route returns children, so the search was scoped to direct children.",
        override: "Set a depth yourself to reach further.",
      }],
      data: [{ _id: "c1", title: "A child" }],
    };
    vi.stubGlobal("fetch", vi.fn(async () => {
      return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
    }));
    try {
      const client = new NestrClient({ apiKey: "t", baseUrl: "https://api.test.io/api" });
      const result = await handleToolCall(client, "nestr_get_nest_children", { nestId: "n1", search: "label:project" });
      const out = JSON.parse(result.content[0].text);
      expect(out.appliedDefaults).toHaveLength(1);
      expect(out.appliedDefaults[0].operator).toBe("depth:1");
      expect(out.meta.total).toBe(3);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
