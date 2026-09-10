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

  it("meetings topic says a meeting attaches to an existing circle, anchor circle included", () => {
    const content = HELP_TOPICS["meetings"];
    expect(content).toBeDefined();
    // The valid parents, including the one the bad path overlooks.
    expect(content).toContain("anchor-circle");
    expect(content).toContain("The anchor circle is a circle");
    // The rule this topic exists to state.
    expect(content).toContain("Never create a circle in order to hold a meeting");
    // Label combos and the scheduling field.
    expect(content).toContain('["meeting", "circle-meeting"]');
    expect(content).toContain('["meeting", "governance"]');
    expect(content).toContain("due");
    // Enablement check, so it does not create a nest nobody can open. The app
    // id is the short one on `_id`; `circleplus-meetings` is the internal data
    // key and is NOT what the apps endpoint returns.
    expect(content).toContain('`_id: "meetings"`');
    expect(content).toContain("not the `circleplus-meetings` data key");
    // Defers the run-the-meeting half to the article rather than restating it.
    expect(content).toContain("running-meetings-in-nestr");
  });

  it("labels topic sends meeting creation to the meetings topic", () => {
    const content = HELP_TOPICS["labels"];
    expect(content).toContain('nestr_help({ topic: "meetings" })');
  });

  it("scrum topic documents the four labels and key workflows", () => {
    const content = HELP_TOPICS["scrum"];
    expect(content).toBeDefined();
    expect(content).toContain("userstory");
    expect(content).toContain("sprint");
    expect(content).toContain("epic");
    expect(content).toContain("milestone");
    expect(content).toContain("userstory_sprint");
    expect(content).toContain("userstory_epic");
    expect(content).toContain("userstory_milestone");
    expect(content).toContain("userstory_change_request_url");
    expect(content).toContain("sprint_status");
    expect(content).toContain("milestone_status");
    expect(content).toContain("nestr_get_workspace_apps");
    expect(content).toContain("fieldValues.sprint_status:active");
    expect(content).toContain("sprint->term:now");
    expect(content).toContain("fieldValues.userstory_sprint:!exists");
    // userstory_type was dropped in V1 — the topic notes its absence rather than documenting it
    expect(content).toContain("There is no \`userstory_type\` field");
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

  it("search topic documents the term-field operator and completed-strict DSL", () => {
    const content = HELP_TOPICS["search"];
    expect(content).toContain("Term-field");
    expect(content).toContain("sprint->term:now");
    expect(content).toContain("DATE_DATE");
    expect(content).toContain("completed:any");
    expect(content).toContain("completed-strict:false");
  });

  it("labels topic flags scrum and okr labels as workspace-app labels", () => {
    const content = HELP_TOPICS["labels"];
    expect(content).toContain("Workspace App labels");
    expect(content).toContain("userstory");
    expect(content).toContain("milestone");
    expect(content).toContain("resultwork");
    expect(content).toContain("nestr_get_workspace_apps");
  });
});
