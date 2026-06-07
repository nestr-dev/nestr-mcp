import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { handleToolCall } from "../../src/tools/index.js";
import { NestrClient } from "../../src/api/client.js";
import { _resetCaches } from "../../src/help/articles.js";

/**
 * Exercises the three modes of nestr_help through the public tool dispatch:
 *   1. Internal topic match (no network)
 *   2. Article search via `search`
 *   3. Article fetch via `topic: <slug>` (fallback after internal lookup misses)
 */
describe("nestr_help tool", () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  let client: NestrClient;

  beforeEach(() => {
    _resetCaches();
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    client = new NestrClient({ apiKey: "test", baseUrl: "https://api.test.io/api" });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    _resetCaches();
  });

  function htmlResponse(body: string) {
    return { ok: true, status: 200, statusText: "OK", text: async () => body };
  }
  function errorResponse(status: number, statusText = "Error") {
    return { ok: false, status, statusText, text: async () => "" };
  }
  function imageResponse(bytes: Buffer, contentType = "image/png") {
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      headers: { get: (k: string) => (k.toLowerCase() === "content-type" ? contentType : null) },
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    };
  }
  function textOf(result: Awaited<ReturnType<typeof handleToolCall>>): string {
    const block = result.content.find((c): c is { type: "text"; text: string } => c.type === "text");
    return block ? block.text : "";
  }

  it("returns curated content for an internal topic without hitting the network", async () => {
    const result = await handleToolCall(client, "nestr_help", { topic: "search" });
    expect(result.isError).toBeUndefined();
    expect(textOf(result)).toContain("Search Query Syntax");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("opens an internal-topic response with a resolved-source header", async () => {
    const result = await handleToolCall(client, "nestr_help", { topic: "search" });
    expect(textOf(result)).toContain('_Resolved as: internal MCP topic "search"._');
  });

  it("cross-links an internal topic to its public help articles", async () => {
    const text = textOf(await handleToolCall(client, "nestr_help", { topic: "search" }));
    expect(text).toContain("Related public help article");
    expect(text).toContain("nestr-search");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("rejects calls with neither topic nor search", async () => {
    const result = await handleToolCall(client, "nestr_help", {});
    // zod refine surfaces as an error response from the tool layer
    expect(result.isError).toBeTruthy();
  });

  it("searches help articles when `search` is provided", async () => {
    const sitemap = `<urlset>
  <url><loc>https://nestr.io/help/articles/scrum-agile-app</loc></url>
  <url><loc>https://nestr.io/help/articles/getting-started-with-nestr</loc></url>
  <url><loc>https://nestr.io/help/articles/tactical-meetings</loc></url>
</urlset>`;
    mockFetch.mockResolvedValueOnce(htmlResponse(sitemap));

    const result = await handleToolCall(client, "nestr_help", { search: "scrum" });

    expect(result.isError).toBeUndefined();
    const text = textOf(result);
    expect(text).toContain("_Resolved as: help-article search._");
    expect(text).toContain("scrum-agile-app");
    expect(text).toContain("https://nestr.io/help/articles/scrum-agile-app");
    expect(text).not.toContain("tactical-meetings");
  });

  it("enriches search hits with a title + one-line summary, and cross-links the topic", async () => {
    const sitemap = `<urlset>
  <url><loc>https://nestr.io/help/articles/scrum-agile-app</loc></url>
</urlset>`;
    const articleHtml = `<html><head>
<script type="application/ld+json">
{"@type":"TechArticle","headline":"Scrum & Agile app","description":"Backlog, sprints, epics, burndown."}
</script></head><body><h1>Scrum & Agile app</h1></body></html>`;
    mockFetch
      .mockResolvedValueOnce(htmlResponse(sitemap))     // loadArticleIndex
      .mockResolvedValueOnce(htmlResponse(articleHtml)); // fetchArticleMeta for the hit

    // "kanban" is a curated synonym for the scrum article — exercises both
    // synonym search and snippet enrichment.
    const text = textOf(await handleToolCall(client, "nestr_help", { search: "kanban" }));
    expect(text).toContain("**Scrum & Agile app**");
    expect(text).toContain("Backlog, sprints, epics, burndown.");
    expect(text).toContain("see also internal topic `scrum`");
  });

  it("reports gracefully when no articles match the search", async () => {
    const sitemap = `<urlset><url><loc>https://nestr.io/help/articles/x</loc></url></urlset>`;
    mockFetch.mockResolvedValueOnce(htmlResponse(sitemap));

    const result = await handleToolCall(client, "nestr_help", { search: "completely-unrelated-thing" });
    expect(result.isError).toBeUndefined();
    expect(textOf(result)).toMatch(/No help articles matched/);
  });

  it("falls back to article fetch when topic is not an internal key", async () => {
    const articleHtml = `<html><head>
<title>Scrum/Agile app | Nestr Help</title>
<script type="application/ld+json">
{"@type":"TechArticle","headline":"Scrum/Agile app","description":"Run sprints in Nestr."}
</script>
</head><body>
<h1>Scrum/Agile app</h1>
<p>Stories link to a sprint.</p>
<footer>nope</footer>
</body></html>`;
    mockFetch.mockResolvedValueOnce(htmlResponse(articleHtml));

    const result = await handleToolCall(client, "nestr_help", { topic: "scrum-agile-app" });

    expect(result.isError).toBeUndefined();
    const text = textOf(result);
    expect(text).toContain('_Resolved as: help article "scrum-agile-app"');
    expect(text).toContain("Scrum/Agile app");
    expect(text).toContain("Run sprints in Nestr.");
    expect(text).toContain("Stories link to a sprint.");
    expect(text).toContain("Source: https://nestr.io/help/articles/scrum-agile-app");
    expect(text).not.toContain("nope");
  });

  it("appends a structured images list and cross-links back to the internal topic", async () => {
    const articleHtml = `<html><head>
<script type="application/ld+json">
{"@type":"TechArticle","headline":"Scrum/Agile app","description":"Run sprints."}
</script></head><body>
<h1>Scrum/Agile app</h1>
<p>Plan a sprint.</p>
<img src="https://cdn.example.com/board.png" alt="Sprint board" />
<footer>chrome</footer>
</body></html>`;
    mockFetch.mockResolvedValueOnce(htmlResponse(articleHtml));

    const text = textOf(await handleToolCall(client, "nestr_help", { topic: "scrum-agile-app" }));
    expect(text).toContain("Images in this article (1)");
    expect(text).toContain('"Sprint board" — https://cdn.example.com/board.png');
    expect(text).toContain("Related internal MCP topic");
    expect(text).toContain("`scrum`");
  });

  it("attaches inline base64 image blocks only when includeImages is set", async () => {
    const articleHtml = `<html><head>
<script type="application/ld+json">
{"@type":"TechArticle","headline":"Scrum/Agile app","description":"Run sprints."}
</script></head><body>
<h1>Scrum/Agile app</h1>
<p>Plan a sprint.</p>
<img src="https://cdn.prod.website-files.com/x/board.png" alt="Sprint board" />
<footer>chrome</footer>
</body></html>`;
    const pngBytes = Buffer.from("fake-png-bytes");
    mockFetch
      .mockResolvedValueOnce(htmlResponse(articleHtml)) // article fetch
      .mockResolvedValueOnce(imageResponse(pngBytes));  // image fetch

    const result = await handleToolCall(client, "nestr_help", { topic: "scrum-agile-app", includeImages: true });
    const imageBlocks = result.content.filter(c => c.type === "image");
    expect(imageBlocks).toHaveLength(1);
    expect(imageBlocks[0]).toEqual({ type: "image", mimeType: "image/png", data: pngBytes.toString("base64") });
    // The text block (with the markdown + URL list) is still present as a fallback.
    expect(result.content.some(c => c.type === "text")).toBe(true);
  });

  it("does not fetch images or attach blocks without includeImages", async () => {
    const articleHtml = `<html><head>
<script type="application/ld+json">
{"@type":"TechArticle","headline":"Scrum/Agile app","description":"Run sprints."}
</script></head><body>
<h1>Scrum/Agile app</h1>
<img src="https://cdn.prod.website-files.com/x/board.png" alt="Sprint board" />
<footer>x</footer>
</body></html>`;
    mockFetch.mockResolvedValueOnce(htmlResponse(articleHtml));

    const result = await handleToolCall(client, "nestr_help", { topic: "scrum-agile-app" });
    expect(result.content.every(c => c.type === "text")).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1); // article only — no image fetch
  });

  it("returns a clear unknown-topic message when both internal and article lookup miss", async () => {
    mockFetch.mockResolvedValueOnce(errorResponse(404, "Not Found"));

    const result = await handleToolCall(client, "nestr_help", { topic: "totally-made-up-key" });

    expect(result.isError).toBeUndefined();
    const text = textOf(result);
    expect(text).toContain("totally-made-up-key");
    expect(text).toContain("Tried internal topics");
    expect(text).toContain("nestr_help({ search:");
  });
});
