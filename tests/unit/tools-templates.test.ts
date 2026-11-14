import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { handleToolCall, toolDefinitions, translateEndpoint } from "../../src/tools/index.js";
import { NestrClient } from "../../src/api/client.js";

// Templates are nests: making or using one goes through nestr_create_nest (POST /nests), told
// apart by template / type / source, and nestr_list_templates says what may be used where.
describe("template tools", () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  let client: NestrClient;
  let sent: { url: string; method?: string; body: Record<string, unknown> };

  beforeEach(() => {
    sent = { url: "", body: {} };
    mockFetch = vi.fn(async (url: string, init: { body?: string; method?: string }) => {
      sent = { url, method: init?.method, body: JSON.parse(init?.body || "{}") };
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ _id: "n1", title: "From template", templateReport: { intent: "apply", created: 3 } }),
      };
    });
    vi.stubGlobal("fetch", mockFetch);
    client = new NestrClient({ apiKey: "t", baseUrl: "https://api.test.io/api" });
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  const call = (tool: string, args: Record<string, unknown>) => { return handleToolCall(client, tool, args); };

  it("applies a template without a title, through POST /nests", async () => {
    await call("nestr_create_nest", { parentId: "c1", template: "tpl1" });
    expect(sent.url).toBe("https://api.test.io/api/nests");
    expect(sent.method).toBe("POST");
    expect(sent.body).toEqual({ parentId: "c1", template: "tpl1" });
  });

  it("passes the dry run and role options through", async () => {
    await call("nestr_create_nest", {
      parentId: "c1", template: "tpl1", title: "Sales", dryRun: true, followTemplate: false,
    });
    expect(sent.body).toEqual({
      parentId: "c1", template: "tpl1", title: "Sales", dryRun: true, followTemplate: false,
    });
  });

  it("keeps the dates and status of the created root, and says what it ignored", async () => {
    const result = await call("nestr_create_nest", {
      parentId: "c1", template: "tpl1", due: "2026-11-20", start: "2026-11-16", completed: false,
      accountabilities: ["Extra"],
    });
    expect(sent.body).toEqual({
      parentId: "c1", template: "tpl1", due: "2026-11-20", start: "2026-11-16", completed: false,
    });
    expect(JSON.stringify(result)).toMatch(/Ignored accountabilities/);
  });

  it("captures an item as a template with type and source", async () => {
    await call("nestr_create_nest", {
      parentId: "c1", type: "template", source: "role1", governanceOnly: true,
    });
    expect(sent.body).toEqual({
      parentId: "c1", type: "template", source: "role1", governanceOnly: true,
    });
  });

  it("refuses what the API would refuse, before calling it", async () => {
    await expect(call("nestr_create_nest", { parentId: "c1", type: "template", source: "r", template: "t" }))
      .resolves.toMatchObject({ isError: true });
    await expect(call("nestr_create_nest", { parentId: "c1", source: "r" }))
      .resolves.toMatchObject({ isError: true });
    await expect(call("nestr_create_nest", { parentId: "c1", type: "temporary", title: "x" }))
      .resolves.toMatchObject({ isError: true });
    await expect(call("nestr_create_nest", { parentId: "c1" }))
      .resolves.toMatchObject({ isError: true });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("still needs a title for an ordinary create", async () => {
    await call("nestr_create_nest", { parentId: "c1", title: "Plain" });
    expect(sent.body.title).toBe("Plain");
    expect(sent.body.template).toBeUndefined();
  });

  it("lists the templates offered at a nest, narrowed by label", async () => {
    await call("nestr_list_templates", { nestId: "c1", label: ["circleplus-role", "circleplus-circle"] });
    expect(sent.url).toBe("https://api.test.io/api/nests/c1/templates?label=circleplus-role%2Ccircleplus-circle");
    await call("nestr_list_templates", { nestId: "c1", label: "circleplus-role" });
    expect(sent.url).toBe("https://api.test.io/api/nests/c1/templates?label=circleplus-role");
    await call("nestr_list_templates", { nestId: "c1" });
    expect(sent.url).toBe("https://api.test.io/api/nests/c1/templates");
  });

  it("proposes from a template through a tension part", async () => {
    await call("nestr_add_tension_part", { nestId: "c1", tensionId: "t1", template: "tpl1" });
    expect(sent.url).toBe("https://api.test.io/api/nests/c1/tensions/t1/parts");
    expect(sent.body).toEqual({ template: "tpl1" });
  });

  it("keeps template fields in hint suggestions, and maps the discovery route", () => {
    const create = translateEndpoint({
      method: "POST",
      path: "/api/nests/c1/tensions/t1/parts",
      body_example: { title: "Sales", labels: ["role"], template: "tpl1" },
    } as never);
    expect(create?.tool).toBe("nestr_add_tension_part");
    expect(create?.parametersExample).toMatchObject({ nestId: "c1", tensionId: "t1", template: "tpl1" });

    const apply = translateEndpoint({
      method: "POST", path: "/api/nests", body_example: { parentId: "c1", template: "tpl1", dryRun: true },
    } as never);
    expect(apply?.parametersExample).toEqual({ parentId: "c1", template: "tpl1", dryRun: true });

    const list = translateEndpoint({ method: "GET", path: "/api/nests/c1/templates?label=role" } as never);
    expect(list?.tool).toBe("nestr_list_templates");
    expect(list?.parametersExample).toEqual({ nestId: "c1", label: "role" });
  });

  it("advertises the new parameters and tool, so a model can find them", () => {
    const create = toolDefinitions.find((t) => { return t.name === "nestr_create_nest"; });
    const props = create?.inputSchema.properties as Record<string, { description?: string; enum?: string[] }>;
    expect(props.template.description).toContain("nestr_list_templates");
    expect(props.type.enum).toEqual(["template"]);
    expect(props.source).toBeTruthy();
    expect(create?.inputSchema.required).toEqual(["parentId"]);
    const list = toolDefinitions.find((t) => { return t.name === "nestr_list_templates"; });
    expect(list?.inputSchema.required).toEqual(["nestId"]);
    const part = toolDefinitions.find((t) => { return t.name === "nestr_add_tension_part"; });
    expect((part?.inputSchema.properties as Record<string, unknown>).template).toBeTruthy();
  });
});
