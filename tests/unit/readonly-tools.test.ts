import { describe, it, expect } from "vitest";
import { READONLY_TOOL_NAMES, toolDefinitions } from "../../src/tools/index.js";

describe("READONLY_TOOL_NAMES", () => {
  it("allows a read tool and denies a write tool", () => {
    expect(READONLY_TOOL_NAMES.has("nestr_get_nest")).toBe(true);
    expect(READONLY_TOOL_NAMES.has("nestr_update_nest")).toBe(false);
  });

  it("denies destructive tools", () => {
    expect(READONLY_TOOL_NAMES.has("nestr_delete_nest")).toBe(false);
  });

  // Default deny: a tool with no annotation must never be readable by accident.
  it("denies unannotated tools", () => {
    const unannotated = toolDefinitions.filter((t) => !t.annotations).map((t) => t.name);
    for (const name of unannotated) {
      expect(READONLY_TOOL_NAMES.has(name), `${name} must be denied`).toBe(false);
    }
  });

  it("derives from readOnlyHint rather than a hand-kept list", () => {
    const expected = toolDefinitions
      .filter((t) => t.annotations?.readOnlyHint === true)
      .map((t) => t.name);
    expect([...READONLY_TOOL_NAMES].sort()).toEqual(expected.sort());
  });

  it("still exposes the three public tools, which are all reads", () => {
    for (const n of ["nestr_help", "nestr_diagnose", "nestr_get_me"]) {
      expect(READONLY_TOOL_NAMES.has(n)).toBe(true);
    }
  });
});
