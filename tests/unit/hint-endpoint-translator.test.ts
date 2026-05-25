import { describe, it, expect } from "vitest";
import { translateEndpoint, enrichHints, type ApiHintEndpoint } from "../../src/tools/index.js";

// ─── translateEndpoint ───────────────────────────────────────────────

describe("translateEndpoint", () => {
  it("POST /nests → nestr_create_nest with body fields", () => {
    const endpoint: ApiHintEndpoint = {
      purpose: "Create the project that resolves this tension.",
      method: "POST",
      path: "/nests",
      body_example: {
        parentId: "role-123",
        title: "Wire up GTM container",
        labels: ["project", "userstory"],
        fields: { "userstory.github_pr_url": "https://github.com/org/repo/pull/42" },
        users: ["user-1"],
      },
    };
    const result = translateEndpoint(endpoint);
    expect(result).toEqual({
      tool: "nestr_create_nest",
      purpose: "Create the project that resolves this tension.",
      parametersExample: {
        parentId: "role-123",
        title: "Wire up GTM container",
        labels: ["project", "userstory"],
        fields: { "userstory.github_pr_url": "https://github.com/org/repo/pull/42" },
        users: ["user-1"],
      },
    });
  });

  it("POST /nests/:id/tensions → nestr_create_tension with nestId from path", () => {
    const endpoint: ApiHintEndpoint = {
      purpose: "Sense a follow-up tension on another role.",
      method: "POST",
      path: "/nests/role-abc/tensions",
      body_example: { title: "Need scheduling clarity", feeling: "frustrated", needs: "predictability" },
    };
    const result = translateEndpoint(endpoint);
    expect(result?.tool).toBe("nestr_create_tension");
    expect(result?.parametersExample).toEqual({
      nestId: "role-abc",
      title: "Need scheduling clarity",
      feeling: "frustrated",
      needs: "predictability",
    });
  });

  it("POST /parts → nestr_add_tension_part (propose new item, no _id)", () => {
    const endpoint: ApiHintEndpoint = {
      purpose: "Propose a new role to absorb this work.",
      method: "POST",
      path: "/nests/circle-1/tensions/ten-2/parts",
      body_example: { title: "Customer Onboarding Guide", labels: ["role"], purpose: "Set new customers up for success" },
    };
    const result = translateEndpoint(endpoint);
    expect(result?.tool).toBe("nestr_add_tension_part");
    expect(result?.parametersExample).toEqual({
      nestId: "circle-1",
      tensionId: "ten-2",
      title: "Customer Onboarding Guide",
      labels: ["role"],
      purpose: "Set new customers up for success",
    });
    expect(result?.parametersExample).not.toHaveProperty("_id");
    expect(result?.parametersExample).not.toHaveProperty("removeNest");
  });

  it("PATCH /parts (body _id) → nestr_add_tension_part with _id (propose change)", () => {
    const endpoint: ApiHintEndpoint = {
      purpose: "Propose a change to the existing role.",
      method: "PATCH",
      path: "/nests/circle-1/tensions/ten-2/parts",
      body_example: { _id: "role-99", accountabilities: ["Maintaining onboarding docs"] },
    };
    const result = translateEndpoint(endpoint);
    expect(result?.tool).toBe("nestr_add_tension_part");
    expect(result?.parametersExample).toMatchObject({
      nestId: "circle-1",
      tensionId: "ten-2",
      _id: "role-99",
      accountabilities: ["Maintaining onboarding docs"],
    });
    expect(result?.parametersExample).not.toHaveProperty("removeNest");
  });

  it("DELETE /parts (body _id) → nestr_add_tension_part with _id + removeNest:true", () => {
    const endpoint: ApiHintEndpoint = {
      purpose: "Propose removal of an obsolete role.",
      method: "DELETE",
      path: "/nests/circle-1/tensions/ten-2/parts",
      body_example: { _id: "role-99" },
    };
    const result = translateEndpoint(endpoint);
    expect(result?.tool).toBe("nestr_add_tension_part");
    expect(result?.parametersExample).toEqual({
      nestId: "circle-1",
      tensionId: "ten-2",
      removeNest: true,
      _id: "role-99",
    });
  });

  it("DELETE /tensions/:tid → nestr_delete_tension", () => {
    const endpoint: ApiHintEndpoint = {
      purpose: "Drop this tension if it's no longer relevant.",
      method: "DELETE",
      path: "/nests/circle-1/tensions/ten-2",
    };
    const result = translateEndpoint(endpoint);
    expect(result?.tool).toBe("nestr_delete_tension");
    expect(result?.parametersExample).toEqual({ nestId: "circle-1", tensionId: "ten-2" });
  });

  it("preserves the API hint's purpose string verbatim", () => {
    const longPurpose =
      "use when you are requesting work from another role you do not energize " +
      "and the work is operational (not a structural change)";
    const endpoint: ApiHintEndpoint = {
      purpose: longPurpose,
      method: "POST",
      path: "/nests/r1/tensions",
      body_example: { title: "x" },
    };
    expect(translateEndpoint(endpoint)?.purpose).toBe(longPurpose);
  });

  it("strips /api/ prefix from the path", () => {
    const endpoint: ApiHintEndpoint = {
      purpose: "p",
      method: "POST",
      path: "/api/nests/role-1/tensions",
      body_example: { title: "x" },
    };
    expect(translateEndpoint(endpoint)?.tool).toBe("nestr_create_tension");
    expect(translateEndpoint(endpoint)?.parametersExample.nestId).toBe("role-1");
  });

  it("strips host + /api/ prefix from absolute URLs", () => {
    const endpoint: ApiHintEndpoint = {
      purpose: "p",
      method: "POST",
      path: "https://app.nestr.io/api/nests/role-1/tensions",
      body_example: { title: "x" },
    };
    expect(translateEndpoint(endpoint)?.tool).toBe("nestr_create_tension");
  });

  it("treats method as case-insensitive", () => {
    const endpoint: ApiHintEndpoint = {
      purpose: "p",
      method: "post",
      path: "/nests/r1/tensions",
      body_example: { title: "x" },
    };
    expect(translateEndpoint(endpoint)?.tool).toBe("nestr_create_tension");
  });

  it("drops body fields not in the tool's bodyParams and surfaces them in notes", () => {
    const endpoint: ApiHintEndpoint = {
      purpose: "p",
      method: "POST",
      path: "/nests/r1/tensions",
      body_example: { title: "x", role: "irrelevant", weird: "value" },
    };
    const result = translateEndpoint(endpoint);
    expect(result?.parametersExample).toEqual({ nestId: "r1", title: "x" });
    expect(result?.notes).toMatch(/role/);
    expect(result?.notes).toMatch(/weird/);
    expect(result?.notes).toContain("nestr_create_tension");
  });

  it("omits notes when all body fields map cleanly", () => {
    const endpoint: ApiHintEndpoint = {
      purpose: "p",
      method: "POST",
      path: "/nests/r1/tensions",
      body_example: { title: "x", description: "y" },
    };
    expect(translateEndpoint(endpoint)?.notes).toBeUndefined();
  });

  it("handles missing body_example", () => {
    const endpoint: ApiHintEndpoint = {
      purpose: "p",
      method: "DELETE",
      path: "/nests/r1/tensions/t1",
    };
    const result = translateEndpoint(endpoint);
    expect(result?.parametersExample).toEqual({ nestId: "r1", tensionId: "t1" });
    expect(result?.notes).toBeUndefined();
  });

  it("returns null for an unmapped route — never invents a tool", () => {
    const endpoint: ApiHintEndpoint = {
      purpose: "p",
      method: "PATCH",
      path: "/nests/r1/something/we/dont/handle",
      body_example: {},
    };
    expect(translateEndpoint(endpoint)).toBeNull();
  });

  it("returns null when method doesn't match the path", () => {
    // PUT /nests doesn't exist in the mapping table.
    const endpoint: ApiHintEndpoint = {
      purpose: "p",
      method: "PUT",
      path: "/nests",
    };
    expect(translateEndpoint(endpoint)).toBeNull();
  });

  it("returns null for missing method or path", () => {
    expect(translateEndpoint({ purpose: "p", method: "", path: "/nests" })).toBeNull();
    expect(translateEndpoint({ purpose: "p", method: "POST", path: "" })).toBeNull();
  });
});

