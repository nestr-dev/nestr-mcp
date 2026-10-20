import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { handleToolCall, toolDefinitions } from "../../src/tools/index.js";
import { NestrClient } from "../../src/api/client.js";

// The MCP asked for cleanText=true on every description read, with no way to
// turn it off. cleanText turns the stored HTML into plain text, which flattens
// paragraphs and line breaks, so a fenced code block or anything else whose
// layout carries meaning came back as one line. The plain-text default stays;
// cleanText: false returns the description as stored.
const NEST = {
  _id: "n1",
  title: "Policy",
  labels: ["policy"],
  description: "<p>Line one</p><pre><code>a\nb</code></pre>",
};

describe("cleanText opt-out", () => {
  let client: NestrClient;
  let lastUrl: string;

  beforeEach(() => {
    lastUrl = "";
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      lastUrl = url;
      const body = url.includes("/nests/n1?") || url.endsWith("/nests/n1")
        ? NEST
        : { status: "success", meta: { total: 1 }, data: [NEST] };
      return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
    }));
    client = new NestrClient({ apiKey: "t", baseUrl: "https://api.test.io/api" });
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  const cases: Array<[string, Record<string, unknown>]> = [
    ["nestr_search", { workspaceId: "ws-1", query: "label:policy" }],
    ["nestr_get_nest", { nestId: "n1" }],
    ["nestr_get_nest_children", { nestId: "parent-1" }],
    ["nestr_get_projects", { workspaceId: "ws-1" }],
  ];

  it.each(cases)("%s still asks for plain text by default", async (tool, args) => {
    await handleToolCall(client, tool, args);
    expect(new URL(lastUrl).searchParams.get("cleanText")).toBe("true");
  });

  it.each(cases)("%s with cleanText: false asks for the stored HTML", async (tool, args) => {
    const result = await handleToolCall(client, tool, { ...args, cleanText: false });
    expect(result.isError).toBeFalsy();
    expect(new URL(lastUrl).searchParams.has("cleanText")).toBe(false);
  });

  it.each(cases.map(([t]) => [t]))("%s advertises cleanText and says what false returns", (tool) => {
    const def = toolDefinitions.find((t) => { return t.name === tool; });
    const prop = (def?.inputSchema.properties as Record<string, { type?: string; description?: string }>).cleanText;
    expect(prop?.type).toBe("boolean");
    expect(prop?.description).toMatch(/HTML/);
  });
});
