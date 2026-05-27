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

  it("scrum topic documents the three labels and key workflows", () => {
    const content = HELP_TOPICS["scrum"];
    expect(content).toBeDefined();
    expect(content).toContain("userstory");
    expect(content).toContain("sprint");
    expect(content).toContain("epic");
    expect(content).toContain("userstory_sprint");
    expect(content).toContain("userstory_epic");
    expect(content).toContain("nestr_get_workspace_apps");
    expect(content).toContain("sprint->term:now");
    expect(content).toContain("fieldValues.userstory_sprint:!exists");
  });

  it("okr topic documents goal/result/resultwork and term queries", () => {
    const content = HELP_TOPICS["okr"];
    expect(content).toBeDefined();
    expect(content).toContain("goal");
    expect(content).toContain("result");
    expect(content).toContain("resultwork");
    expect(content).toContain("goal_term");
    expect(content).toContain("goal->term:this_quarter");
  });

  it("search topic documents the term-field operator", () => {
    const content = HELP_TOPICS["search"];
    expect(content).toContain("Term-field");
    expect(content).toContain("sprint->term:now");
    expect(content).toContain("DATE_DATE");
  });

  it("labels topic flags scrum and okr labels as workspace-app labels", () => {
    const content = HELP_TOPICS["labels"];
    expect(content).toContain("Workspace App labels");
    expect(content).toContain("userstory");
    expect(content).toContain("resultwork");
    expect(content).toContain("nestr_get_workspace_apps");
  });
});
