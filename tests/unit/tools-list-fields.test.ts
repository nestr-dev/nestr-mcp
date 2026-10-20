import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { handleToolCall, compactResponse } from "../../src/tools/index.js";
import { NestrClient } from "../../src/api/client.js";

// The REST list routes (search, children, projects, tensions) run every row
// through translateNest, which emits a `fields` object whenever a label on the
// nest declares fields with values. The MCP's compactResponse then kept only an
// allowlist that did not include `fields`, so every list row arrived without
// one. An integrator that read a status or a channel id off a search row got
// nothing, with no error, and four of its filters starved in silence.
//
// The fixtures below are the REST envelope as the server sends it, `fields`
// included. A fixture that hand-adds `fields` after the fact, or leaves the
// envelope out, tests a server that does not exist.
const ROW = {
  _id: "nest-prog-1",
  title: "Program A",
  parentId: "circle-1",
  ancestors: ["ws-1", "circle-1"],
  path: "Workspace / Circle",
  url: "/n/nest-prog-1",
  labels: ["program", "project"],
  users: ["user-1"],
  completed: false,
  due: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-08-01T10:00:00.000Z",
  description: "<p>Line one</p><p>Line two</p>",
  fields: {
    "project.status": "Waiting",
    "ws-1:program.slack-channel": "C0000000",
  },
};

const LIST_ENVELOPE = {
  status: "success",
  meta: { total: 1 },
  data: [ROW],
};

function mockResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

describe("list rows keep the fields the server sent", () => {
  let client: NestrClient;

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => mockResponse(LIST_ENVELOPE)));
    client = new NestrClient({ apiKey: "t", baseUrl: "https://api.test.io/api" });
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  const call = async (tool: string, args: Record<string, unknown>) => {
    const result = await handleToolCall(client, tool, args);
    expect(result.isError).toBeFalsy();
    return JSON.parse(result.content[0].text);
  };

  it("nestr_search rows carry fields", async () => {
    const out = await call("nestr_search", { workspaceId: "ws-1", query: "label:program" });
    expect(out.items[0].fields).toEqual(ROW.fields);
  });

  it("nestr_get_nest_children rows carry fields", async () => {
    const out = await call("nestr_get_nest_children", { nestId: "circle-1" });
    expect(out.items[0].fields).toEqual(ROW.fields);
  });

  it("nestr_get_projects rows carry fields", async () => {
    const out = await call("nestr_get_projects", { workspaceId: "ws-1" });
    expect(out.items[0].fields).toEqual(ROW.fields);
  });

  it("nestr_list_tensions rows carry fields", async () => {
    const tension = { ...ROW, labels: ["tension"], fields: { "tension.feeling": "Worried" } };
    vi.stubGlobal("fetch", vi.fn(async () => mockResponse({ status: "success", data: [tension] })));
    const out = await call("nestr_list_tensions", { nestId: "circle-1" });
    expect(out.data[0].fields).toEqual({ "tension.feeling": "Worried" });
  });

  // The allowlist is still an allowlist: keeping fields must not let the rest through.
  it("still drops keys outside the compact set", async () => {
    const out = await call("nestr_search", { workspaceId: "ws-1", query: "label:program" });
    expect(out.items[0]).not.toHaveProperty("updatedAt");
  });
});

// `fields` is kept for nest rows only. A label's `fields` is its field schema and a
// user is not a nest, so neither row type may widen because nest rows did.
describe("label and user rows still drop fields", () => {
  it.each(["label", "user"] as const)("%s rows", (type) => {
    const rows = compactResponse([{ _id: "x", title: "X", username: "x", fields: { code: { type: "text" } } }], type) as Record<string, unknown>[];
    expect(rows[0]).not.toHaveProperty("fields");
  });
});
