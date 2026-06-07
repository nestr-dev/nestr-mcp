/**
 * Cross-links between the curated internal `nestr_help` topics and the public
 * help-article corpus (nestr.io/help/articles/<slug>).
 *
 * Two directions, two small hand-curated tables:
 *  - TOPIC_TO_ARTICLES: an internal topic points to deeper end-user articles
 *    (an internal topic may suggest several).
 *  - ARTICLE_TO_TOPIC: an article points back to the single most relevant
 *    internal topic (agent-flavoured tool-call guidance).
 *
 * Slugs are validated by hand against https://nestr.io/sitemap.xml; topic keys
 * must exist in HELP_TOPICS (asserted in tests). When a topic and an article
 * cover the same ground, add the pair to BOTH tables.
 */

export const TOPIC_TO_ARTICLES: Record<string, string[]> = {
  "core-concepts": ["nestr-the-basic-building-blocks", "structure-and-governance-in-nestr"],
  "nest-model": ["nestr-the-basic-building-blocks"],
  "labels": ["nestr-the-power-of-labels"],
  "search": ["nestr-search"],
  "operating-modes": ["structure-and-governance-in-nestr"],
  "workspace-types": ["structure-and-governance-in-nestr", "building-your-org-structure-roles-circles"],
  "matching-work-to-roles": ["building-your-org-structure-roles-circles"],
  "tension-processing": ["tensions-and-governance-proposals"],
  "scrum": ["scrum-agile-app"],
  "inbox": ["projects-and-todos-creating-tracking-managing-work"],
  "daily-plan": ["projects-and-todos-creating-tracking-managing-work"],
  "doing-work": ["projects-and-todos-creating-tracking-managing-work"],
  "notifications": ["chat-channels-and-communication-in-nestr"],
  "authentication": ["nestr-mcp-connect-ai-assistants-to-your-workspace", "using-the-nestr-api"],
  "mcp-apps": ["nestr-mcp-connect-ai-assistants-to-your-workspace"],
  "linking": ["navigating-nestr"],
  "web-app-links": ["navigating-nestr"],
  "workspace-setup": ["setting-up-a-new-collaborative-workspace"],
  "best-practices": ["getting-started-with-nestr"],
};

export const ARTICLE_TO_TOPIC: Record<string, string> = {
  "nestr-the-basic-building-blocks": "nest-model",
  "structure-and-governance-in-nestr": "core-concepts",
  "nestr-the-power-of-labels": "labels",
  "nestr-search": "search",
  "building-your-org-structure-roles-circles": "matching-work-to-roles",
  "tensions-and-governance-proposals": "tension-processing",
  "running-meetings-in-nestr": "tension-processing",
  "scrum-agile-app": "scrum",
  "projects-and-todos-creating-tracking-managing-work": "doing-work",
  "chat-channels-and-communication-in-nestr": "notifications",
  "nestr-mcp-connect-ai-assistants-to-your-workspace": "mcp-apps",
  "using-the-nestr-api": "authentication",
  "navigating-nestr": "web-app-links",
  "setting-up-a-new-collaborative-workspace": "workspace-setup",
  "getting-started-with-nestr": "best-practices",
};

/** Public help articles that go deeper on a curated internal topic. */
export function relatedArticlesForTopic(topicKey: string): string[] {
  return TOPIC_TO_ARTICLES[topicKey] ?? [];
}

/** The internal topic (if any) that gives agent-flavoured guidance for an article. */
export function relatedTopicForArticle(slug: string): string | undefined {
  return ARTICLE_TO_TOPIC[slug.replace(/^\/+|\/+$/g, "")];
}