// ─── enrichHints: endpoints → toolCalls ─────────────────────────────

describe("enrichHints with endpoints", () => {
  it("adds toolCalls array when hint has endpoints", () => {
    const data = {
      _id: "tension-1",
      hints: [
        {
          type: "no_proposed_output",
          label: "This tension needs an output.",
          severity: "suggestion",
          endpoints: [
            {
              purpose: "Create a project to resolve operationally.",
              method: "POST",
              path: "/nests",
              body_example: { parentId: "role-x", title: "Ship PR #42", labels: ["project"] },
            },
            {
              purpose: "Propose a governance change instead.",
              method: "POST",
              path: "/nests/circle-1/tensions/tension-1/parts",
              body_example: { title: "New role", labels: ["role"] },
            },
          ],
        },
      ],
    };
    const result = enrichHints(data) as { hints: Array<Record<string, unknown>> };
    const hint = result.hints[0];
    expect(hint).toHaveProperty("toolCalls");
    const toolCalls = hint.toolCalls as Array<Record<string, unknown>>;
    expect(toolCalls).toHaveLength(2);
    expect(toolCalls[0]).toMatchObject({
      tool: "nestr_create_nest",
      purpose: "Create a project to resolve operationally.",
    });
    expect(toolCalls[1]).toMatchObject({
      tool: "nestr_add_tension_part",
      purpose: "Propose a governance change instead.",
    });
  });

  it("preserves the original endpoints array verbatim", () => {
    const endpoints = [
      { purpose: "p", method: "DELETE", path: "/nests/r/tensions/t" },
    ];
    const data = {
      _id: "t",
      hints: [{ type: "x", label: "x", severity: "info", endpoints }],
    };
    const result = enrichHints(data) as { hints: Array<{ endpoints: unknown[] }> };
    expect(result.hints[0].endpoints).toEqual(endpoints);
  });

  it("drops unmapped endpoints silently — never invents tools", () => {
    const data = {
      _id: "t",
      hints: [
        {
          type: "x",
          label: "x",
          severity: "info",
          endpoints: [
            { purpose: "p", method: "POST", path: "/nests/r/tensions/t/parts" }, // mapped
            { purpose: "p", method: "PATCH", path: "/some/unknown/route" }, // unmapped
          ],
        },
      ],
    };
    const result = enrichHints(data) as { hints: Array<{ toolCalls: unknown[] }> };
    expect(result.hints[0].toolCalls).toHaveLength(1);
  });

  it("omits toolCalls field when all endpoints are unmapped", () => {
    const data = {
      _id: "t",
      hints: [
        {
          type: "x",
          label: "x",
          severity: "info",
          endpoints: [{ purpose: "p", method: "PATCH", path: "/unknown" }],
        },
      ],
    };
    const result = enrichHints(data) as { hints: Array<Record<string, unknown>> };
    expect(result.hints[0]).not.toHaveProperty("toolCalls");
  });

  it("legacy hints with only url still get toolCall (singular) — no regression", () => {
    const data = {
      _id: "t",
      hints: [{ type: "c", label: "Comments", severity: "info", url: "/nests/abc/posts" }],
    };
    const result = enrichHints(data) as { hints: Array<Record<string, unknown>> };
    expect(result.hints[0]).toHaveProperty("toolCall");
    expect(result.hints[0]).not.toHaveProperty("toolCalls");
  });

  it("populates both toolCall (legacy url) and toolCalls (endpoints) when a hint has both", () => {
    const data = {
      _id: "t",
      hints: [
        {
          type: "mixed",
          label: "x",
          severity: "info",
          url: "/nests/abc/posts",
          endpoints: [{ purpose: "p", method: "DELETE", path: "/nests/r/tensions/t" }],
        },
      ],
    };
    const result = enrichHints(data) as { hints: Array<Record<string, unknown>> };
    expect(result.hints[0]).toHaveProperty("toolCall");
    expect(result.hints[0]).toHaveProperty("toolCalls");
  });

  it("leaves hints with neither url nor endpoints unchanged", () => {
    const data = {
      _id: "t",
      hints: [{ type: "info", label: "no actions", severity: "info" }],
    };
    const result = enrichHints(data) as { hints: Array<Record<string, unknown>> };
    expect(result.hints[0]).not.toHaveProperty("toolCall");
    expect(result.hints[0]).not.toHaveProperty("toolCalls");
  });
});
