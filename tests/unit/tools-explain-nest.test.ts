import {
  describe, it, expect, vi, beforeEach, afterEach,
} from "vitest";
import { handleToolCall } from "../../src/tools/index.js";
import { NestrClient } from "../../src/api/client.js";

describe("nestr_explain_nest", () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  let client: NestrClient;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    client = new NestrClient({ apiKey: "test-token", baseUrl: "https://api.test.io/api" });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function mockResponse(status: number, body: unknown, ok = status < 400) {
    return {
      ok, status, json: async () => body, text: async () => JSON.stringify(body),
    };
  }

  it("requests provenance + rights + fieldsMetaData for the nest", async () => {
    mockFetch.mockResolvedValue(mockResponse(200, { _id: "n1", title: "x" }));
    const result = await handleToolCall(client, "nestr_explain_nest", { nestId: "n1" });
    expect(result.isError).toBeFalsy();
    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain("/nests/n1?");
    expect(url).toContain("provenance=true");
    expect(url).toContain("rights=true");
    expect(url).toContain("fieldsMetaData=true");
  });

  it("passes forUser and whoCan through", async () => {
    mockFetch.mockResolvedValue(mockResponse(200, { _id: "n1" }));
    await handleToolCall(client, "nestr_explain_nest", {
      nestId: "n1", forUser: "u5", whoCan: "update,delete",
    });
    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain("forUser=u5");
    expect(url).toContain("whoCan=update%2Cdelete");
  });
});
