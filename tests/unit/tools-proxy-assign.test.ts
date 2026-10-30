import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { handleToolCall, toolDefinitions } from "../../src/tools/index.js";
import { NestrClient } from "../../src/api/client.js";

// proxyAssign is a nest property the API applies the way the assign dialog does. A
// 'proxyAssign' graph link written directly only looked assigned, so the tools send the
// property and the graph tools say which links the server refuses.
describe("proxyAssign on the nest tools", () => {
  let client: NestrClient;
  let sentBody: Record<string, unknown>;

  beforeEach(() => {
    sentBody = {};
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: { body?: string }) => {
      sentBody = JSON.parse(init?.body || "{}");
      const body = { status: "success", data: { _id: "n1", title: "Proxied", proxyAssign: "role-1" } };
      return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
    }));
    client = new NestrClient({ apiKey: "t", baseUrl: "https://api.test.io/api" });
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  const properties = (name: string) => {
    const tool = toolDefinitions.find((t) => { return t.name === name; });
    return tool?.inputSchema.properties as Record<string, { type?: unknown; description?: string }>;
  };

  it("nestr_update_nest sends proxyAssign", async () => {
    const result = await handleToolCall(client, "nestr_update_nest", { nestId: "n1", proxyAssign: "role-1" });
    expect(result.isError).toBeFalsy();
    expect(sentBody.proxyAssign).toBe("role-1");
  });

  it("nestr_update_nest sends proxyAssign: null to clear it", async () => {
    const result = await handleToolCall(client, "nestr_update_nest", { nestId: "n1", proxyAssign: null });
    expect(result.isError).toBeFalsy();
    expect("proxyAssign" in sentBody).toBe(true);
    expect(sentBody.proxyAssign).toBeNull();
  });

  it("leaves proxyAssign out when it is not passed", async () => {
    await handleToolCall(client, "nestr_update_nest", { nestId: "n1", title: "Renamed" });
    expect("proxyAssign" in sentBody).toBe(false);
  });

  it("nestr_create_nest sends proxyAssign", async () => {
    const result = await handleToolCall(client, "nestr_create_nest", {
      parentId: "project-1", title: "Proxied", proxyAssign: "role-1",
    });
    expect(result.isError).toBeFalsy();
    expect(sentBody.proxyAssign).toBe("role-1");
  });

  it("nestr_update_occurrence sends proxyAssign", async () => {
    const result = await handleToolCall(client, "nestr_update_occurrence", {
      nestId: "n1", instant: "2026-09-01T09:00:00.000Z", proxyAssign: "role-1",
    });
    expect(result.isError).toBeFalsy();
    expect(sentBody.proxyAssign).toBe("role-1");
  });

  it("advertises proxyAssign as nullable on update and plain on create", () => {
    expect(properties("nestr_update_nest").proxyAssign.type).toEqual(["string", "null"]);
    expect(properties("nestr_create_nest").proxyAssign.type).toBe("string");
    expect(properties("nestr_update_nest").proxyAssign.description).toMatch(/null/);
  });

  it("the graph tools name the links the server refuses and what to set instead", () => {
    for (const name of ["nestr_add_graph_link", "nestr_remove_graph_link"]) {
      const tool = toolDefinitions.find((t) => { return t.name === name; });
      expect(tool?.description).toMatch(/refused/);
      expect(tool?.description).toContain("tension.meeting");
    }
    const add = toolDefinitions.find((t) => { return t.name === "nestr_add_graph_link"; });
    expect(add?.description).toContain("proxyAssign");
  });
});
