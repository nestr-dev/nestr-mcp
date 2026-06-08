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

// Inline-image limits (opt-in base64 attachment for hosts that render images).
const DEFAULT_INLINE_IMAGES = 3;
const MAX_INLINE_IMAGES_CAP = 6; // upper bound when a caller raises maxImages
const MAX_IMAGE_BYTES = 2 * 1024 * 1024; // 2 MB per image — Webflow screenshots are far smaller
const IMAGE_CACHE_MAX = 50;

export type ArticleIndexEntry = { slug: string; url: string };
export type ArticleSearchHit = ArticleIndexEntry & { score: number };

type IndexCache = { entries: ArticleIndexEntry[]; expiresAt: number };
type ArticleCache = { markdown: string; title: string; description: string; expiresAt: number };

type MetaCache = { title: string; description: string; expiresAt: number };
type ImageCache = { data: string; mimeType: string; expiresAt: number };

let indexCache: IndexCache | null = null;
const articleCache = new Map<string, ArticleCache>();
const metaCache = new Map<string, MetaCache>();
const imageCache = new Map<string, ImageCache>();

// Test-only: reset caches between cases without poking at module internals.
export function _resetCaches(): void {
  indexCache = null;
  articleCache.clear();
  metaCache.clear();
  imageCache.clear();
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
 * Extra search keywords for articles whose slug undersells their content, so a
 * query like "kanban" or "burndown" still finds `scrum-agile-app`. Keyed by
 * slug; merged into the search haystack alongside the slug-as-words. This is
 * the synonym layer — keep it focused on real user vocabulary that the slug
 * itself omits.
 */
const ARTICLE_KEYWORDS: Record<string, string[]> = {
  "scrum-agile-app": ["sprint", "sprints", "kanban", "backlog", "burndown", "epic", "epics", "milestone", "milestones", "iteration", "userstory", "story", "stories", "standup", "velocity", "board"],
  "running-meetings-in-nestr": ["tactical", "governance", "standup", "retro", "retrospective", "facilitation", "facilitator", "agenda"],
  "tensions-and-governance-proposals": ["proposal", "proposals", "holacracy", "sociocracy", "amend", "amendment", "objection"],
  "nestr-the-power-of-labels": ["tag", "tags", "tagging"],
  "building-your-org-structure-roles-circles": ["hierarchy", "department", "team", "org", "orgchart", "chart", "accountability", "accountabilities"],
  "giving-or-requesting-feedback-in-nestr": ["review", "praise", "kudos", "appraisal"],
  "projects-and-todos-creating-tracking-managing-work": ["task", "tasks", "todo", "todos", "project", "projects", "checklist", "deadline"],
  "nestr-mcp-connect-ai-assistants-to-your-workspace": ["mcp", "assistant", "assistants", "claude", "cursor", "llm", "agent"],
  "chat-channels-and-communication-in-nestr": ["chat", "message", "messaging", "channel", "channels", "notification", "notifications", "mention", "comment"],
  "managing-users-invitations-permissions": ["invite", "invitation", "permission", "permissions", "member", "members", "user", "users", "access"],
  "pricing-plans-what-you-pay-for": ["pricing", "price", "plan", "plans", "billing", "subscription", "cost", "payment"],
};

/**
 * Classic Levenshtein distance, capped for our needs. Only used to rescue
 * near-miss typos (e.g. "scum" → "scrum") against single words, so the full
 * matrix on short inputs is fine. Returns early past our max threshold.
 */
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (Math.abs(m - n) > 2) return 3;
  const prev = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(
        prev[j] + 1,
        prev[j - 1] + 1,
        diag + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      diag = tmp;
    }
  }
  return prev[n];
}

