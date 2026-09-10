import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NestrClient } from "../../src/api/client.js";
import { resolveHintLevel, withStrict, summariseApiSpec } from "../../src/tools/index.js";

describe("resolveHintLevel", () => {
  // The whole point of the level is that the right default differs by call shape: a
  // single read wants the teaching prose, a listing wants it once from nestr_help
  // rather than once per row.
  it("takes the caller-appropriate default when unset", () => {
    expect(resolveHintLevel(undefined, "full")).toBe("full");
    expect(resolveHintLevel(undefined, "summary")).toBe("summary");
  });

  it("treats a bare true as the default rather than as full", () => {
    expect(resolveHintLevel(true, "summary")).toBe("summary");
    expect(resolveHintLevel(true, "full")).toBe("full");
  });

  it("passes an explicit level through, overriding the default", () => {
    expect(resolveHintLevel("full", "summary")).toBe("full");
    expect(resolveHintLevel("summary", "full")).toBe("summary");
  });

  it("means none when false, whatever the default", () => {
    expect(resolveHintLevel(false, "full")).toBe(false);
    expect(resolveHintLevel(false, "summary")).toBe(false);
  });
});

describe("withStrict", () => {
  it("leaves the query alone unless asked", () => {
    expect(withStrict("label:role")).toBe("label:role");
    expect(withStrict("label:role", false)).toBe("label:role");
  });

  it("appends the operator when asked", () => {
    expect(withStrict("label:role", true)).toBe("label:role strict:true");
  });

  it("does not double-append when the caller already wrote it", () => {
    expect(withStrict("label:role strict:true", true)).toBe("label:role strict:true");
    expect(withStrict("strict:true label:role", true)).toBe("strict:true label:role");
  });
});

describe("summariseApiSpec", () => {
  const spec = {
    paths: {
      "/nests/{id}/children": {
        get: { summary: "Retrieve child nests of this nest" },
        post: { summary: "Create a new child nest under this parent" },
      },
      "/nests/{id}/hints": { get: { summary: "Hint counts across everything under this nest" } },
      "/tensions": { get: { summary: "List tensions" } },
    },
  };

  it("returns an operation index with a total", () => {
    const out = summariseApiSpec(spec) as { totalOperations: number; operations: unknown[] };
    expect(out.totalOperations).toBe(4);
    expect(out.operations).toHaveLength(4);
  });

  it("filters by keyword against path and summary", () => {
    const out = summariseApiSpec(spec, { search: "tension" }) as { matchedOperations: number };
    expect(out.matchedOperations).toBe(1);

    const bySummary = summariseApiSpec(spec, { search: "child" }) as { matchedOperations: number };
    expect(bySummary.matchedOperations).toBe(2);
  });

  // The reason this tool exists. "I did not find it" and "it is not there" are different
  // claims, and only one of them is safe to act on.
  it("says a zero match is a definitive negative, not a failed lookup", () => {
    const out = summariseApiSpec(spec, { search: "duration" }) as {
      matchedOperations: number;
      totalOperations: number;
      note: string;
    };
    expect(out.matchedOperations).toBe(0);
    expect(out.totalOperations).toBe(4);
    expect(out.note).toContain("does not serve one");
  });

  it("returns one operation in full when asked by path", () => {
    const out = summariseApiSpec(spec, { path: "/nests/{id}/hints" }) as {
      found: boolean;
      operations: Record<string, unknown>;
    };
    expect(out.found).toBe(true);
    expect(out.operations).toHaveProperty("get");
  });

  it("reports an unknown path as a negative and offers near misses", () => {
    const out = summariseApiSpec(spec, { path: "/nests/{id}/nonsense" }) as {
      found: boolean;
      didYouMean: string[];
    };
    expect(out.found).toBe(false);
    expect(out.didYouMean).toContain("/nests/{id}/children");
  });
});

describe("client read parameters", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: "success", data: [] }),
      text: async () => "{}",
    });
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => { vi.unstubAllGlobals(); });

  const client = () => new NestrClient({ apiKey: "k", baseUrl: "https://api.test.io/api" });
  const calledUrl = () => String(mockFetch.mock.calls[0][0]);

  it("sends a scoped search on the children route", async () => {
    await client().getNestChildren("nest1", { search: "label:role" });
    expect(calledUrl()).toContain("/nests/nest1/children?search=label%3Arole");
  });

  it("sends the hint level as a level, not a boolean", async () => {
    await client().getNestChildren("nest1", { hints: "summary" });
    expect(calledUrl()).toContain("hints=summary");
  });

  it("still sends the historical boolean form", async () => {
    await client().getNestChildren("nest1", { hints: true });
    expect(calledUrl()).toContain("hints=true");
  });

  it("sends hint filters and linkedUsers", async () => {
    await client().getNestChildren("nest1", {
      hintTypes: ["a", "b"],
      minSeverity: "warning",
      linkedUsers: true,
    });
    const url = calledUrl();
    expect(url).toContain("hintTypes=a%2Cb");
    expect(url).toContain("minSeverity=warning");
    expect(url).toContain("linkedUsers=true");
  });

  // sampleSize=0 means counts only. The API had this exact bug (`parseInt(x) || 10`
  // reads 0 as 10), so the client must not reintroduce it by treating 0 as absent.
  it("sends sampleSize=0 rather than dropping it as falsy", async () => {
    await client().getHintsRollup("nest1", { sampleSize: 0 });
    expect(calledUrl()).toContain("sampleSize=0");
  });

  it("omits sampleSize entirely when unset", async () => {
    await client().getHintsRollup("nest1");
    expect(calledUrl()).not.toContain("sampleSize");
  });

  it("fetches the OpenAPI document, not the swagger 2.0 one", async () => {
    await client().getApiSpec();
    expect(calledUrl()).toBe("https://api.test.io/api/openapi.json");
  });
});
