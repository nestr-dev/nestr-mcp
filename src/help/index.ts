/**
 * Help documentation resources for MCP
 * Serves pre-fetched documentation from help.nestr.io
 */

import { readFileSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { Resource } from "@modelcontextprotocol/sdk/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

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

// Cache for loaded docs
let helpDocs: HelpDocs | null = null;

function loadDocs(): HelpDocs {
  if (helpDocs) return helpDocs;

  // Try multiple possible locations for docs.json
  const possiblePaths = [
    join(__dirname, "docs.json"), // In build output: build/help/docs.json
    join(__dirname, "../../src/help/docs.json"), // From build dir to src
  ];

  for (const docsPath of possiblePaths) {
    if (existsSync(docsPath)) {
      try {
        const content = readFileSync(docsPath, "utf-8");
        helpDocs = JSON.parse(content) as HelpDocs;
        return helpDocs;
      } catch {
        // Continue to next path
      }
    }
  }

  // Return empty docs if file doesn't exist
  console.warn("Help docs not found. Run 'npm run fetch-help' to generate.");
  return { fetchedAt: "", articles: [] };
}

/**
 * Get all help resources for MCP resource listing
 */
export function getHelpResources(): Resource[] {
  const docs = loadDocs();

  const resources: Resource[] = [
    {
      uri: "nestr://help",
      name: "Nestr Help Documentation",
      description:
        "Index of all Nestr help articles. Read this first to discover available documentation.",
      mimeType: "application/json",
    },
  ];

  // Add individual article resources
  for (const article of docs.articles) {
    resources.push({
      uri: `nestr://help/${article.slug}`,
      name: article.title,
      description: `Help article: ${article.title} (${article.category})`,
      mimeType: "text/plain",
    });
  }

  return resources;
}

/**
 * Read a help resource by URI
 */
export function readHelpResource(
  uri: string
): { text: string; mimeType: string } | null {
  const docs = loadDocs();

  // Handle index request
  if (uri === "nestr://help") {
    const index = docs.articles.map((a) => ({
      slug: a.slug,
      title: a.title,
      category: a.category,
      uri: `nestr://help/${a.slug}`,
      webUrl: a.url,
    }));

    return {
      text: JSON.stringify(
        {
          description:
            "Nestr help documentation index. Use the slug or uri to read specific articles.",
          fetchedAt: docs.fetchedAt,
          articles: index,
        },
        null,
        2
      ),
      mimeType: "application/json",
    };
  }

  // Handle specific article request
  const match = uri.match(/^nestr:\/\/help\/(.+)$/);
  if (match) {
    const slug = match[1];
    const article = docs.articles.find((a) => a.slug === slug);

    if (article) {
      // Format as readable text with metadata header
      const text = `# ${article.title}

Category: ${article.category}
Source: ${article.url}

---

${article.content}`;

      return { text, mimeType: "text/plain" };
    }
  }

  return null;
}
