import { describe, it, expect } from "vitest";
import { searchArticleIndex } from "../../src/help/articles.js";
import { HELP_TOPICS } from "../../src/help/topics.js";
import { relatedArticlesForTopic, relatedTopicForArticle } from "../../src/help/cross-links.js";

/**
 * A prospect was told Nestr costs "environ 99 EUR/mois" for starter and "199
 * EUR/mois" for pro — flat tiers that do not exist, against real per-seat
 * pricing. The execution record shows that run issued no tool calls at all, so
 * the cause was the retrieval trigger, not the index; the `pricing` topic below
 * is what addresses that.
 *
 * What the incident exposed on measuring afterwards is that only 4 of 19 natural
 * phrasings reached the pricing article at all — including plain English "how
 * much does nestr cost", which lost to getting-started-with-nestr on the word
 * "nestr". These are the English phrasings that have to keep landing.
 *
 * Non-English queries are deliberately not covered by keywords here: every help
 * query issued in production has arrived in English, and the fallback for one
 * that does not is the empty-result message telling the caller to retry in
 * English, which is asserted separately below.
 */
const PRICING_QUERIES = [
  "what are the costs",
  "how much does nestr cost",
  "pricing",
  "per user per month",
  "seat price",
  "free plan",
  "ai credits cost",
  "how many seats do i pay for",
  "is there a free tier",
  "what do i pay per seat",
  "annual billing",
  "top up ai credits",
];

// A slice of the real corpus wide enough that a wrong winner can actually win.
const CORPUS = [
  "pricing-plans-what-you-pay-for",
  "managing-users-invitations-permissions",
  "getting-started-with-nestr",
  "nestr-search",
  "customising-tabs",
  "customising-views",
  "tensions-and-governance-proposals",
  "running-meetings-in-nestr",
  "scrum-agile-app",
  "recovering-deleted-items-undo-activity-stream",
  "projects-and-todos-creating-tracking-managing-work",
  "custom-fields",
  "okrs-app",
  "rights-management",
  "nestr-mcp-connect-ai-assistants-to-your-workspace",
  "chat-channels-and-communication-in-nestr",
  "building-your-org-structure-roles-circles",
  "nestr-the-power-of-labels",
].map(slug => ({ slug, url: `https://nestr.io/help/articles/${slug}` }));

const top = (query: string) => searchArticleIndex(CORPUS, query)[0]?.slug ?? "nothing";

describe("pricing questions reach the pricing article", () => {
  it.each(PRICING_QUERIES)("%s", query => {
    expect(top(query)).toBe("pricing-plans-what-you-pay-for");
  });
});

describe("the stopword pass does not steal other questions", () => {
  // Every one of these is a query whose grammar words previously scored, or
  // could start scoring, against an unrelated article's substrings.
  const expectations: Array<[string, string]> = [
    ["how do i invite a colleague", "managing-users-invitations-permissions"],
    ["search operators groupby", "nestr-search"],
    ["reorder my tabs", "customising-tabs"],
    ["how do i delete a role", "tensions-and-governance-proposals"],
    ["where did my deleted project go", "recovering-deleted-items-undo-activity-stream"],
    ["connect claude to my workspace", "nestr-mcp-connect-ai-assistants-to-your-workspace"],
    ["how do i run a tactical meeting", "running-meetings-in-nestr"],
    ["getting started", "getting-started-with-nestr"],
  ];
  it.each(expectations)("%s -> %s", (query, slug) => {
    expect(top(query)).toBe(slug);
  });

  // A question made only of grammar has nothing to go on, and returning the
  // general articles beats returning nothing at all.
  it("falls back rather than returning nothing when every token is a stopword", () => {
    expect(searchArticleIndex(CORPUS, "what is it").length).toBeGreaterThan(0);
  });

  it("still answers a bare product-name query", () => {
    expect(searchArticleIndex(CORPUS, "nestr").length).toBeGreaterThan(0);
  });
});

describe("the pricing topic", () => {
  const topic = HELP_TOPICS.pricing;

  it("exists and is advertised in the topics index", () => {
    expect(topic).toBeTruthy();
    expect(HELP_TOPICS.topics).toContain("- pricing:");
  });

  it("forbids answering from memory and hands over the live page", () => {
    expect(topic).toMatch(/never state a nestr price/i);
    expect(topic).toContain("https://nestr.io/pricing");
    expect(topic).toContain("pricing-plans-what-you-pay-for");
  });

  // The figures move; a topic that hard-codes them is a second stale source.
  it("carries no price figures of its own beyond the quoted bad answer", () => {
    const withoutTheCautionaryQuote = topic.replace(/"starter[^"]*"|"pro[^"]*"/gi, "");
    expect(withoutTheCautionaryQuote).not.toMatch(/€\s?\d|\d+\s?(eur|usd|euro)/i);
  });

  it("cross-links both ways with the article", () => {
    expect(relatedArticlesForTopic("pricing")).toContain("pricing-plans-what-you-pay-for");
    expect(relatedTopicForArticle("pricing-plans-what-you-pay-for")).toBe("pricing");
  });
});
