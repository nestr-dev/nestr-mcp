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
  function textOf(result: Awaited<ReturnType<typeof handleToolCall>>): string {
    return result.content[0].text;
  }

  it("returns curated content for an internal topic without hitting the network", async () => {
    const result = await handleToolCall(client, "nestr_help", { topic: "search" });
    expect(result.isError).toBeUndefined();
    expect(textOf(result)).toContain("Search Query Syntax");
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
    expect(text).toContain("scrum-agile-app");
    expect(text).toContain("https://nestr.io/help/articles/scrum-agile-app");
    expect(text).not.toContain("tactical-meetings");
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
    expect(text).toContain("Scrum/Agile app");
    expect(text).toContain("Run sprints in Nestr.");
    expect(text).toContain("Stories link to a sprint.");
    expect(text).toContain("Source: https://nestr.io/help/articles/scrum-agile-app");
    expect(text).not.toContain("nope");
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
