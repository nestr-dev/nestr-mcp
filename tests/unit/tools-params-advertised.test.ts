import { describe, it, expect } from "vitest";
import { toolDefinitions, schemas } from "../../src/tools/index.js";

// A tool is described to the model twice: by the JSON Schema in `toolDefinitions`, which
// is what tools/list advertises, and by the zod object the handler parses with. Only the
// first is visible to a client, so a parameter present in the second alone does not exist
// as far as any model is concerned. It parses fine, it is documented in the code, and
// nothing can ever pass it.
//
// tools-advertised-schema.test.ts pins that failure for one tool it actually bit
// (nestr_register_connector's templateId, which made the whole template path
// unreachable). This is the sweep: every tool, every parameter, every time. It found
// `unread` on nestr_get_comments, a working filter no caller could reach.
const camel = (name: string) =>
  name.replace(/^nestr_/, "").replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

// Parameters deliberately absent from the advertised schema. Each needs a reason, so
// adding one is a decision rather than a way to silence the sweep.
// Empty, and worth keeping that way. The one entry this started with —
// nestr_list_tensions.order, a deprecated sort alias — was removed rather than excused
// once the API side confirmed `order` had never been read on any route. An unreachable
// parameter aliasing a name that never worked is not backward compatibility, it is two
// dead things propping each other up.
const INTENTIONALLY_UNADVERTISED: Record<string, string> = {};

describe("every zod parameter is advertised", () => {
  const pairs = toolDefinitions
    .map((tool) => ({ tool, schema: (schemas as Record<string, unknown>)[camel(tool.name)] }))
    .filter((p): p is { tool: typeof toolDefinitions[number]; schema: { shape: Record<string, unknown> } } =>
      !!p.schema && typeof (p.schema as { shape?: unknown }).shape === "object");

  it("matches most tools to a schema, so the sweep is not vacuous", () => {
    // Without this the two assertions below pass trivially if the name mapping breaks.
    expect(pairs.length).toBeGreaterThan(80);
  });

  it("advertises every parameter the handler accepts", () => {
    const gaps: string[] = [];
    for (const { tool, schema } of pairs) {
      const advertised = new Set(Object.keys(tool.inputSchema?.properties || {}));
      for (const key of Object.keys(schema.shape)) {
        if (advertised.has(key)) continue;
        if (INTENTIONALLY_UNADVERTISED[`${tool.name}.${key}`]) continue;
        gaps.push(`${tool.name}.${key}`);
      }
    }
    // A parameter here is documented in code and unreachable by any model.
    expect(gaps).toEqual([]);
  });

  it("keeps the exemption list honest", () => {
    for (const [entry, reason] of Object.entries(INTENTIONALLY_UNADVERTISED)) {
      expect(reason.length, `${entry} needs a real reason`).toBeGreaterThan(30);

      // A stale entry would hide a future gap of the same name.
      const [toolName, param] = entry.split(".");
      const pair = pairs.find((p) => p.tool.name === toolName);
      expect(pair, `${entry} names a tool that no longer exists`).toBeDefined();
      expect(Object.keys(pair!.schema.shape), `${entry} names a parameter that no longer exists`).toContain(param);
    }
  });
});
