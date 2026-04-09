import { describe, it, expect } from "vitest";
import { HELP_TOPICS } from "../../src/help/topics.js";

describe("HELP_TOPICS", () => {
  it("returns content for a known topic", () => {
    const content = HELP_TOPICS["search"];
    expect(content).toBeDefined();
    expect(content.length).toBeGreaterThan(0);
    expect(content).toContain("Search");
  });

  it("returns undefined for an unknown topic", () => {
    expect(HELP_TOPICS["nonexistent-topic"]).toBeUndefined();
  });

  it("returns the full topic list for 'topics'", () => {
    const content = HELP_TOPICS["topics"];
    expect(content).toBeDefined();
    expect(content).toContain("Available nestr_help topics");
    // Verify it lists the actual topic keys
    expect(content).toContain("search");
    expect(content).toContain("tension-processing");
    expect(content).toContain("insights");
  });

  it("has entries for all topics listed in the 'topics' index", () => {
    const index = HELP_TOPICS["topics"];
    // Extract topic keys from lines like "- topickey: description"
    const listedKeys = [...index.matchAll(/^- ([a-z-]+):/gm)].map(m => m[1]);

    for (const key of listedKeys) {
      expect(HELP_TOPICS[key], `topic '${key}' listed in index but missing from HELP_TOPICS`).toBeDefined();
    }
  });
});
