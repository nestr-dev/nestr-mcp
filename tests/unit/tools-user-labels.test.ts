import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { handleToolCall, toolDefinitions, READONLY_TOOL_NAMES, compactResponse } from "../../src/tools/index.js";
import { NestrClient } from "../../src/api/client.js";

// User labels: labels that apply to people, with per-user field values.
function mockResponse(status: number, body: unknown) {
  return {
    ok: status < 400,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

const result = (changed = true) => ({
  status: "success",
  data: { userId: "u1", label: "legal_rep", changed, labels: ["legal_rep"], fields: { "legal_rep.register": "https://example.com/r/1" } },
});
const parse = (text: string) => JSON.parse(text) as Record<string, any>;

describe("user label tools", () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  let client: NestrClient;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    client = new NestrClient({ apiKey: "test-token", baseUrl: "https://api.test.io/api" });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const call = (name: string, args: Record<string, unknown>) => handleToolCall(client, name, args);
  const sent = () => {
    const [url, opts] = mockFetch.mock.calls[0];
    return { url, method: opts.method, body: opts.body === undefined ? undefined : JSON.parse(opts.body) };
  };

  describe("nestr_add_user_label", () => {
    it("POSTs the label with its fields", async () => {
      mockFetch.mockResolvedValue(mockResponse(200, result()));
      const out = await call("nestr_add_user_label", {
        workspaceId: "ws1", userId: "u1", labelId: "legal_rep", fields: { register: "https://example.com/r/1" },
      });
      expect(out.isError).toBeFalsy();
      expect(sent()).toEqual({
        url: "https://api.test.io/api/workspaces/ws1/users/u1/labels/legal_rep",
        method: "POST",
        body: { fields: { register: "https://example.com/r/1" } },
      });
      expect(parse(out.content[0].text).userLabel.data.changed).toBe(true);
    });

    it("sends no body when no fields are given", async () => {
      mockFetch.mockResolvedValue(mockResponse(200, result(false)));
      await call("nestr_add_user_label", { workspaceId: "ws1", userId: "u1", labelId: "skill_coding" });
      expect(sent().method).toBe("POST");
      expect(sent().body).toBeUndefined();
    });

    it("accepts fields as a JSON string", async () => {
      mockFetch.mockResolvedValue(mockResponse(200, result()));
      await call("nestr_add_user_label", { workspaceId: "ws1", userId: "u1", labelId: "skill_coding", fields: '{"level":"3"}' });
      expect(sent().body).toEqual({ fields: { level: "3" } });
    });

    it("encodes a qualified label id", async () => {
      mockFetch.mockResolvedValue(mockResponse(200, result()));
      await call("nestr_add_user_label", { workspaceId: "ws1", userId: "u1", labelId: "ws1:legal_rep" });
      expect(sent().url).toBe("https://api.test.io/api/workspaces/ws1/users/u1/labels/ws1%3Alegal_rep");
    });

    it("passes a 403 through", async () => {
      mockFetch.mockResolvedValue(mockResponse(403, { status: "error", error: "not-authorized", message: "Not allowed" }));
      const out = await call("nestr_add_user_label", { workspaceId: "ws1", userId: "u1", labelId: "legal_rep" });
      expect(out.isError).toBe(true);
      expect(out.content[0].text).toMatch(/not allowed|not-authorized/i);
    });

    it("passes a 400 through", async () => {
      mockFetch.mockResolvedValue(mockResponse(400, { status: "error", error: "label-not-applicable", message: "Label does not apply to users" }));
      const out = await call("nestr_add_user_label", { workspaceId: "ws1", userId: "u1", labelId: "project" });
      expect(out.isError).toBe(true);
      expect(out.content[0].text).toMatch(/does not apply to users|label-not-applicable/);
    });
  });

  describe("nestr_update_user_label_fields", () => {
    it("PATCHes the fields", async () => {
      mockFetch.mockResolvedValue(mockResponse(200, result()));
      await call("nestr_update_user_label_fields", {
        workspaceId: "ws1", userId: "u1", labelId: "skill_coding", fields: { level: "4", notes: null },
      });
      expect(sent()).toEqual({
        url: "https://api.test.io/api/workspaces/ws1/users/u1/labels/skill_coding",
        method: "PATCH",
        body: { fields: { level: "4", notes: null } },
      });
    });

    it("requires fields", async () => {
      const out = await call("nestr_update_user_label_fields", { workspaceId: "ws1", userId: "u1", labelId: "skill_coding" });
      expect(out.isError).toBe(true);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("passes a 400 through", async () => {
      mockFetch.mockResolvedValue(mockResponse(400, { status: "error", error: "unknown-field", message: "Unknown field nope" }));
      const out = await call("nestr_update_user_label_fields", { workspaceId: "ws1", userId: "u1", labelId: "skill_coding", fields: { nope: 1 } });
      expect(out.isError).toBe(true);
      expect(out.content[0].text).toMatch(/Unknown field|unknown-field/);
    });
  });

  describe("nestr_remove_user_label", () => {
    it("DELETEs the label from the member", async () => {
      mockFetch.mockResolvedValue(mockResponse(200, result()));
      const out = await call("nestr_remove_user_label", { workspaceId: "ws1", userId: "u1", labelId: "legal_rep" });
      expect(out.isError).toBeFalsy();
      expect(sent()).toEqual({
        url: "https://api.test.io/api/workspaces/ws1/users/u1/labels/legal_rep",
        method: "DELETE",
        body: undefined,
      });
    });

    it("passes a 404 through", async () => {
      mockFetch.mockResolvedValue(mockResponse(404, { status: "error", error: "not-member", message: "Not a member" }));
      const out = await call("nestr_remove_user_label", { workspaceId: "ws1", userId: "u9", labelId: "legal_rep" });
      expect(out.isError).toBe(true);
    });
  });

  describe("nestr_get_user_label_activity", () => {
    it("GETs the audit trail with a limit", async () => {
      mockFetch.mockResolvedValue(mockResponse(200, { status: "success", data: [{ _id: "a1", verb: "userLabel.added", label: "legal_rep", userId: "u1" }] }));
      const out = await call("nestr_get_user_label_activity", { workspaceId: "ws1", userId: "u1", limit: 10 });
      expect(sent()).toEqual({
        url: "https://api.test.io/api/workspaces/ws1/users/u1/labels/activity?limit=10",
        method: undefined,
        body: undefined,
      });
      expect(parse(out.content[0].text).data[0].verb).toBe("userLabel.added");
    });

    it("omits the query without a limit and passes a 403 through", async () => {
      mockFetch.mockResolvedValue(mockResponse(403, { status: "error", error: "not-authorized", message: "Admins only" }));
      const out = await call("nestr_get_user_label_activity", { workspaceId: "ws1", userId: "u1" });
      expect(sent().url).toBe("https://api.test.io/api/workspaces/ws1/users/u1/labels/activity");
      expect(out.isError).toBe(true);
    });

    it("rejects a limit above 100", async () => {
      const out = await call("nestr_get_user_label_activity", { workspaceId: "ws1", userId: "u1", limit: 500 });
      expect(out.isError).toBe(true);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("reading people", () => {
    it("nestr_list_users sends the label filter and keeps labels and fields", async () => {
      const row = { _id: "u1", username: "a@example.com", labels: ["legal_rep"], fields: { "legal_rep.register": "https://example.com/r/1" }, secret: "x" };
      mockFetch.mockResolvedValue(mockResponse(200, { status: "success", data: [row] }));
      const out = await call("nestr_list_users", { workspaceId: "ws1", label: "legal_rep" });
      expect(sent().url).toBe("https://api.test.io/api/workspaces/ws1/users?label=legal_rep");
      const users = parse(out.content[0].text).data;
      expect(users[0].labels).toEqual(["legal_rep"]);
      expect(users[0].fields).toEqual({ "legal_rep.register": "https://example.com/r/1" });
      expect(users[0].secret).toBeUndefined();
    });

    it("compactResponse keeps a user's fields", () => {
      const out = compactResponse([{ _id: "u1", fields: { "skill_coding.level": "3" } }], "user") as any[];
      expect(out[0].fields).toEqual({ "skill_coding.level": "3" });
    });

    it("nestr_get_user passes labels and fields through", async () => {
      mockFetch.mockResolvedValue(mockResponse(200, { _id: "u1", labels: ["skill_coding"], fields: { "skill_coding.level": "3" } }));
      const out = await call("nestr_get_user", { workspaceId: "ws1", userId: "u1" });
      expect(parse(out.content[0].text).fields).toEqual({ "skill_coding.level": "3" });
    });

    it("nestr_get_me passes userLabels through", async () => {
      const userLabels = { ws1: { labels: ["skill_coding"], fields: { "skill_coding.level": "3" } } };
      mockFetch.mockResolvedValue(mockResponse(200, { _id: "u1", username: "a@example.com", userLabels }));
      const out = await call("nestr_get_me", {});
      expect(parse(out.content[0].text).user.userLabels).toEqual(userLabels);
    });
  });

  describe("workspace label definitions", () => {
    it("nestr_create_label passes applicableTo and userFields", async () => {
      mockFetch.mockResolvedValue(mockResponse(200, { status: "success", data: { _id: "legal_rep", title: "Legal rep" } }));
      const userFields = [{ id: "register", code: "register", title: "Register", type: "url" }];
      await call("nestr_create_label", { workspaceId: "ws1", title: "Legal rep", applicableTo: ["users"], userFields });
      expect(sent().body).toEqual({ title: "Legal rep", applicableTo: ["users"], userFields });
    });

    it("nestr_update_label passes applicableTo and userFields, including null resets", async () => {
      mockFetch.mockResolvedValue(mockResponse(200, { status: "success", data: { _id: "legal_rep", title: "Legal rep" } }));
      await call("nestr_update_label", { workspaceId: "ws1", labelId: "legal_rep", applicableTo: null, userFields: null });
      expect(sent()).toMatchObject({ method: "PATCH", body: { applicableTo: null, userFields: null } });
    });

    it("rejects an unknown subject before sending", async () => {
      const out = await call("nestr_update_label", { workspaceId: "ws1", labelId: "legal_rep", applicableTo: ["teams"] });
      expect(out.isError).toBe(true);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("passes a 400 from the API through", async () => {
      mockFetch.mockResolvedValue(mockResponse(400, { status: "error", error: "invalid", message: "Unknown userFields type" }));
      const out = await call("nestr_create_label", { workspaceId: "ws1", title: "X", userFields: [{ id: "a", type: "bogus" }] });
      expect(out.isError).toBe(true);
    });
  });

  describe("advertised definitions", () => {
    const def = (name: string) => {
      const tool = toolDefinitions.find((t) => t.name === name) as any;
      if (!tool) throw new Error(`no tool ${name}`);
      return tool;
    };

    it("classifies writes and the audit read", () => {
      for (const name of ["nestr_add_user_label", "nestr_update_user_label_fields"]) {
        expect(def(name).annotations).toEqual({ readOnlyHint: false, destructiveHint: false });
        expect(READONLY_TOOL_NAMES.has(name)).toBe(false);
      }
      expect(def("nestr_remove_user_label").annotations.destructiveHint).toBe(true);
      expect(READONLY_TOOL_NAMES.has("nestr_remove_user_label")).toBe(false);
      expect(READONLY_TOOL_NAMES.has("nestr_get_user_label_activity")).toBe(true);
    });

    it("states the audit route is admin only and writes default to admins", () => {
      expect(def("nestr_get_user_label_activity").description).toMatch(/admin/i);
      expect(def("nestr_add_user_label").description).toMatch(/cannot edit their own/);
    });

    it("exposes the new label and list arguments", () => {
      expect(def("nestr_list_users").inputSchema.properties.label).toBeDefined();
      for (const name of ["nestr_create_label", "nestr_update_label"]) {
        expect(def(name).inputSchema.properties.applicableTo).toBeDefined();
        expect(def(name).inputSchema.properties.userFields).toBeDefined();
      }
    });

    it("write tool descriptions contain no em dashes", () => {
      for (const name of ["nestr_add_user_label", "nestr_update_user_label_fields", "nestr_remove_user_label", "nestr_get_user_label_activity"]) {
        expect(def(name).description).not.toContain("—");
      }
    });
  });
});
