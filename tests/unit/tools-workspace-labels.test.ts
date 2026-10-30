import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { handleToolCall, toolDefinitions } from "../../src/tools/index.js";
import { NestrClient } from "../../src/api/client.js";

// Workspace label write tools: nestr_create_label (POST /workspaces/{id}/labels),
// nestr_update_label (PATCH /workspaces/{id}/labels/{labelId}) and
// nestr_delete_label (DELETE on the same route). The routes are workspace-admin
// only and refuse system labels, tag-alongs and other workspaces' labels; what
// matters here is that each tool sends exactly the request the route expects,
// refuses what it cannot send before anything leaves, and that delete cannot
// happen without an explicit confirmation.

function mockResponse(status: number, body: unknown) {
  return {
    ok: status < 400,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

const envelope = (data: Record<string, unknown>) => ({ status: "success", data });
const parse = (text: string) => JSON.parse(text) as Record<string, unknown>;

describe("workspace label write tools", () => {
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

  describe("nestr_create_label", () => {
    it("POSTs the label to the workspace, colour and icon as display properties", async () => {
      mockFetch.mockResolvedValue(mockResponse(200, envelope({ _id: "review", title: "Review" })));

      const result = await call("nestr_create_label", {
        workspaceId: "ws1",
        title: "Review",
        labelId: "review",
        color: "#FF5733",
        icon: "eye",
        group: "process",
        fields: [{ id: "reviewer", code: "reviewer", title: "Reviewer", type: "text" }],
      });
      expect(result.isError).toBeFalsy();

      expect(sent()).toEqual({
        url: "https://api.test.io/api/workspaces/ws1/labels",
        method: "POST",
        body: {
          _id: "review",
          title: "Review",
          group: "process",
          properties: { color: "#FF5733", icon: "eye" },
          fields: [{ id: "reviewer", code: "reviewer", title: "Reviewer", type: "text" }],
        },
      });
      const parsed = parse(result.content[0].text);
      expect(parsed._id).toBe("review");
      expect(parsed.label).toEqual(envelope({ _id: "review", title: "Review" }));
    });

    it("sends only the title when that is all it is given", async () => {
      mockFetch.mockResolvedValue(mockResponse(200, envelope({ _id: "triage", title: "Triage" })));
      await call("nestr_create_label", { workspaceId: "ws1", title: "Triage" });
      expect(sent().body).toEqual({ title: "Triage" });
    });

    it("accepts fields as a JSON string, as clients that cannot send arrays do", async () => {
      mockFetch.mockResolvedValue(mockResponse(200, envelope({ _id: "triage", title: "Triage" })));
      await call("nestr_create_label", {
        workspaceId: "ws1", title: "Triage", fields: '[{"id":"a","code":"a","title":"A","type":"text"}]',
      });
      expect(sent().body.fields).toEqual([{ id: "a", code: "a", title: "A", type: "text" }]);
    });

    it("requires a workspaceId and a title", async () => {
      for (const args of [{ title: "Review" }, { workspaceId: "ws1" }, { workspaceId: "ws1", title: "" }]) {
        const result = await call("nestr_create_label", args);
        expect(result.isError).toBe(true);
        expect(parse(result.content[0].text).code).toBe("VALIDATION");
      }
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("passes the route's admin refusal through as it was given", async () => {
      mockFetch.mockResolvedValue(mockResponse(403, {
        status: "error", message: "Workspace admin access is required to create, edit or delete workspace labels",
      }));
      const result = await call("nestr_create_label", { workspaceId: "ws1", title: "Review" });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatch(/Workspace admin access is required/);
    });
  });

  describe("nestr_update_label", () => {
    it("PATCHes only what was sent to the label's route", async () => {
      mockFetch.mockResolvedValue(mockResponse(200, envelope({ _id: "review", title: "To review" })));

      const result = await call("nestr_update_label", {
        workspaceId: "ws1", labelId: "review", title: "To review", icon: null,
      });
      expect(result.isError).toBeFalsy();
      expect(sent()).toEqual({
        url: "https://api.test.io/api/workspaces/ws1/labels/review",
        method: "PATCH",
        body: { title: "To review", icon: null },
      });
      const parsed = parse(result.content[0].text);
      expect(parsed._id).toBe("review");
      expect(parsed.label).toEqual(envelope({ _id: "review", title: "To review" }));
    });

    it("carries color, group, properties and fields through under the API's names", async () => {
      mockFetch.mockResolvedValue(mockResponse(200, envelope({ _id: "review", title: "Review" })));
      await call("nestr_update_label", {
        workspaceId: "ws1",
        labelId: "review",
        color: "#00AA00",
        group: "process",
        properties: '{"completable":false}',
        fields: [{ id: "a", code: "a", title: "A", type: "text" }],
      });
      expect(sent().body).toEqual({
        color: "#00AA00",
        group: "process",
        properties: { completable: false },
        fields: [{ id: "a", code: "a", title: "A", type: "text" }],
      });
    });

    it("refuses an update with nothing to change before a request goes out", async () => {
      const result = await call("nestr_update_label", { workspaceId: "ws1", labelId: "review" });
      expect(result.isError).toBe(true);
      expect(parse(result.content[0].text).message).toMatch(/Nothing to update/);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("refuses a key it does not list rather than dropping it", async () => {
      // Alongside a key it does list: stripped, the title alone would go out and the
      // call would report success for a description that was never sent.
      const result = await call("nestr_update_label", {
        workspaceId: "ws1", labelId: "review", title: "Review", description: "Words",
      });
      expect(result.isError).toBe(true);
      expect(parse(result.content[0].text).code).toBe("VALIDATION");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("sets aside the context argument MCPcat adds, so the strict schema does not refuse it", async () => {
      mockFetch.mockResolvedValue(mockResponse(200, envelope({ _id: "review", title: "Renamed" })));
      const result = await call("nestr_update_label", {
        workspaceId: "ws1", labelId: "review", title: "Renamed", context: "rename the review label",
      });
      expect(result.isError).toBeFalsy();
      expect(sent().body).toEqual({ title: "Renamed" });
    });

    it("refuses a label id that would step out of the label's route", async () => {
      for (const labelId of ["../../nests/abc", "a/b", "a?b", ""]) {
        const result = await call("nestr_update_label", { workspaceId: "ws1", labelId, title: "X" });
        expect(result.isError).toBe(true);
      }
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("nestr_delete_label", () => {
    it("DELETEs the label once confirm is true", async () => {
      mockFetch.mockResolvedValue(mockResponse(200, envelope({ _id: "review", deleted: true })));

      const result = await call("nestr_delete_label", { workspaceId: "ws1", labelId: "review", confirm: true });
      expect(result.isError).toBeFalsy();
      expect(sent()).toEqual({
        url: "https://api.test.io/api/workspaces/ws1/labels/review",
        method: "DELETE",
        body: undefined,
      });
      const parsed = parse(result.content[0].text);
      expect(parsed._id).toBe("review");
      expect(String(parsed.message)).toMatch(/deleted/);
    });

    it.each([
      ["missing", {}],
      ["false", { confirm: false }],
      ["the string 'true'", { confirm: "true" }],
      ["1", { confirm: 1 }],
    ])("refuses without an explicit confirm: true (%s), and sends nothing", async (_label, extra) => {
      const result = await call("nestr_delete_label", { workspaceId: "ws1", labelId: "review", ...extra });
      expect(result.isError).toBe(true);
      expect(parse(result.content[0].text).code).toBe("VALIDATION");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("refuses a label id that would step out of the label's route", async () => {
      const result = await call("nestr_delete_label", { workspaceId: "ws1", labelId: "../../nests/abc", confirm: true });
      expect(result.isError).toBe(true);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("passes a system-label refusal through as the route gave it", async () => {
      mockFetch.mockResolvedValue(mockResponse(422, {
        status: "error", message: 'Label project is the system label "Project". System labels cannot be deleted through the API',
      }));
      const result = await call("nestr_delete_label", { workspaceId: "ws1", labelId: "project", confirm: true });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatch(/system label/);
    });
  });

  describe("advertised definitions", () => {
    const def = (name: string) => {
      const tool = toolDefinitions.find((t) => t.name === name);
      if (!tool) throw new Error(`no advertised tool named ${name}`);
      return tool as unknown as {
        description: string;
        inputSchema: { properties: Record<string, unknown>; required?: string[] };
        annotations: { destructiveHint: boolean; readOnlyHint: boolean };
      };
    };

    it("say workspace admin rights are needed", () => {
      for (const name of ["nestr_create_label", "nestr_update_label", "nestr_delete_label"]) {
        expect(def(name).description).toMatch(/workspace admin/i);
      }
    });

    it("require the confirmation on delete and mark it destructive", () => {
      expect(def("nestr_delete_label").inputSchema.required).toEqual(["workspaceId", "labelId", "confirm"]);
      expect(def("nestr_delete_label").annotations.destructiveHint).toBe(true);
    });

    it("require the same ids as nestr_get_label", () => {
      expect(def("nestr_update_label").inputSchema.required).toEqual(["workspaceId", "labelId"]);
      expect(def("nestr_create_label").inputSchema.required).toEqual(["workspaceId", "title"]);
    });
  });
});
