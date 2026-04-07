import { describe, it, expect, vi } from "vitest";

// Mock store and analytics before importing http module
vi.mock("../../src/oauth/store.js", () => ({
  getStore: () => ({}),
  initStore: vi.fn(),
}));
vi.mock("../../src/analytics/ga4.js", () => ({}));
vi.mock("mcpcat", () => ({
  default: { wrap: (_server: unknown) => _server },
}));

const { getAuthToken, escapeHtml, isValidGtmId } = await import("../../src/http.js");

// ─── getAuthToken ───────────────────────────────────────────────────

describe("getAuthToken", () => {
  it("extracts API key from X-Nestr-API-Key header", () => {
    const req = { headers: { "x-nestr-api-key": "my-api-key" } };
    expect(getAuthToken(req as any)).toBe("my-api-key");
  });

  it("extracts Bearer token from Authorization header", () => {
    const req = { headers: { authorization: "Bearer my-oauth-token" } };
    expect(getAuthToken(req as any)).toBe("my-oauth-token");
  });

  it("prefers API key over Bearer token", () => {
    const req = {
      headers: {
        "x-nestr-api-key": "api-key",
        authorization: "Bearer oauth-token",
      },
    };
    expect(getAuthToken(req as any)).toBe("api-key");
  });

  it("returns null when no auth headers present", () => {
    const req = { headers: {} };
    expect(getAuthToken(req as any)).toBeNull();
  });

  it("ignores non-Bearer Authorization header", () => {
    const req = { headers: { authorization: "Basic dXNlcjpwYXNz" } };
    expect(getAuthToken(req as any)).toBeNull();
  });
});

// ─── escapeHtml ─────────────────────────────────────────────────────

describe("escapeHtml", () => {
  it("escapes &", () => {
    expect(escapeHtml("a & b")).toBe("a &amp; b");
  });

  it("escapes <", () => {
    expect(escapeHtml("<script>")).toBe("&lt;script&gt;");
  });

  it("escapes quotes", () => {
    expect(escapeHtml('"hello\'')).toBe("&quot;hello&#39;");
  });

  it("returns empty string unchanged", () => {
    expect(escapeHtml("")).toBe("");
  });

  it("returns safe strings unchanged", () => {
    expect(escapeHtml("hello world")).toBe("hello world");
  });
});

// ─── isValidGtmId ───────────────────────────────────────────────────

describe("isValidGtmId", () => {
  it("accepts valid GTM ID", () => {
    expect(isValidGtmId("GTM-ABC123")).toBe(true);
  });

  it("rejects undefined", () => {
    expect(isValidGtmId(undefined)).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isValidGtmId("")).toBe(false);
  });

  it("rejects invalid format", () => {
    expect(isValidGtmId("not-a-gtm-id")).toBe(false);
    expect(isValidGtmId("GTM-")).toBe(false);
    expect(isValidGtmId("GTM-abc123")).toBe(false); // lowercase
  });
});
