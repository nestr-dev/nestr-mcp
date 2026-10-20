import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { handleToolCall, toolDefinitions } from "../../src/tools/index.js";
import { NestrClient } from "../../src/api/client.js";

// Every nest-shaped REST write answers { status, data: <object>, warnings? }, and
// the MCP passes that through under a per-tool key: { message, nest: { status,
// data } } for create_nest, { message, post: {...} } for add_comment, and so on.
// No read uses that shape, and the key differs per tool, so a typed client that
// unwraps a top-level `data` decoded the result into an empty object with no
// error and lost the id of what it had just written.
//
// The existing keys stay, so a client peeling by key keeps working. Each result
// now also carries a top-level `_id`, the id of the written object, and each
// tool's description states the shape.
//
// Bodies here are what the REST routes send: the envelope, with the object
// under `data`. A stub that answers with a bare object tests a server that does
// not exist, and that is how this went unnoticed.
function envelope(data: Record<string, unknown>) {
  return { status: "success", data };
}

// A written nest as translateNest returns it: its own `data` store and `fields`
// both hold objects, so a generic "take the first object" peel would land in one
// of them and lose the id.
const NEST = {
  _id: "nest-new-1",
  title: "Inbox event",
  parentId: "parent-1",
  labels: ["inbox_event", "task"],
  fields: { "ws-1:inbox_event.source": "github" },
  data: { "mcp.lastSync": "2026-08-07" },
};

type Case = [tool: string, args: Record<string, unknown>, key: string, id: string, body: unknown];

const cases: Case[] = [
  ["nestr_create_nest", { parentId: "parent-1", title: "Inbox event", labels: ["inbox_event"] }, "nest", "nest-new-1", envelope(NEST)],
  ["nestr_create_nest", { parentId: "circle-1", title: "Scribe", labels: ["role"], accountabilities: ["Take notes"], workspaceId: "ws-1" }, "nest", "role-1", envelope({ _id: "role-1", title: "Scribe", labels: ["role"] })],
  ["nestr_update_nest", { nestId: "nest-new-1", title: "Renamed" }, "nest", "nest-new-1", envelope(NEST)],
  ["nestr_add_comment", { nestId: "nest-new-1", body: "Done" }, "post", "post-1", envelope({ _id: "post-1", body: "Done", parentId: "nest-new-1" })],
  ["nestr_update_comment", { commentId: "post-1", body: "Edited" }, "comment", "post-1", envelope({ _id: "post-1", body: "Edited", parentId: "nest-new-1" })],
  ["nestr_create_inbox_item", { title: "Call back" }, "item", "inbox-1", envelope({ _id: "inbox-1", title: "Call back", parentId: "inbox" })],
  ["nestr_update_inbox_item", { nestId: "inbox-1", title: "Call back today" }, "item", "inbox-1", envelope({ _id: "inbox-1", title: "Call back today" })],
  ["nestr_create_personal_label", { title: "Errands" }, "label", "label-1", envelope({ _id: "label-1", title: "Errands" })],
  ["nestr_add_label", { nestId: "nest-new-1", labelId: "urgent" }, "nest", "nest-new-1", envelope(NEST)],
  ["nestr_remove_label", { nestId: "nest-new-1", labelId: "urgent" }, "nest", "nest-new-1", envelope(NEST)],
  ["nestr_create_tension", { nestId: "circle-1", title: "Notes go missing" }, "tension", "tension-1", envelope({ _id: "tension-1", title: "Notes go missing", labels: ["tension"] })],
  ["nestr_update_tension", { nestId: "circle-1", tensionId: "tension-1", title: "Notes keep going missing" }, "tension", "tension-1", envelope({ _id: "tension-1", title: "Notes keep going missing" })],
  ["nestr_add_tension_part", { nestId: "circle-1", tensionId: "tension-1", title: "Scribe", labels: ["role"] }, "part", "part-1", envelope({ _id: "part-1", sourceId: "src-1", title: "Scribe" })],
  ["nestr_modify_tension_part", { nestId: "circle-1", tensionId: "tension-1", partId: "part-1", title: "Note taker" }, "part", "part-1", envelope({ _id: "part-1", sourceId: "src-1", title: "Note taker" })],
  ["nestr_create_tension_part_child", { nestId: "circle-1", tensionId: "tension-1", partId: "part-1", title: "Take notes", labels: ["accountability"] }, "child", "child-1", envelope({ _id: "child-1", title: "Take notes" })],
  ["nestr_update_tension_part_child", { nestId: "circle-1", tensionId: "tension-1", partId: "part-1", childId: "child-1", title: "Publish notes" }, "child", "child-1", envelope({ _id: "child-1", title: "Publish notes" })],
];

describe("write tools carry the written object's _id at the top level", () => {
  let client: NestrClient;
  let body: unknown;

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
    }));
    client = new NestrClient({ apiKey: "t", baseUrl: "https://api.test.io/api" });
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it.each(cases)("%s returns the written id", async (tool, args, key, id, response) => {
    body = response;
    const result = await handleToolCall(client, tool, args);
    expect(result.isError).toBeFalsy();
    const out = JSON.parse(result.content[0].text);
    expect(out._id).toBe(id);
    // The existing keys stay exactly where clients already peel them.
    expect(typeof out.message).toBe("string");
    expect(out[key].status).toBe("success");
    expect(out[key].data._id).toBe(id);
  });

  // A bare object (a route or client method that already unwraps) still yields its id.
  it("takes the id off a bare object too", async () => {
    body = { _id: "nest-bare-1", title: "Bare", data: { "mcp.k": "v" } };
    const result = await handleToolCall(client, "nestr_update_nest", { nestId: "nest-bare-1", title: "Bare" });
    expect(JSON.parse(result.content[0].text)._id).toBe("nest-bare-1");
  });

  it.each([...new Set(cases.map(([t]) => t))].map((t) => [t]))("%s describes its response shape", (tool) => {
    const def = toolDefinitions.find((t) => { return t.name === tool; });
    expect(def?.description).toMatch(/Returns \{ message, _id, /);
  });
});

// A comment aimed at a message inside a direct message lands on the conversation,
// and add_comment says so with a `placement` note. The note read `parentId` off
// the bare post, but the route answers with the envelope, so on a real response
// it never fired and the caller kept replying to an id the comment was not on.
describe("nestr_add_comment placement note on the real response", () => {
  let client: NestrClient;

  beforeEach(() => {
    const body = envelope({ _id: "post-2", body: "Reply", parentId: "conv-1" });
    vi.stubGlobal("fetch", vi.fn(async () => {
      return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
    }));
    client = new NestrClient({ apiKey: "t", baseUrl: "https://api.test.io/api" });
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("says where the comment landed when it was moved", async () => {
    const result = await handleToolCall(client, "nestr_add_comment", { nestId: "msg-1", body: "Reply" });
    const out = JSON.parse(result.content[0].text);
    expect(out.placement).toContain("conv-1");
  });
});
