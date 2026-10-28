import { describe, it, expect } from "vitest";
import {
  TOPIC_TO_ARTICLES,
  ARTICLE_TO_TOPIC,
  relatedArticlesForTopic,
  relatedTopicForArticle,
} from "../../src/help/cross-links.js";
import { HELP_TOPICS } from "../../src/help/topics.js";

describe("help cross-links", () => {
  it("every topic key in TOPIC_TO_ARTICLES exists in HELP_TOPICS", () => {
    for (const key of Object.keys(TOPIC_TO_ARTICLES)) {
      expect(HELP_TOPICS[key], `topic '${key}' missing from HELP_TOPICS`).toBeDefined();
    }
  });

  it("every reverse target in ARTICLE_TO_TOPIC is a real topic key", () => {
    for (const [slug, topic] of Object.entries(ARTICLE_TO_TOPIC)) {
      expect(HELP_TOPICS[topic], `article '${slug}' maps to unknown topic '${topic}'`).toBeDefined();
    }
  });

  it("all referenced slugs are non-empty, lowercase, dash-cased", () => {
    const slugs = [...Object.values(TOPIC_TO_ARTICLES).flat(), ...Object.keys(ARTICLE_TO_TOPIC)];
    expect(slugs.length).toBeGreaterThan(0);
    for (const slug of slugs) {
      expect(slug, slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    }
  });

  it("the meetings article and topic link to each other", () => {
    // Both directions, per the rule in cross-links.ts: when a topic and an
    // article cover the same ground, the pair goes in BOTH tables.
    expect(relatedArticlesForTopic("meetings")).toContain("running-meetings-in-nestr");
    expect(relatedTopicForArticle("running-meetings-in-nestr")).toBe("meetings");
  });

  it("relatedArticlesForTopic returns mapped slugs, [] for unknown topics", () => {
    expect(relatedArticlesForTopic("scrum")).toEqual(["scrum-agile-app"]);
    expect(relatedArticlesForTopic("not-a-topic")).toEqual([]);
  });

  it("relatedTopicForArticle resolves the reverse link and tolerates slashes", () => {
    expect(relatedTopicForArticle("scrum-agile-app")).toBe("scrum");
    expect(relatedTopicForArticle("/scrum-agile-app/")).toBe("scrum");
    expect(relatedTopicForArticle("unmapped-article")).toBeUndefined();
  });
});
