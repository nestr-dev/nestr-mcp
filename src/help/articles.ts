/**
 * Help-article integration. Sources `/help/articles/<slug>` URLs from the
 * public nestr.io sitemap, exposes simple token-overlap search by slug, and
 * fetches an article page lazily on demand (converting it to markdown so it
 * fits in a tool response).
 *
 * The internal `nestr_help` topics in topics.ts are curated MCP-flavoured
 * guidance. Articles are end-user UI docs. The tool routes between them:
 * exact internal topic match first, then article search/fetch.
 */

const SITEMAP_URL = "https://nestr.io/sitemap.xml";
const HELP_ARTICLE_PREFIX = "https://nestr.io/help/articles/";
const INDEX_TTL_MS = 15 * 60 * 1000;
const ARTICLE_TTL_MS = 15 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8000;

export type ArticleIndexEntry = { slug: string; url: string };
export type ArticleSearchHit = ArticleIndexEntry & { score: number };

type IndexCache = { entries: ArticleIndexEntry[]; expiresAt: number };
type ArticleCache = { markdown: string; title: string; description: string; expiresAt: number };

let indexCache: IndexCache | null = null;
const articleCache = new Map<string, ArticleCache>();

// Test-only: reset caches between cases without poking at module internals.
export function _resetCaches(): void {
  indexCache = null;
  articleCache.clear();
}

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Load (or return cached) the list of help-article slugs from the sitemap.
 * Sitemap is plain XML with `<loc>...</loc>` entries; we only need the URLs,
 * so a regex extract is cheaper than pulling in an XML parser.
 */
export async function loadArticleIndex(): Promise<ArticleIndexEntry[]> {
  if (indexCache && Date.now() < indexCache.expiresAt) {
    return indexCache.entries;
  }
  const res = await fetchWithTimeout(SITEMAP_URL);
  if (!res.ok) {
    throw new Error(`Sitemap fetch failed: ${res.status} ${res.statusText}`);
  }
  const xml = await res.text();
  const entries: ArticleIndexEntry[] = [];
  for (const match of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) {
    const url = match[1].trim();
    if (url.startsWith(HELP_ARTICLE_PREFIX)) {
      const slug = url.slice(HELP_ARTICLE_PREFIX.length).replace(/\/$/, "");
      if (slug) entries.push({ slug, url });
    }
  }
  indexCache = { entries, expiresAt: Date.now() + INDEX_TTL_MS };
  return entries;
}

/**
 * Token-overlap search against slug-as-words. Slugs are descriptive
 * (e.g. `building-your-org-structure-roles-circles`), so dash-to-space gives
 * a usable signal without fetching every article's title for the index.
 */
export function searchArticleIndex(
  entries: ArticleIndexEntry[],
  query: string,
  limit = 10,
): ArticleSearchHit[] {
  const tokens = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(t => t.length >= 2);
  if (tokens.length === 0) return [];
  const hits: ArticleSearchHit[] = [];
  for (const entry of entries) {
    const haystack = entry.slug.toLowerCase().replace(/-/g, " ");
    let score = 0;
    for (const token of tokens) {
      if (haystack.includes(token)) score++;
    }
    if (score > 0) hits.push({ ...entry, score });
  }
  hits.sort((a, b) => b.score - a.score || a.slug.localeCompare(b.slug));
  return hits.slice(0, limit);
}

/**
 * Fetch a single article and convert to a readable markdown payload. Cached
 * per-slug for ARTICLE_TTL_MS. The conversion is intentionally lossy —
 * Webflow output is noisy, and the LLM only needs the textual body.
 */
export async function fetchArticleMarkdown(slug: string): Promise<{
  slug: string;
  url: string;
  title: string;
  description: string;
  markdown: string;
}> {
  const cleanSlug = slug.replace(/^\/+|\/+$/g, "");
  const cached = articleCache.get(cleanSlug);
  if (cached && Date.now() < cached.expiresAt) {
    return {
      slug: cleanSlug,
      url: HELP_ARTICLE_PREFIX + cleanSlug,
      title: cached.title,
      description: cached.description,
      markdown: cached.markdown,
    };
  }
  const url = HELP_ARTICLE_PREFIX + cleanSlug;
  const res = await fetchWithTimeout(url);
  if (!res.ok) {
    throw new Error(`Article fetch failed for "${cleanSlug}": ${res.status} ${res.statusText}`);
  }
  const html = await res.text();
  const { title, description } = extractArticleMeta(html);
  const markdown = htmlToMarkdown(extractArticleBody(html, title));
  articleCache.set(cleanSlug, {
    title,
    description,
    markdown,
    expiresAt: Date.now() + ARTICLE_TTL_MS,
  });
  return { slug: cleanSlug, url, title, description, markdown };
}

/**
 * Pull title + description from the article's JSON-LD `TechArticle` block
 * when present (every article currently includes one). Falls back to
 * `<title>` / `<meta name="description">` tags.
 */
export function extractArticleMeta(html: string): { title: string; description: string } {
  let title = "";
  let description = "";

  for (const match of html.matchAll(
    /<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    try {
      const parsed = JSON.parse(match[1].trim());
      const candidates = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of candidates) {
        if (item && typeof item === "object" && item["@type"] === "TechArticle") {
          title = String(item.headline || "").trim();
          description = String(item.description || "").trim();
          break;
        }
      }
      if (title) break;
    } catch {
      // ignore malformed JSON-LD; fall through to meta tags
    }
  }

  if (!title) {
    const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (m) title = decodeEntities(m[1]).replace(/\s*\|\s*Nestr Help\s*$/, "").trim();
  }
  if (!description) {
    const m = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);
    if (m) description = decodeEntities(m[1]).trim();
  }
  return { title, description };
}

