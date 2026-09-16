import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { handleToolCall, toolDefinitions } from "../../src/tools/index.js";
import { NestrClient } from "../../src/api/client.js";

/**
 * nestr_workspace_docs: the index, a search, a document read, and the
 * workspace resolution all four share.
 *
 * The bare call is load-bearing rather than a nicety. An agent run receives the
 * document index in its dispatch payload, but a Claude.ai user never sees that
 * payload, so calling with no arguments is their only route to discovering the
 * documents exist at all.
 */
describe("nestr_workspace_docs", () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  let client: NestrClient;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    client = new NestrClient({ apiKey: "test", baseUrl: "https://api.test.io/api" });
  });

  afterEach(() => { vi.unstubAllGlobals(); });

  const json = (data: unknown) => ({
    ok: true, status: 200, statusText: "OK",
    json: async () => ({ status: "success", data }),
    text: async () => JSON.stringify({ status: "success", data }),
  });

  // /workspaces returns a bare array; /nests/:id/files returns { status, data }.
  // Wrapping both the same way is what made the first version of these tests
  // fail with "workspaces.map is not a function".
  const bare = (data: unknown) => ({
    ok: true, status: 200, statusText: "OK",
    json: async () => data,
    text: async () => JSON.stringify(data),
  });

  const call = (args: Record<string, unknown>) =>
    handleToolCall(client, "nestr_workspace_docs", args);

  const textOf = (res: any) => res.content[0].text as string;

  const doc = (over: Record<string, unknown> = {}) => ({
    id: "f1", name: "handbook.pdf", contentType: "application/pdf", size: 5000,
    context: "nestradamus_files",
    description: "The staff handbook. Read it for leave, expenses and notice periods.",
    descriptionSource: "auto",
    ...over,
  });

  describe("the index", () => {
    it("lists each document with what it holds and when to read it", async () => {
      mockFetch.mockResolvedValueOnce(json([doc()]));
      const text = textOf(await call({ workspaceId: "ws1" }));

      expect(text).toContain("handbook.pdf");
      expect(text).toContain("Read it for leave, expenses and notice periods");
      expect(text).toContain("f1");
    });

    it("asks for the context group, not every file on the workspace nest", async () => {
      mockFetch.mockResolvedValueOnce(json([doc()]));
      await call({ workspaceId: "ws1" });

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain("/nests/ws1/files");
      expect(url).toContain("context=nestradamus_files");
    });

    it("says an undescribed document is undescribed rather than hiding it", async () => {
      mockFetch.mockResolvedValueOnce(json([doc({ description: undefined })]));
      const text = textOf(await call({ workspaceId: "ws1" }));

      expect(text).toContain("handbook.pdf");
      expect(text).toMatch(/no description yet/i);
    });

    // An empty index is an answer. Reading it as a failure is what sends an
    // agent looking for another way in.
    it("treats an empty workspace as an answer, not an error", async () => {
      mockFetch.mockResolvedValueOnce(json([]));
      const text = textOf(await call({ workspaceId: "ws1" }));

      expect(text).toMatch(/uploaded no reference documents/i);
      expect(text).toMatch(/not a failure/i);
    });

    it("points at search rather than at reading a whole document", async () => {
      mockFetch.mockResolvedValueOnce(json([doc()]));
      expect(textOf(await call({ workspaceId: "ws1" }))).toContain("search");
    });
  });

  describe("search", () => {
    it("returns the passages that matched, with where to read on from", async () => {
      mockFetch.mockResolvedValueOnce(json([doc({
        matches: [{ excerpt: "Parental leave is twelve weeks.", offset: 4096 }],
      })]));
      const text = textOf(await call({ workspaceId: "ws1", search: "parental leave" }));

      expect(text).toContain("Parental leave is twelve weeks.");
      expect(text).toContain("offset: 4096");
      expect(text).toContain("handbook.pdf");
    });

    it("passes the query to the server rather than filtering here", async () => {
      mockFetch.mockResolvedValueOnce(json([]));
      await call({ workspaceId: "ws1", search: "parental leave" });

      expect(mockFetch.mock.calls[0][0]).toContain("search=parental+leave");
    });

    // The failure this guards against is an agent concluding the organisation
    // has no policy because one phrasing missed.
    it("says a miss is a miss, not proof the organisation has no position", async () => {
      mockFetch.mockResolvedValueOnce(json([]));
      const text = textOf(await call({ workspaceId: "ws1", search: "pension" }));

      expect(text).toMatch(/never that it does not exist/i);
    });
  });

  describe("reading one document", () => {
    it("returns the text and where it sits in the document", async () => {
      mockFetch.mockResolvedValueOnce(json({
        id: "f1", name: "handbook.pdf", contentType: "text/plain",
        text: "Parental leave is twelve weeks.", offset: 0, total: 30, nextOffset: null,
      }));
      const text = textOf(await call({ workspaceId: "ws1", fileId: "f1" }));

      expect(text).toContain("Parental leave is twelve weeks.");
      expect(text).toContain("End of document.");
      expect(mockFetch.mock.calls[0][0]).toContain("as=text");
    });

    it("hands back a way to continue when the document is longer than the slice", async () => {
      mockFetch.mockResolvedValueOnce(json({
        id: "f1", name: "handbook.pdf", contentType: "text/plain",
        text: "chapter one", offset: 0, total: 100000, nextOffset: 40000,
      }));
      const text = textOf(await call({ workspaceId: "ws1", fileId: "f1" }));

      expect(text).toContain("offset: 40000");
      expect(text).not.toContain("End of document.");
    });

    it("continues from an offset when given one", async () => {
      mockFetch.mockResolvedValueOnce(json({
        id: "f1", name: "handbook.pdf", contentType: "text/plain",
        text: "chapter two", offset: 40000, total: 100000, nextOffset: 80000,
      }));
      await call({ workspaceId: "ws1", fileId: "f1", offset: 40000 });

      expect(mockFetch.mock.calls[0][0]).toContain("offset=40000");
    });
  });

  describe("resolving the workspace", () => {
    it("uses the only reachable workspace when there is exactly one", async () => {
      mockFetch
        .mockResolvedValueOnce(bare([{ _id: "ws1", title: "Acme" }]))
        .mockResolvedValueOnce(json([doc()]));
      const text = textOf(await call({}));

      expect(text).toContain("handbook.pdf");
      expect(mockFetch.mock.calls[1][0]).toContain("/nests/ws1/files");
    });

    // Reading the wrong organisation's constitution is a confident wrong
    // answer, which is worse than asking.
    it("asks rather than guessing when several are reachable", async () => {
      mockFetch.mockResolvedValueOnce(bare([
        { _id: "ws1", title: "Acme" },
        { _id: "ws2", title: "Globex" },
      ]));
      const text = textOf(await call({}));

      expect(text).toMatch(/name one/i);
      expect(text).toContain("ws1");
      expect(text).toContain("ws2");
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("says so when the token reaches nothing", async () => {
      mockFetch.mockResolvedValueOnce(bare([]));
      expect(textOf(await call({}))).toMatch(/no workspace is reachable/i);
    });
  });

  describe("the tool definition", () => {
    const def = toolDefinitions.find((t) => t.name === "nestr_workspace_docs")!;

    it("is registered", () => { expect(def).toBeDefined(); });

    // These are pure reads, so a read-only key must be able to make them. The
    // repo derives its read-only set from this flag rather than a hand-kept list.
    it("is read-only", () => {
      expect(def.annotations?.readOnlyHint).toBe(true);
    });

    it("requires no arguments, because the bare call is how you discover it", () => {
      expect(def.inputSchema.required ?? []).toEqual([]);
    });

    it("tells the caller to start with the bare call", () => {
      expect(def.description).toMatch(/NO ARGUMENTS FIRST/);
    });
  });
});
