import { describe, it, expect } from "vitest";
import { toolDefinitions } from "../../src/tools/index.js";

// The gap: an agent asked to schedule a meeting in a workspace holding only its
// anchor circle created a sub-circle named after the meeting to put it in. The
// label combos and the placement rule both lived in help topics the agent never
// fetched, so they were only reachable by an agent that already suspected it
// needed them. A tool description is the one surface that is always in context
// at the moment of the call, so the rule and the labels belong there too.
const describeOf = (name: string) => {
  const tool = toolDefinitions.find((t) => t.name === name);
  expect(tool, `${name} missing from toolDefinitions`).toBeDefined();
  return tool!.description as string;
};

describe("meeting placement is stated where an agent always sees it", () => {
  it("nestr_create_nest carries the rule and both label combos", () => {
    const d = describeOf("nestr_create_nest");
    expect(d).toContain("Never create a circle to hold a meeting");
    expect(d).toContain("anchor circle counts");
    expect(d).toContain("['meeting','circle-meeting']");
    expect(d).toContain("['meeting','governance']");
    expect(d).toContain("nestr_help('meetings')");
  });

  it("nestr_get_workspace_apps says enabled is a flag, not presence", () => {
    const d = describeOf("nestr_get_workspace_apps");
    // Reading it as a presence check reports every disabled app as on.
    expect(d).toContain("enabled: false");
    expect(d).toContain("test `enabled` and not presence");
    expect(d).toContain("`_id`, not `id`");
    expect(d).not.toContain("List enabled apps/features");
  });
});
