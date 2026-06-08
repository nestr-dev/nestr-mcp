import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  _resetCaches,
  loadArticleIndex,
  searchArticleIndex,
  fetchArticleMarkdown,
  fetchArticleMeta,
  extractArticleMeta,
  extractArticleBody,
  extractImages,
  fetchImageAsBase64,
  collectArticleImages,
  selectImageIndexes,
  clampMaxImages,
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
  function imageResponse(bytes: Buffer, contentType = "image/png", headers: Record<string, string> = {}) {
    const all = new Map(
      Object.entries({ "content-type": contentType, ...headers }).map(([k, v]) => [k.toLowerCase(), v]),
    );
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      headers: { get: (k: string) => all.get(k.toLowerCase()) ?? null },
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    };
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

    it("rescues a typo via fuzzy matching (scum -> scrum)", () => {
      const hits = searchArticleIndex(entries, "scum");
      expect(hits.map(h => h.slug)).toContain("scrum-agile-app");
    });

    it("matches curated synonyms absent from the slug (kanban -> scrum-agile-app)", () => {
      expect(searchArticleIndex(entries, "kanban").map(h => h.slug)).toContain("scrum-agile-app");
      expect(searchArticleIndex(entries, "burndown").map(h => h.slug)).toContain("scrum-agile-app");
    });

    it("scores a fuzzy match below an exact match", () => {
      expect(searchArticleIndex(entries, "scrum")[0].score).toBe(1);
      expect(searchArticleIndex(entries, "scum")[0].score).toBe(0.5);
    });

    it("does not fuzzy-match tokens shorter than 4 characters", () => {
      // "scu" is too short to rescue and isn't a substring of any haystack.
      expect(searchArticleIndex(entries, "scu")).toEqual([]);
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

  // ─── Lightweight meta fetch (search snippets) ──────────────────────────────

  describe("fetchArticleMeta", () => {
    const metaHtml = `<html><head>
<title>Ignored | Nestr Help</title>
<script type="application/ld+json">
{"@type":"TechArticle","headline":"Scrum/Agile app","description":"Run sprints in Nestr."}
</script></head><body><h1>Scrum/Agile app</h1></body></html>`;

    it("returns title + description for a slug", async () => {
      mockFetch.mockResolvedValueOnce(htmlResponse(metaHtml));
      const meta = await fetchArticleMeta("scrum-agile-app");
      expect(meta).toEqual({
        slug: "scrum-agile-app",
        title: "Scrum/Agile app",
        description: "Run sprints in Nestr.",
      });
    });

    it("caches meta across calls within the TTL", async () => {
      mockFetch.mockResolvedValueOnce(htmlResponse(metaHtml));
      await fetchArticleMeta("scrum-agile-app");
      await fetchArticleMeta("scrum-agile-app");
      expect(mockFetch).toHaveBeenCalledOnce();
    });

    it("reuses a full-article cache entry without refetching", async () => {
      mockFetch.mockResolvedValueOnce(htmlResponse(metaHtml));
      await fetchArticleMarkdown("scrum-agile-app"); // populates article + meta cache
      const meta = await fetchArticleMeta("scrum-agile-app");
      expect(meta.title).toBe("Scrum/Agile app");
      expect(mockFetch).toHaveBeenCalledOnce();
    });

    it("throws a clear error on a non-OK response", async () => {
      mockFetch.mockResolvedValueOnce(errorResponse(404, "Not Found"));
      await expect(fetchArticleMeta("missing")).rejects.toThrow(/404/);
    });
  });

  // ─── Image extraction ──────────────────────────────────────────────

  describe("extractImages", () => {
    it("pulls captioned images in order, deduped by URL", () => {
      const md = `# Title
![First shot](https://cdn.example.com/a.png)
Some text
![Second shot](https://cdn.example.com/b.png)
![First shot again](https://cdn.example.com/a.png)`;
      expect(extractImages(md)).toEqual([
        { url: "https://cdn.example.com/a.png", caption: "First shot", decorative: false },
        { url: "https://cdn.example.com/b.png", caption: "Second shot", decorative: false },
      ]);
    });

    it("flags an image with an empty caption as decorative", () => {
      expect(extractImages("![](https://cdn.example.com/x.png)")).toEqual([
        { url: "https://cdn.example.com/x.png", caption: "", decorative: true },
      ]);
    });

    it("flags a captioned image before the first content heading as decorative", () => {
      // Header/thumbnail sits between the title (#) and the first section (##).
      const md = `# Title
![Top banner](https://cdn.example.com/banner.png)
## First section
![Real screenshot](https://cdn.example.com/shot.png)`;
      expect(extractImages(md)).toEqual([
        { url: "https://cdn.example.com/banner.png", caption: "Top banner", decorative: true },
        { url: "https://cdn.example.com/shot.png", caption: "Real screenshot", decorative: false },
      ]);
    });

    it("does not apply the position rule when the body has no content heading", () => {
      // Only a title (one heading) — fall back to the caption test alone.
      const md = `# Title
![Captioned](https://cdn.example.com/a.png)`;
      expect(extractImages(md)).toEqual([
        { url: "https://cdn.example.com/a.png", caption: "Captioned", decorative: false },
      ]);
    });

    it("skips SVG chrome/icons", () => {
      const md = `![logo](https://cdn.example.com/logo.svg)
![screenshot](https://cdn.example.com/shot.png)`;
      expect(extractImages(md)).toEqual([
        { url: "https://cdn.example.com/shot.png", caption: "screenshot", decorative: false },
      ]);
    });

    it("extracts the inner image of a markdown linked-image", () => {
      const md = `[![sprint board](https://cdn.example.com/board.png)](https://nestr.io/help/articles/sprints)`;
      expect(extractImages(md)).toEqual([
        { url: "https://cdn.example.com/board.png", caption: "sprint board", decorative: false },
      ]);
    });

    it("returns an empty array when there are no images", () => {
      expect(extractImages("# Just text\nNo images here.")).toEqual([]);
    });
  });

  // ─── Inline image fetch (opt-in base64) ──────────────────────────────

  describe("fetchImageAsBase64", () => {
    const PNG = "https://cdn.prod.website-files.com/x/board.png";

    it("returns base64 data + MIME type from the content-type header", async () => {
      const bytes = Buffer.from("fake-png-bytes");
      mockFetch.mockResolvedValueOnce(imageResponse(bytes, "image/png"));
      const result = await fetchImageAsBase64(PNG);
      expect(result).toEqual({ data: bytes.toString("base64"), mimeType: "image/png" });
    });

    it("falls back to the URL extension when content-type is unhelpful", async () => {
      const bytes = Buffer.from("bytes");
      mockFetch.mockResolvedValueOnce(imageResponse(bytes, "application/octet-stream"));
      const result = await fetchImageAsBase64(PNG);
      expect(result?.mimeType).toBe("image/png");
    });

    it("returns null for a non-https URL without fetching", async () => {
      expect(await fetchImageAsBase64("http://cdn.prod.website-files.com/x/board.png")).toBeNull();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("returns null for a private/loopback host without fetching", async () => {
      expect(await fetchImageAsBase64("https://127.0.0.1/x.png")).toBeNull();
      expect(await fetchImageAsBase64("https://localhost/x.png")).toBeNull();
      expect(await fetchImageAsBase64("https://10.0.0.5/x.png")).toBeNull();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("returns null for IPv6 literal hosts (loopback, link-local, mapped) without fetching", async () => {
      // IPv6 literals are bracketed in URL.hostname; we reject them wholesale
      // because range-matching is unreliable (::ffff:127.0.0.1 -> ::ffff:7f00:1).
      expect(await fetchImageAsBase64("https://[::1]/x.png")).toBeNull();
      expect(await fetchImageAsBase64("https://[fe80::1]/x.png")).toBeNull();
      expect(await fetchImageAsBase64("https://[fd00::1]/x.png")).toBeNull();
      expect(await fetchImageAsBase64("https://[::ffff:127.0.0.1]/x.png")).toBeNull();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("returns null when content-length exceeds the cap", async () => {
      mockFetch.mockResolvedValueOnce(
        imageResponse(Buffer.from("small"), "image/png", { "content-length": String(5 * 1024 * 1024) }),
      );
      expect(await fetchImageAsBase64(PNG)).toBeNull();
    });

    it("returns null when the content can't be typed as an image", async () => {
      mockFetch.mockResolvedValueOnce(imageResponse(Buffer.from("x"), "text/html"));
      expect(await fetchImageAsBase64("https://cdn.prod.website-files.com/x/page")).toBeNull();
    });

    it("returns null on a network error rather than throwing", async () => {
      mockFetch.mockRejectedValueOnce(new Error("boom"));
      expect(await fetchImageAsBase64(PNG)).toBeNull();
    });

    it("caches a fetched image by URL", async () => {
      mockFetch.mockResolvedValueOnce(imageResponse(Buffer.from("bytes"), "image/png"));
      await fetchImageAsBase64(PNG);
      await fetchImageAsBase64(PNG);
      expect(mockFetch).toHaveBeenCalledOnce();
    });
  });

  describe("collectArticleImages", () => {
    it("fetches the selected images in order, with their list index, dropping failures", async () => {
      const a = Buffer.from("a");
      const c = Buffer.from("c");
      mockFetch
        .mockResolvedValueOnce(imageResponse(a, "image/png"))  // a.png ok
        .mockResolvedValueOnce(errorResponse(404))             // b.png fails
        .mockResolvedValueOnce(imageResponse(c, "image/jpeg")); // c.jpg ok
      const images = [
        { url: "https://cdn.prod.website-files.com/x/a.png", caption: "A", decorative: false },
        { url: "https://cdn.prod.website-files.com/x/b.png", caption: "B", decorative: false },
        { url: "https://cdn.prod.website-files.com/x/c.jpg", caption: "C", decorative: false },
      ];
      const result = await collectArticleImages(images, { max: 3 });
      expect(result.map(r => r.caption)).toEqual(["A", "C"]);
      expect(result[0]).toMatchObject({ index: 0, mimeType: "image/png", data: a.toString("base64") });
      expect(result[1]).toMatchObject({ index: 2, mimeType: "image/jpeg", data: c.toString("base64") });
    });

    it("honours the max cap", async () => {
      mockFetch
        .mockResolvedValueOnce(imageResponse(Buffer.from("1"), "image/png"))
        .mockResolvedValueOnce(imageResponse(Buffer.from("2"), "image/png"));
      const images = [
        { url: "https://cdn.prod.website-files.com/x/1.png", caption: "1", decorative: false },
        { url: "https://cdn.prod.website-files.com/x/2.png", caption: "2", decorative: false },
        { url: "https://cdn.prod.website-files.com/x/3.png", caption: "3", decorative: false },
      ];
      const result = await collectArticleImages(images, { max: 2 });
      expect(result).toHaveLength(2);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("skips decorative images (avatar/hero/chrome) in the default selection", async () => {
      mockFetch.mockResolvedValue(imageResponse(Buffer.from("x"), "image/png"));
      const images = [
        { url: "https://cdn.prod.website-files.com/x/hero.png", caption: "", decorative: true },
        { url: "https://cdn.prod.website-files.com/x/shot.png", caption: "Real screenshot", decorative: false },
      ];
      const result = await collectArticleImages(images);
      expect(result.map(r => r.index)).toEqual([1]);
      expect(mockFetch).toHaveBeenCalledTimes(1); // only the content image is fetched
    });

    it("attaches exact imageIndexes (including decorative), overriding the cap", async () => {
      mockFetch.mockResolvedValue(imageResponse(Buffer.from("x"), "image/png"));
      const images = [
        { url: "https://cdn.prod.website-files.com/x/0.png", caption: "", decorative: true },
        { url: "https://cdn.prod.website-files.com/x/1.png", caption: "One", decorative: false },
        { url: "https://cdn.prod.website-files.com/x/2.png", caption: "Two", decorative: false },
        { url: "https://cdn.prod.website-files.com/x/3.png", caption: "Three", decorative: false },
        { url: "https://cdn.prod.website-files.com/x/4.png", caption: "Four", decorative: false },
      ];
      const result = await collectArticleImages(images, { indexes: [0, 4, 2, 3], max: 1 });
      expect(result.map(r => r.index)).toEqual([0, 4, 2, 3]); // requested order, cap ignored
      expect(mockFetch).toHaveBeenCalledTimes(4);
    });
  });

  describe("selectImageIndexes", () => {
    // Mirror extractImages' caption-based decorative flag for these fixtures.
    const imgs = (caps: string[]) =>
      caps.map((caption, i) => ({ url: `https://x/${i}.png`, caption, decorative: !caption }));

    it("defaults to non-decorative (content) images, in document order", () => {
      expect(selectImageIndexes(imgs(["", "A", "", "B"]))).toEqual([1, 3]);
    });

    it("caps the default selection at max (default 3)", () => {
      expect(selectImageIndexes(imgs(["A", "B", "C", "D", "E"]))).toEqual([0, 1, 2]);
      expect(selectImageIndexes(imgs(["A", "B", "C", "D", "E"]), { max: 2 })).toEqual([0, 1]);
    });

    it("returns [] when every image is decorative", () => {
      expect(selectImageIndexes(imgs(["", "", ""]))).toEqual([]);
    });

    it("excludes a decorative-by-position image from the default but keeps it addressable", () => {
      // A captioned header thumbnail flagged decorative (e.g. before first heading).
      const images = [
        { url: "https://x/0.png", caption: "Header banner", decorative: true },
        { url: "https://x/1.png", caption: "Content", decorative: false },
      ];
      expect(selectImageIndexes(images)).toEqual([1]);                  // default skips it
      expect(selectImageIndexes(images, { indexes: [0] })).toEqual([0]); // explicit attaches it
    });

    it("honours explicit indexes verbatim, deduped, ignoring the cap and decorative flag", () => {
      expect(selectImageIndexes(imgs(["", "A", "B", "C", "D"]), { indexes: [4, 0, 2, 4], max: 1 }))
        .toEqual([4, 0, 2]);
    });

    it("drops out-of-range explicit indexes", () => {
      expect(selectImageIndexes(imgs(["A", "B"]), { indexes: [0, 5, -1, 1] })).toEqual([0, 1]);
    });
  });

  describe("clampMaxImages", () => {
    it("defaults to 3 for undefined or invalid input", () => {
      expect(clampMaxImages(undefined)).toBe(3);
      expect(clampMaxImages(0)).toBe(3);
      expect(clampMaxImages(-2)).toBe(3);
      expect(clampMaxImages(NaN)).toBe(3);
    });

    it("clamps to the upper bound of 6", () => {
      expect(clampMaxImages(10)).toBe(6);
      expect(clampMaxImages(6)).toBe(6);
    });

    it("passes through and floors values in range", () => {
      expect(clampMaxImages(1)).toBe(1);
      expect(clampMaxImages(4)).toBe(4);
      expect(clampMaxImages(2.9)).toBe(2);
    });
  });
});
