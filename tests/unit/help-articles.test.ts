import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  _resetCaches,
  loadArticleIndex,
  searchArticleIndex,
  fetchArticleMarkdown,
  extractArticleMeta,
  extractArticleBody,
  htmlToMarkdown,
} from "../../src/help/articles.js";

describe("help articles", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    _resetCaches();
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
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

  // ─── Index loading ──────────────────────────────────────────────

  describe("loadArticleIndex", () => {
    it("extracts only /help/articles/ URLs from the sitemap", async () => {
      const sitemap = `<?xml version="1.0"?>
<urlset>
  <url><loc>https://nestr.io</loc></url>
  <url><loc>https://nestr.io/pricing</loc></url>
  <url><loc>https://nestr.io/help/articles/getting-started-with-nestr</loc></url>
  <url><loc>https://nestr.io/help/articles/scrum-agile-app</loc></url>
  <url><loc>https://nestr.io/blog/post-1</loc></url>
</urlset>`;
      mockFetch.mockResolvedValueOnce(htmlResponse(sitemap));

      const entries = await loadArticleIndex();

      expect(entries).toEqual([
        { slug: "getting-started-with-nestr", url: "https://nestr.io/help/articles/getting-started-with-nestr" },
        { slug: "scrum-agile-app", url: "https://nestr.io/help/articles/scrum-agile-app" },
      ]);
      expect(mockFetch).toHaveBeenCalledOnce();
      expect(mockFetch.mock.calls[0][0]).toBe("https://nestr.io/sitemap.xml");
    });

    it("caches the index across calls within the TTL", async () => {
      const sitemap = `<urlset><url><loc>https://nestr.io/help/articles/x</loc></url></urlset>`;
      mockFetch.mockResolvedValueOnce(htmlResponse(sitemap));

      await loadArticleIndex();
      await loadArticleIndex();
      await loadArticleIndex();

      expect(mockFetch).toHaveBeenCalledOnce();
    });

    it("throws a clear error when the sitemap is unreachable", async () => {
      mockFetch.mockResolvedValueOnce(errorResponse(503, "Service Unavailable"));
      await expect(loadArticleIndex()).rejects.toThrow(/503/);
    });
  });

  // ─── Search ──────────────────────────────────────────────

  describe("searchArticleIndex", () => {
    const entries = [
      { slug: "getting-started-with-nestr", url: "https://nestr.io/help/articles/getting-started-with-nestr" },
      { slug: "scrum-agile-app", url: "https://nestr.io/help/articles/scrum-agile-app" },
      { slug: "building-your-org-structure-roles-circles", url: "https://nestr.io/help/articles/building-your-org-structure-roles-circles" },
      { slug: "tactical-meetings", url: "https://nestr.io/help/articles/tactical-meetings" },
    ];

    it("matches on slug-as-words", () => {
      const hits = searchArticleIndex(entries, "scrum");
      expect(hits.map(h => h.slug)).toEqual(["scrum-agile-app"]);
    });

    it("ranks higher when more tokens match", () => {
      const hits = searchArticleIndex(entries, "agile scrum");
      expect(hits[0]).toMatchObject({ slug: "scrum-agile-app", score: 2 });
    });

    it("returns multiple matches sorted by score", () => {
      const hits = searchArticleIndex(entries, "roles agile");
      expect(hits.map(h => h.slug)).toContain("scrum-agile-app");
      expect(hits.map(h => h.slug)).toContain("building-your-org-structure-roles-circles");
    });

    it("returns empty when no tokens match", () => {
      expect(searchArticleIndex(entries, "completely-unrelated-thing")).toEqual([]);
    });

    it("ignores single-character noise tokens", () => {
      // `a` and `x` should be dropped (length < 2), leaving no usable tokens.
      expect(searchArticleIndex(entries, "a x")).toEqual([]);
    });

    it("honours the limit", () => {
      const hits = searchArticleIndex(entries, "nestr", 1);
      expect(hits).toHaveLength(1);
    });
  });

  // ─── Article body extraction ──────────────────────────────────────────────

  describe("extractArticleMeta", () => {
    it("prefers the JSON-LD TechArticle headline + description", () => {
      const html = `
<html>
<head>
<title>Wrong | Nestr Help</title>
<meta name="description" content="wrong description" />
<script type="application/ld+json">
{"@type":"TechArticle","headline":"Right title","description":"Right description"}
</script>
</head>
</html>`;
      expect(extractArticleMeta(html)).toEqual({
        title: "Right title",
        description: "Right description",
      });
    });

    it("falls back to <title> and <meta name=description>", () => {
      const html = `
<html><head>
<title>Getting Started | Nestr Help</title>
<meta name="description" content="A starter guide" />
</head></html>`;
      expect(extractArticleMeta(html)).toEqual({
        title: "Getting Started",
        description: "A starter guide",
      });
    });

    it("survives malformed JSON-LD", () => {
      const html = `
<html><head>
<title>Backup | Nestr Help</title>
<script type="application/ld+json">{not-json</script>
</head></html>`;
      expect(extractArticleMeta(html).title).toBe("Backup");
    });
  });

  describe("extractArticleBody", () => {
    it("trims to the <h1>...<footer> window", () => {
      const html = `<html><body>
<nav>nav garbage</nav>
<div class="hero">hero garbage</div>
<h1>Article title</h1>
<p>Real content</p>
<footer>footer</footer>
</body></html>`;
      const body = extractArticleBody(html);
      expect(body).toContain("<h1>Article title</h1>");
      expect(body).toContain("Real content");
      expect(body).not.toContain("hero garbage");
      expect(body).not.toContain("footer");
    });

    it("strips <script>, <style>, <noscript>, <svg>", () => {
      const html = `<body>
<script>alert('hi')</script>
<style>.x{}</style>
<noscript>fallback</noscript>
<svg><path/></svg>
<h1>Title</h1>
<p>Body</p>
</body>`;
      const body = extractArticleBody(html);
      expect(body).not.toContain("alert");
      expect(body).not.toContain(".x{}");
      expect(body).not.toContain("fallback");
      expect(body).not.toContain("<path");
      expect(body).toContain("Body");
    });

    it("picks the matching <h1> when multiple are present and a hint is given", () => {
      const html = `<body>
<h1 class="signup">Signup</h1>
<p>signup noise</p>
<h1 class="heading-5">Getting started with Nestr</h1>
<p>Real article content</p>
<div class="footer">footer noise</div>
</body>`;
      const body = extractArticleBody(html, "Getting started with Nestr");
      expect(body).toContain("Real article content");
      expect(body).not.toContain("signup noise");
      expect(body).not.toContain("footer noise");
    });

    it("falls back to the first <h1> when no hint matches", () => {
      const html = `<body>
<h1>First</h1>
<p>First body</p>
<h1>Second</h1>
<p>Second body</p>
</body>`;
      const body = extractArticleBody(html, "Nothing matches");
      expect(body).toContain("First body");
      expect(body).toContain("Second body");
    });

    it("cuts at <div class=\"footer\"> (Webflow pattern), not just <footer>", () => {
      const html = `<body>
<h1>Title</h1>
<p>Body</p>
<div class="footer">footer noise</div>
<p>more noise</p>
</body>`;
      const body = extractArticleBody(html);
      expect(body).toContain("Body");
      expect(body).not.toContain("footer noise");
      expect(body).not.toContain("more noise");
    });
  });

  describe("htmlToMarkdown", () => {
    it("converts headings, paragraphs, and lists", () => {
      const md = htmlToMarkdown(`
<h1>Title</h1>
<p>First paragraph.</p>
<h2>Section</h2>
<ul><li>One</li><li>Two</li></ul>
`);
      expect(md).toContain("# Title");
      expect(md).toContain("First paragraph.");
      expect(md).toContain("## Section");
      expect(md).toContain("- One");
      expect(md).toContain("- Two");
    });

    it("preserves links with their href", () => {
      const md = htmlToMarkdown('<p>See <a href="https://example.com/x">the docs</a>.</p>');
      expect(md).toContain("[the docs](https://example.com/x)");
    });

    it("handles strong, em, and inline code", () => {
      const md = htmlToMarkdown("<p><strong>bold</strong> <em>italic</em> <code>code</code></p>");
      expect(md).toContain("**bold**");
      expect(md).toContain("*italic*");
      expect(md).toContain("`code`");
    });

    it("decodes common entities", () => {
      const md = htmlToMarkdown("<p>5 &gt; 3 &amp; 7 &lt; 10</p>");
      expect(md).toContain("5 > 3 & 7 < 10");
    });

    it("collapses excessive blank lines", () => {
      const md = htmlToMarkdown("<p>A</p>\n\n\n\n\n<p>B</p>");
      expect(md).not.toMatch(/\n{3,}/);
    });

    it("converts <img> to a markdown image reference", () => {
      const md = htmlToMarkdown('<p>Look: <img src="https://cdn.example.com/x.png" alt="sprint board" /></p>');
      expect(md).toContain("![sprint board](https://cdn.example.com/x.png)");
    });

    it("handles <img> with missing alt", () => {
      const md = htmlToMarkdown('<img src="https://cdn.example.com/y.png">');
      expect(md).toContain("![](https://cdn.example.com/y.png)");
    });

    it("drops <img> when src is missing", () => {
      const md = htmlToMarkdown('<img alt="orphan" />');
      expect(md).not.toContain("orphan");
      expect(md).not.toContain("![");
    });

    it("renders a linked image as a markdown linked-image", () => {
      const md = htmlToMarkdown(
        '<a href="https://nestr.io/help/articles/sprints"><img src="https://cdn.example.com/s.png" alt="sprint icon" /></a>',
      );
      expect(md).toContain("[![sprint icon](https://cdn.example.com/s.png)](https://nestr.io/help/articles/sprints)");
    });
  });

  // ─── End-to-end fetch ──────────────────────────────────────────────

  describe("fetchArticleMarkdown", () => {
    const sampleHtml = `<html>
<head>
<title>Scrum/Agile app | Nestr Help</title>
<script type="application/ld+json">
{"@type":"TechArticle","headline":"Scrum/Agile app","description":"Run sprints, milestones, and epics inside Nestr."}
</script>
</head>
<body>
<nav>nav stuff</nav>
<h1>Scrum/Agile app</h1>
<p>Stories link to a <a href="https://nestr.io/help/articles/sprints">sprint</a>.</p>
<h2>Estimating</h2>
<ul><li>Use Fibonacci</li><li>Leave unestimated work blank</li></ul>
<footer>footer stuff</footer>
</body>
</html>`;

    it("returns markdown body with title and description", async () => {
      mockFetch.mockResolvedValueOnce(htmlResponse(sampleHtml));

      const article = await fetchArticleMarkdown("scrum-agile-app");

      expect(article.slug).toBe("scrum-agile-app");
      expect(article.url).toBe("https://nestr.io/help/articles/scrum-agile-app");
      expect(article.title).toBe("Scrum/Agile app");
      expect(article.description).toBe("Run sprints, milestones, and epics inside Nestr.");
      expect(article.markdown).toContain("# Scrum/Agile app");
      expect(article.markdown).toContain("[sprint](https://nestr.io/help/articles/sprints)");
      expect(article.markdown).toContain("## Estimating");
      expect(article.markdown).toContain("- Use Fibonacci");
      expect(article.markdown).not.toContain("nav stuff");
      expect(article.markdown).not.toContain("footer stuff");
    });

    it("caches subsequent fetches of the same slug", async () => {
      mockFetch.mockResolvedValueOnce(htmlResponse(sampleHtml));
      await fetchArticleMarkdown("scrum-agile-app");
      await fetchArticleMarkdown("scrum-agile-app");
      expect(mockFetch).toHaveBeenCalledOnce();
    });

    it("propagates a clear error on 404", async () => {
      mockFetch.mockResolvedValueOnce(errorResponse(404, "Not Found"));
      await expect(fetchArticleMarkdown("nonexistent-slug")).rejects.toThrow(/404/);
    });

    it("normalises a slug with surrounding slashes", async () => {
      mockFetch.mockResolvedValueOnce(htmlResponse(sampleHtml));
      const article = await fetchArticleMarkdown("/scrum-agile-app/");
      expect(article.slug).toBe("scrum-agile-app");
      expect(article.url).toBe("https://nestr.io/help/articles/scrum-agile-app");
    });
  });
});
