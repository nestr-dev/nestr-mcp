import { describe, it, expect } from "vitest";
import { toolDefinitions, schemas } from "../../src/tools/index.js";

// A tool is described to the model TWICE: once by the JSON Schema in
// toolDefinitions, which is what tools/list advertises, and once by the zod
// object the handler parses the call with. Only the first is visible to a
// client, so a parameter added to the second alone does not exist as far as any
// model is concerned.
//
// That is not hypothetical. nestr_register_connector accepted templateId in its
// zod schema and its description told the caller to pass one, while the
// advertised properties omitted it and required type and name. Nestradamus read
// the schema, concluded it could not create from a template, and refused to set
// up Moneybird rather than hand-build a CLI connector it would have had to guess
// the command for. The whole template path was unreachable.

function advertised(name: string) {
  const tool = toolDefinitions.find((t) => t.name === name);
  if (!tool) throw new Error(`no advertised tool named ${name}`);
  return tool.inputSchema as { properties: Record<string, unknown>; required?: string[] };
}

describe("nestr_register_connector's advertised schema", () => {
  it("declares templateId, the parameter its description tells callers to use", () => {
    expect(Object.keys(advertised("nestr_register_connector").properties)).toContain("templateId");
  });

  // With a template the transport comes from the template, so demanding these is
  // what made the path unreachable even once templateId was declared.
  it("requires only the workspace, so a template call is valid", () => {
    expect(advertised("nestr_register_connector").required).toEqual(["workspaceId"]);
  });
});

// The general form of the same defect, so the next parameter added to a zod
// schema alone fails here rather than silently never being offered.
const pairs: Array<[string, keyof typeof schemas]> = [
  ["nestr_register_connector", "registerConnector"],
  ["nestr_bind_connector", "bindConnector"],
  ["nestr_create_agent", "createAgent"],
];

describe("every zod parameter is advertised", () => {
  it.each(pairs)("%s", (toolName, schemaKey) => {
    const zodShape = Object.keys((schemas[schemaKey] as { shape: Record<string, unknown> }).shape);
    const declared = Object.keys(advertised(toolName).properties);

    expect(zodShape.filter((key) => !declared.includes(key))).toEqual([]);
  });
});

// And every VALUE of an enum, which is the same defect one level down and has
// already happened once on its own: nestr_bind_connector accepted ownerType
// "role" in zod, the handler implemented it, and the post-registration message
// told callers to use it, while the advertised enum listed only "role-domain"
// and "workspace". A client reading the schema could not reach the path the
// tool described as the usual one.
describe("every zod enum value is advertised", () => {
  it.each(pairs)("%s", (toolName, schemaKey) => {
    const shape = (schemas[schemaKey] as { shape: Record<string, unknown> }).shape;
    const declared = advertised(toolName).properties as Record<string, { enum?: string[] }>;

    Object.entries(shape).forEach(([key, def]) => {
      // Reach through .optional() to the enum underneath, and skip anything that
      // is not one: only a declared enum can drift from a declared enum.
      const inner = (def as { _def?: { innerType?: unknown } })?._def?.innerType ?? def;
      const options = (inner as { options?: unknown })?.options;
      if (!Array.isArray(options)) return;

      const advertisedValues = declared[key]?.enum;
      expect(advertisedValues, `${toolName}.${key} advertises an enum`).toBeDefined();
      expect([...options].sort()).toEqual([...(advertisedValues as string[])].sort());
    });
  });
});
