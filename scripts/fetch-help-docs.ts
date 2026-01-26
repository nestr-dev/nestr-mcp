#!/usr/bin/env npx tsx
/**
 * Fetch help documentation from help.nestr.io at build time
 * Outputs to src/help/docs.json for bundling with the MCP server
 */

import * as cheerio from "cheerio";
import { writeFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = join(__dirname, "../src/help/docs.json");

const SITEMAP_URL = "https://help.nestr.io/sitemap_en.xml";
const BASE_URL = "https://help.nestr.io";

interface HelpArticle {
  slug: string;
  url: string;
  title: string;
  category: string;
  content: string;
  fetchedAt: string;
}

interface HelpDocs {
  fetchedAt: string;
  articles: HelpArticle[];
}

async function fetchSitemap(): Promise<string[]> {
  console.log("Fetching sitemap...");
  const response = await fetch(SITEMAP_URL);
  const xml = await response.text();
  const $ = cheerio.load(xml, { xmlMode: true });

  const urls: string[] = [];
  $("url loc").each((_, el) => {
    const url = $(el).text();
    // Only include article pages (not category pages)
    if (url.includes("/en/") && url.split("/").length > 4) {
      urls.push(url);
    }
  });

  console.log(`Found ${urls.length} article URLs`);
  return urls;
}

async function fetchArticle(url: string): Promise<HelpArticle | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.warn(`Failed to fetch ${url}: ${response.status}`);
      return null;
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    // Extract title
    const title =
      $("h1").first().text().trim() ||
      $("title").text().replace(" | Nestr", "").trim();

    // Extract main content
    const contentEl = $("#article-content, .article-content, main.article");
    let content = "";

    if (contentEl.length) {
      // Remove scripts, styles, and navigation elements
      contentEl.find("script, style, nav, .navigation").remove();

      // Convert to text with basic formatting preserved
      content = contentEl
        .text()
        .replace(/\s+/g, " ")
        .replace(/\n\s*\n/g, "\n\n")
        .trim();
    }

    if (!content) {
      // Fallback: get body text
      $("script, style, nav, header, footer").remove();
      content = $("body").text().replace(/\s+/g, " ").trim();
    }

    // Extract category from URL path
    const pathParts = new URL(url).pathname.split("/").filter(Boolean);
    const category = pathParts[1] || "general"; // e.g., "using-nestr" or "integrations"
    const slug = pathParts.slice(1).join("/"); // e.g., "using-nestr/getting-started"

    return {
      slug,
      url,
      title,
      category,
      content,
      fetchedAt: new Date().toISOString(),
    };
  } catch (error) {
    console.warn(`Error fetching ${url}:`, error);
    return null;
  }
}

async function main() {
  console.log("Fetching Nestr help documentation...\n");

  const urls = await fetchSitemap();

  const articles: HelpArticle[] = [];

  // Fetch articles with rate limiting
  for (const url of urls) {
    const slug = url.replace(BASE_URL + "/en/", "");
    process.stdout.write(`Fetching: ${slug}...`);

    const article = await fetchArticle(url);
    if (article) {
      articles.push(article);
      console.log(" OK");
    } else {
      console.log(" FAILED");
    }

    // Small delay to be nice to the server
    await new Promise((r) => setTimeout(r, 200));
  }

  const docs: HelpDocs = {
    fetchedAt: new Date().toISOString(),
    articles,
  };

  // Ensure output directory exists
  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });

  // Write output
  writeFileSync(OUTPUT_PATH, JSON.stringify(docs, null, 2));

  console.log(`\nWrote ${articles.length} articles to ${OUTPUT_PATH}`);
}

main().catch((error) => {
  console.error("Failed to fetch help docs:", error);
  process.exit(1);
});