/**
 * Token-overlap search against slug-as-words plus curated keywords. Slugs are
 * descriptive (e.g. `building-your-org-structure-roles-circles`), so
 * dash-to-space gives a usable signal without fetching every article's title.
 * Exact substring matches score 1; a typo rescued by Levenshtein scores 0.5,
 * so an exact hit always outranks a fuzzy one.
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
    const slugWords = entry.slug.toLowerCase().replace(/-/g, " ");
    const keywords = ARTICLE_KEYWORDS[entry.slug] ?? [];
    const haystack = keywords.length ? `${slugWords} ${keywords.join(" ")}` : slugWords;
    const words = haystack.split(/\s+/).filter(Boolean);
    let score = 0;
    for (const token of tokens) {
      if (haystack.includes(token)) {
        score += 1; // exact substring match (original behaviour)
      } else if (token.length >= 4) {
        // Typo rescue: allow 1 edit for short tokens, 2 for longer ones.
        const threshold = token.length >= 7 ? 2 : 1;
        if (words.some(w => w.length >= 4 && levenshtein(w, token) <= threshold)) {
          score += 0.5; // weaker than exact, so exact matches win ties
        }
      }
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
  metaCache.set(cleanSlug, { title, description, expiresAt: Date.now() + ARTICLE_TTL_MS });
  return { slug: cleanSlug, url, title, description, markdown };
}

/**
 * Fetch just an article's title + description, for search-result snippets,
 * without converting the whole body. Reuses a full-article or prior meta cache
 * entry when one is fresh, and caches meta separately so repeated searches are
 * cheap. Throws on a non-OK response — callers enrich best-effort and fall back
 * to the bare slug on failure.
 */
export async function fetchArticleMeta(slug: string): Promise<{ slug: string; title: string; description: string }> {
  const cleanSlug = slug.replace(/^\/+|\/+$/g, "");
  const cachedMeta = metaCache.get(cleanSlug);
  if (cachedMeta && Date.now() < cachedMeta.expiresAt) {
    return { slug: cleanSlug, title: cachedMeta.title, description: cachedMeta.description };
  }
  const full = articleCache.get(cleanSlug);
  if (full && Date.now() < full.expiresAt) {
    return { slug: cleanSlug, title: full.title, description: full.description };
  }
  const res = await fetchWithTimeout(HELP_ARTICLE_PREFIX + cleanSlug);
  if (!res.ok) {
    throw new Error(`Article meta fetch failed for "${cleanSlug}": ${res.status} ${res.statusText}`);
  }
  const { title, description } = extractArticleMeta(await res.text());
  metaCache.set(cleanSlug, { title, description, expiresAt: Date.now() + ARTICLE_TTL_MS });
  return { slug: cleanSlug, title, description };
}

export type ArticleImage = { url: string; caption: string };

/**
 * Pull the in-body images out of converted article markdown as structured data
 * so callers can surface screenshots as first-class items (some MCP hosts
 * render them inline; text-only clients still get the caption + URL). SVGs are
 * skipped — on these pages they're UI chrome/icons, not content. Dedupes by
 * URL, preserves document order. Run this on the article body markdown so nav
 * and marketing imagery (already cut by extractArticleBody) stays out.
 */