/**
 * Best-effort extraction of the article body. We can't rely on a single
 * named container on Webflow output, so we cut from the article's `<h1>`
 * down to where chrome resumes (footer / nav). When the page has multiple
 * `<h1>` elements (Webflow's hidden signup form puts one in before the
 * article), pass `headlineHint` so we can pick the matching one.
 */
export function extractArticleBody(html: string, headlineHint?: string): string {
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  let body = bodyMatch ? bodyMatch[1] : html;

  // Drop <script>, <style>, <noscript>, <svg>, and head leftovers before any
  // text-extraction so they don't bleed into the markdown.
  body = body
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
    .replace(/<svg[\s\S]*?<\/svg>/gi, "");

  // Pick the right <h1> to start from. If a headline hint is provided, find
  // the <h1> whose visible text contains it (case-insensitive substring).
  // Falls back to the first <h1>, which is correct for pages with a single
  // article heading.
  const h1Re = /<h1\b[^>]*>([\s\S]*?)<\/h1>/gi;
  const h1Matches = [...body.matchAll(h1Re)];
  let startIdx = -1;
  if (headlineHint && h1Matches.length > 1) {
    const needle = headlineHint.toLowerCase().trim();
    for (const m of h1Matches) {
      const inner = m[1].replace(/<[^>]+>/g, "").toLowerCase().trim();
      if (inner && needle.includes(inner) || inner.includes(needle)) {
        startIdx = m.index ?? -1;
        break;
      }
    }
  }
  if (startIdx < 0) {
    const firstH1 = body.search(/<h1\b/i);
    startIdx = firstH1;
  }
  if (startIdx > -1) body = body.slice(startIdx);

  // Cut at the start of the page footer. Webflow uses both `<footer>` and
  // `<div class="footer">` patterns; match either. We also stop at a
  // "related articles" section if present, which sits between the article
  // body and the footer on some templates.
  const cutRes = [
    /<footer\b/i,
    /<div[^>]+class=["'][^"']*\bfooter\b[^"']*["']/i,
    /<div[^>]+class=["'][^"']*\brelated-articles?\b[^"']*["']/i,
  ];
  let cutIdx = -1;
  for (const re of cutRes) {
    const idx = body.search(re);
    if (idx > -1 && (cutIdx < 0 || idx < cutIdx)) cutIdx = idx;
  }
  if (cutIdx > -1) body = body.slice(0, cutIdx);

  return body;
}

/**
 * Minimal HTML → markdown converter. Handles the elements that actually show
 * up in the article body (headings, paragraphs, lists, links, emphasis,
 * inline code, line breaks). Anything else is reduced to its text content.
 * Not a general-purpose converter — just enough that the LLM can read it.
 */
export function htmlToMarkdown(html: string): string {
  let out = html;

  // Inline elements first — block handlers call stripTags() on their inner
  // content to clean leftover tags, which would otherwise drop these
  // conversions before they take effect.
  //
  // Images come before links so a linked image (`<a><img/></a>`) survives the
  // outer link conversion as a markdown linked-image (`[![alt](src)](href)`).
  // No transformations are applied to the URL — Webflow CDN URLs are returned
  // as-is so MCP hosts that can render images inline (Claude, Claude Desktop,
  // and similar) display them, while text-only clients still see the alt.
  out = out.replace(/<img\b([^>]*)\/?>/gi, (_m, attrs) => {
    const srcMatch = attrs.match(/\bsrc=["']([^"']+)["']/i);
    if (!srcMatch) return "";
    const altMatch = attrs.match(/\balt=["']([^"']*)["']/i);
    const src = srcMatch[1];
    const alt = (altMatch?.[1] ?? "").trim();
    return `![${alt}](${src})`;
  });
  out = out.replace(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href, inner) => {
    const text = stripTags(inner).trim();
    return text ? `[${text}](${href})` : href;
  });
  out = out.replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _t, inner) => `**${stripTags(inner)}**`);
  out = out.replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _t, inner) => `*${stripTags(inner)}*`);
  out = out.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_m, inner) => `\`${stripTags(inner)}\``);
  out = out.replace(/<br\s*\/?>/gi, "\n");

  // Block elements next — by now the inline replacements have been made, so
  // stripTags() inside these handlers only removes leftover tag noise rather
  // than discarding markdown markers.
  out = out.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, level, inner) => {
    return `\n\n${"#".repeat(Number(level))} ${stripTags(inner).trim()}\n\n`;
  });
  out = out.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_m, inner) => {
    return `\n\n${stripTags(inner).trim()}\n\n`;
  });
  out = out.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_m, inner) => `\n- ${stripTags(inner).trim()}`);
  out = out.replace(/<\/?(ul|ol)[^>]*>/gi, "\n");
  out = out.replace(/<hr\s*\/?>/gi, "\n\n---\n\n");

  // Strip remaining tags but keep their inner text.
  out = stripTags(out);

  // Normalise whitespace: collapse 3+ newlines, trim trailing spaces on each
  // line, and tidy the head/tail.
  out = decodeEntities(out)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return out;
}

function stripTags(input: string): string {
  return input.replace(/<[^>]+>/g, "");
}

function decodeEntities(input: string): string {
  return input
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(Number(code)));
}
