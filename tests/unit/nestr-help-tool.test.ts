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
    expect(text).toContain('- [0] "Sprint board" — https://cdn.example.com/board.png');
    expect(text).not.toContain("attached inline below"); // nothing attached without includeImages
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
    // The text block (with the markdown + URL list) is still present as a fallback,
    // and marks the attached entry.
    expect(textOf(result)).toContain('- [0] "Sprint board" — https://cdn.prod.website-files.com/x/board.png — attached inline below');
  });

  it("does not attach images by default — attachment is opt-in", async () => {
    const articleHtml = `<html><head>
<script type="application/ld+json">
{"@type":"TechArticle","headline":"Scrum/Agile app","description":"Run sprints."}
</script></head><body>
<h1>Scrum/Agile app</h1>
<img src="https://cdn.prod.website-files.com/x/board.png" alt="Sprint board" />
<footer>x</footer>
</body></html>`;
    mockFetch.mockResolvedValueOnce(htmlResponse(articleHtml));

    // A plain fetch (no includeImages, no imageIndexes) returns text only.
    const result = await handleToolCall(client, "nestr_help", { topic: "scrum-agile-app" });
    expect(result.content.every(c => c.type === "text")).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1); // article only — no image fetches
    // ...but the numbered URL list is still there so the agent can opt in next call.
    expect(textOf(result)).toContain('- [0] "Sprint board" — https://cdn.prod.website-files.com/x/board.png');
    expect(textOf(result)).not.toContain("attached inline below");
    expect(textOf(result)).toContain("includeImages:true");
  });

  it("hints that screenshots are available (and how to attach) on a plain fetch", async () => {
    mockFetch.mockResolvedValueOnce(htmlResponse(multiImageArticle));
    const result = await handleToolCall(client, "nestr_help", { topic: "scrum-agile-app" });
    expect(result.content.filter(c => c.type === "image")).toHaveLength(0); // opt-in: none attached
    const text = textOf(result);
    expect(text).toContain("2 screenshots you can view"); // hero[0] decorative; [1],[2] content
    expect(text).toContain("not attached by default");
    expect(text).toContain("includeImages:true");
    expect(text).toContain("imageIndexes");
  });

  it("hints that more screenshots remain when only some are attached", async () => {
    mockFetch
      .mockResolvedValueOnce(htmlResponse(multiImageArticle))
      .mockResolvedValue(imageResponse(Buffer.from("png")));
    const text = textOf(await handleToolCall(client, "nestr_help", { topic: "scrum-agile-app", imageIndexes: [1] }));
    expect(text).toContain("1 screenshot attached below");
    expect(text).toMatch(/more are listed under the article/i);
    expect(text).toContain("imageIndexes");
  });

  it("attaches the first maxImages content images when includeImages is true", async () => {
    // hero (decorative) + 4 captioned content screenshots; default cap is 3.
    const articleHtml = `<html><head>
<script type="application/ld+json">
{"@type":"TechArticle","headline":"Scrum/Agile app","description":"Run sprints."}
</script></head><body>
<h1>Scrum/Agile app</h1>
<img src="https://cdn.prod.website-files.com/x/hero.png" />
<h2>One</h2>
<img src="https://cdn.prod.website-files.com/x/a.png" alt="Step A" />
<h2>Two</h2>
<img src="https://cdn.prod.website-files.com/x/b.png" alt="Step B" />
<h2>Three</h2>
<img src="https://cdn.prod.website-files.com/x/c.png" alt="Step C" />
<h2>Four</h2>
<img src="https://cdn.prod.website-files.com/x/d.png" alt="Step D" />
<footer>x</footer>
</body></html>`;
    mockFetch
      .mockResolvedValueOnce(htmlResponse(articleHtml))
      .mockResolvedValue(imageResponse(Buffer.from("png")));

    const result = await handleToolCall(client, "nestr_help", { topic: "scrum-agile-app", includeImages: true });
    expect(result.content.filter(c => c.type === "image")).toHaveLength(3); // first 3 content images
    const markedIndexes = [...textOf(result).matchAll(/^- \[(\d+)\][^\n]*attached inline below$/gm)].map(m => Number(m[1]));
    expect(markedIndexes).toEqual([1, 2, 3]); // indexes 1-3, hero [0] excluded
  });

  it("coerces imageIndexes sent as a string (stale client schema)", async () => {
    mockFetch
      .mockResolvedValueOnce(htmlResponse(multiImageArticle))
      .mockResolvedValue(imageResponse(Buffer.from("png")));

    // A client serialising the array param as a string must still work.
    const result = await handleToolCall(client, "nestr_help", { topic: "scrum-agile-app", imageIndexes: "[2]" as unknown as number[] });
    const imageBlocks = result.content.filter(c => c.type === "image");
    expect(imageBlocks).toHaveLength(1);
    expect(textOf(result)).toContain("sprints.png — attached inline below");
  });

  // Article with an uncaptioned hero/"avatar" (index 0) followed by captioned
  // screenshots — the real-world shape that motivated the selection change.
  const multiImageArticle = `<html><head>
<script type="application/ld+json">
{"@type":"TechArticle","headline":"Scrum/Agile app","description":"Run sprints."}
</script></head><body>
<h1>Scrum/Agile app</h1>
<img src="https://cdn.prod.website-files.com/x/hero.png" />
<h2>Enable</h2>
<p>Step one.</p>
<img src="https://cdn.prod.website-files.com/x/enable.png" alt="Enable the app" />
<h2>Sprints</h2>
<img src="https://cdn.prod.website-files.com/x/sprints.png" alt="Plan a sprint" />
<footer>chrome</footer>
</body></html>`;

  it("excludes the uncaptioned hero/avatar from the default selection", async () => {
    mockFetch
      .mockResolvedValueOnce(htmlResponse(multiImageArticle))
      .mockResolvedValue(imageResponse(Buffer.from("png")));

    const result = await handleToolCall(client, "nestr_help", { topic: "scrum-agile-app", includeImages: true });
    const imageBlocks = result.content.filter(c => c.type === "image");
    expect(imageBlocks).toHaveLength(2); // the two captioned screenshots, not the hero
    const text = textOf(result);
    expect(text).toContain("- [0] [decorative] (no caption) — https://cdn.prod.website-files.com/x/hero.png");
    expect(text).not.toContain("hero.png — attached inline below"); // hero NOT attached
    expect(text).toContain('- [1] "Enable the app" — https://cdn.prod.website-files.com/x/enable.png — attached inline below');
    expect(text).toContain('- [2] "Plan a sprint" — https://cdn.prod.website-files.com/x/sprints.png — attached inline below');
  });

  it("attaches exactly the requested imageIndexes (incl. uncaptioned), implying attachment and ignoring the cap", async () => {
    mockFetch
      .mockResolvedValueOnce(htmlResponse(multiImageArticle))
      .mockResolvedValue(imageResponse(Buffer.from("png")));

    // imageIndexes alone (no includeImages); request the uncaptioned hero + index 2.
    const result = await handleToolCall(client, "nestr_help", { topic: "scrum-agile-app", imageIndexes: [0, 2] });
    const imageBlocks = result.content.filter(c => c.type === "image");
    expect(imageBlocks).toHaveLength(2);
    const text = textOf(result);
    expect(text).toContain("- [0] [decorative] (no caption) — https://cdn.prod.website-files.com/x/hero.png — attached inline below");
    expect(text).not.toContain("enable.png — attached inline below"); // index 1 not requested
    expect(text).toContain("sprints.png — attached inline below");
  });

  it("keeps the index list's attached markers in sync with the attached image blocks", async () => {
    mockFetch
      .mockResolvedValueOnce(htmlResponse(multiImageArticle))
      .mockResolvedValue(imageResponse(Buffer.from("png")));

    const result = await handleToolCall(client, "nestr_help", { topic: "scrum-agile-app", includeImages: true });
    const imageBlocks = result.content.filter(c => c.type === "image");
    const text = textOf(result);
    // Exactly one "attached inline below" marker per attached image block...
    const markers = text.match(/attached inline below/g) ?? [];
    expect(markers).toHaveLength(imageBlocks.length);
    // ...and the marked list entries are exactly the non-decorative indices.
    const markedIndexes = [...text.matchAll(/^- \[(\d+)\][^\n]*attached inline below$/gm)].map(m => Number(m[1]));
    expect(markedIndexes).toEqual([1, 2]);
  });

  it("caps the default selection at maxImages", async () => {
    mockFetch
      .mockResolvedValueOnce(htmlResponse(multiImageArticle))
      .mockResolvedValue(imageResponse(Buffer.from("png")));

    const result = await handleToolCall(client, "nestr_help", { topic: "scrum-agile-app", includeImages: true, maxImages: 1 });
    const imageBlocks = result.content.filter(c => c.type === "image");
    expect(imageBlocks).toHaveLength(1); // only the first captioned screenshot
    expect(mockFetch).toHaveBeenCalledTimes(2); // article + one image
  });

  it("attaches nothing and explains when an article has no content images", async () => {
    const articleHtml = `<html><head>
<script type="application/ld+json">
{"@type":"TechArticle","headline":"Logos only","description":"No screenshots."}
</script></head><body>
<h1>Logos only</h1>
<img src="https://cdn.prod.website-files.com/x/logo.png" />
<footer>x</footer>
</body></html>`;
    mockFetch.mockResolvedValueOnce(htmlResponse(articleHtml));

    const result = await handleToolCall(client, "nestr_help", { topic: "logos-only", includeImages: true });
    expect(result.content.filter(c => c.type === "image")).toHaveLength(0);
    expect(textOf(result)).toContain("No images attached — this article has no non-decorative content screenshots");
    expect(mockFetch).toHaveBeenCalledTimes(1); // article only — nothing selected to fetch
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
