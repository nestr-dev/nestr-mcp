import { describe, it, expect, vi, afterEach } from "vitest";
import { toolDefinitions, READONLY_TOOL_NAMES } from "../../src/tools/index.js";
import { bearerIsReadOnly } from "../../src/api/readonly-bearer.js";
import { NestrClient } from "../../src/api/client.js";

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

describe("read-only bearer detection", () => {
  const clientReturning = (readOnly: boolean) => ({
    getTokenSelf: async () => ({ scope: ["nest:abc"], readOnly, workspaceIds: ["abc"], userIds: [] }),
  });

  it("reports a read-only key", async () => {
    expect(await bearerIsReadOnly(clientReturning(true))).toBe(true);
  });

  it("reports a normal key", async () => {
    expect(await bearerIsReadOnly(clientReturning(false))).toBe(false);
  });

  it("fails open when the lookup throws", async () => {
    const client = { getTokenSelf: async () => { throw new Error("boom"); } };
    expect(await bearerIsReadOnly(client)).toBe(false);
  });

  it("fails open against an older API that has no tokens/self payload", async () => {
    const client = { getTokenSelf: async () => undefined as never };
    expect(await bearerIsReadOnly(client)).toBe(false);
  });
});

// The route answers { status, data }. The first version of getTokenSelf returned
// that envelope untouched, so readOnly was always undefined and the whole feature
// was a no-op. These drive the real client against a stubbed response so the wire
// shape is what is asserted, not an assumed one.
describe("getTokenSelf unwrapping", () => {
  const respondWith = (payload: unknown) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(payload),
      json: async () => payload,
    }));
  };

  afterEach(() => { vi.unstubAllGlobals(); });

  it("reads readOnly out of the { status, data } envelope the API sends", async () => {
    respondWith({ status: "success", data: { scope: ["nest:abc", "access:read"], readOnly: true, workspaceIds: ["abc"], userIds: [] } });
    const client = new NestrClient({ apiKey: "k", baseUrl: "https://example.test/api" });
    const token = await client.getTokenSelf();
    expect(token.readOnly).toBe(true);
    expect(token.workspaceIds).toEqual(["abc"]);
    expect(await bearerIsReadOnly(client)).toBe(true);
  });

  it("still reads a bare payload", async () => {
    respondWith({ scope: ["nest:abc"], readOnly: false, workspaceIds: ["abc"], userIds: [] });
    const client = new NestrClient({ apiKey: "k", baseUrl: "https://example.test/api" });
    expect((await client.getTokenSelf()).readOnly).toBe(false);
  });
});
