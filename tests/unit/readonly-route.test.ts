import { describe, it, expect } from "vitest";
import { toolDefinitions, READONLY_TOOL_NAMES } from "../../src/tools/index.js";

describe("/mcp/readonly advertised tools", () => {
  // The route filters tools/list with this expression; pin it so the route and
  // the gate can never drift apart.
  it("advertises exactly the read-only set", () => {
    const advertised = toolDefinitions.filter((t) => READONLY_TOOL_NAMES.has(t.name));
    expect(advertised.length).toBe(READONLY_TOOL_NAMES.size);
    expect(advertised.every((t) => t.annotations?.readOnlyHint === true)).toBe(true);
  });

  it("advertises fewer tools than the full surface and more than public", () => {
    expect(READONLY_TOOL_NAMES.size).toBeLessThan(toolDefinitions.length);
    expect(READONLY_TOOL_NAMES.size).toBeGreaterThan(3);
  });
});