export function extractImages(markdown: string): ArticleImage[] {
  const seen = new Set<string>();
  const images: ArticleImage[] = [];
  // Matches `![alt](url)` and the inner image of a linked image `[![alt](url)](href)`.
  for (const m of markdown.matchAll(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const url = m[2].trim();
    if (!url || seen.has(url) || /\.svg(\?|#|$)/i.test(url)) continue;
    seen.add(url);
    images.push({ url, caption: m[1].trim() });
  }
  return images;
}

export type InlineArticleImage = ArticleImage & { index: number; data: string; mimeType: string };

/** Clamp a caller-supplied maxImages to [1, MAX_INLINE_IMAGES_CAP], default 3. */
export function clampMaxImages(max?: number): number {
  if (max === undefined || !Number.isFinite(max) || max < 1) return DEFAULT_INLINE_IMAGES;
  return Math.min(Math.floor(max), MAX_INLINE_IMAGES_CAP);
}

/**
 * Decide which images (by index into `images`) to attach inline.
 *
 * - Explicit `indexes`: the caller picked specific entries from the numbered
 *   list, so honour them verbatim — valid, de-duped, in the given order, with
 *   NO cap (overrides maxImages and the default caption filter).
 * - Default: only captioned images, in document order, capped at `max`. The
 *   caption requirement skips the uncaptioned hero/avatar and other chrome;
 *   masthead/footer imagery is already gone because we only see body markdown.
 */
export function selectImageIndexes(
  images: ArticleImage[],
  opts: { indexes?: number[]; max?: number } = {},
): number[] {
  const n = images.length;
  if (opts.indexes && opts.indexes.length > 0) {
    const seen = new Set<number>();
    const out: number[] = [];
    for (const idx of opts.indexes) {
      if (Number.isInteger(idx) && idx >= 0 && idx < n && !seen.has(idx)) {
        seen.add(idx);
        out.push(idx);
      }
    }
    return out;
  }
  const cap = clampMaxImages(opts.max);
  const out: number[] = [];
  for (let i = 0; i < n && out.length < cap; i++) {
    if (images[i].caption.trim()) out.push(i);
  }
  return out;
}

/**
 * Guard the image URLs we'll fetch server-side. Image URLs come from
 * Nestr-authored help articles (low risk), but we still only fetch public
 * https origins — never loopback, link-local, or private ranges — as
 * defence-in-depth against SSRF.
 */
function isFetchableImageUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  const host = u.hostname.toLowerCase();
  // Reject IPv6 literals outright. Legit CDN/help image URLs use DNS hostnames,
  // and IPv6 range-matching is unreliable (Node normalises ::ffff:127.0.0.1 to
  // ::ffff:7f00:1). URL.hostname brackets any IPv6 literal, so this single check
  // covers loopback, link-local, unique-local, and IPv4-mapped addresses.
  if (host.startsWith("[")) return false;
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return false;
  if (host === "0.0.0.0") return false;
  if (/^(127\.|10\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)) return false;
  return true;
}

function mimeFromExtension(url: string): string | null {
  const path = url.split(/[?#]/)[0].toLowerCase();
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
  if (path.endsWith(".webp")) return "image/webp";
  if (path.endsWith(".gif")) return "image/gif";
  return null;
}

/**
 * Fetch a single image and return it as base64 + MIME type for an MCP `image`
 * content block, or null if it can't be safely inlined (disallowed URL,
 * non-image content, too large, or any network error). Best-effort by design —
 * callers fall back to the text URL list. Bounded FIFO cache by URL (oldest
 * entry evicted once the cap is reached).
 */
export async function fetchImageAsBase64(url: string): Promise<{ data: string; mimeType: string } | null> {
  if (!isFetchableImageUrl(url)) return null;
  const cached = imageCache.get(url);
  if (cached && Date.now() < cached.expiresAt) {
    return { data: cached.data, mimeType: cached.mimeType };
  }
  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) return null;
    const contentType = (res.headers?.get?.("content-type") || "").split(";")[0].trim().toLowerCase();
    const mimeType = contentType.startsWith("image/") ? contentType : mimeFromExtension(url);
    if (!mimeType || mimeType === "image/svg+xml") return null; // svg = chrome/icons, skip
    const declaredLength = Number(res.headers?.get?.("content-length") || 0);
    if (declaredLength > MAX_IMAGE_BYTES) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength === 0 || buf.byteLength > MAX_IMAGE_BYTES) return null;
    const data = buf.toString("base64");
    if (imageCache.size >= IMAGE_CACHE_MAX) {
      const oldest = imageCache.keys().next().value;
      if (oldest !== undefined) imageCache.delete(oldest);
    }
    imageCache.set(url, { data, mimeType, expiresAt: Date.now() + ARTICLE_TTL_MS });
    return { data, mimeType };
  } catch {
    return null;
  }
}

/**
 * Fetch the selected article images (see selectImageIndexes) as inline base64
 * blocks, carrying each image's index in the full list. Concurrent and
 * best-effort — any that can't be inlined are dropped.
 */
export async function collectArticleImages(
  images: ArticleImage[],
  opts: { indexes?: number[]; max?: number } = {},
): Promise<InlineArticleImage[]> {
  const indexes = selectImageIndexes(images, opts);
  const settled = await Promise.all(
    indexes.map(async i => {
      const bytes = await fetchImageAsBase64(images[i].url);
      return bytes ? { ...images[i], index: i, ...bytes } : null;
    }),
  );
  return settled.filter((r): r is InlineArticleImage => r !== null);
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
