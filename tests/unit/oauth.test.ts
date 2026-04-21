import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createMockStore } from "../helpers/mock-store.js";

const mockStore = createMockStore();
vi.mock("../../src/oauth/store.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/oauth/store.js")>();
  return {
    ...actual,
    getStore: () => mockStore,
    initStore: vi.fn().mockResolvedValue(mockStore),
  };
});

const {
  verifyPKCE,
  generateCodeChallenge,
  generateCodeVerifier,
  getOAuthSession,
} = await import("../../src/oauth/flow.js");
const { constantTimeCompare, validateRedirectUri } = await import("../../src/oauth/storage.js");

// ─── PKCE ───────────────────────────────────────────────────────────

describe("verifyPKCE", () => {
  it("returns true for matching verifier and challenge", () => {
    const verifier = generateCodeVerifier();
    const challenge = generateCodeChallenge(verifier);
    expect(verifyPKCE(verifier, challenge, "S256")).toBe(true);
  });

  it("returns false for wrong verifier", () => {
    const verifier = generateCodeVerifier();
    const challenge = generateCodeChallenge(verifier);
    expect(verifyPKCE("wrong-verifier", challenge, "S256")).toBe(false);
  });

  it("returns false for non-S256 method", () => {
    const verifier = generateCodeVerifier();
    const challenge = generateCodeChallenge(verifier);
    expect(verifyPKCE(verifier, challenge, "plain")).toBe(false);
  });

  it("defaults method to S256", () => {
    const verifier = generateCodeVerifier();
    const challenge = generateCodeChallenge(verifier);
    expect(verifyPKCE(verifier, challenge)).toBe(true);
  });
});

describe("generateCodeVerifier", () => {
  it("returns a string of expected length", () => {
    const verifier = generateCodeVerifier();
    // 64 random bytes → base64url encoding ≈ 86 chars
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier.length).toBeLessThanOrEqual(128);
  });

  it("generates unique values", () => {
    const a = generateCodeVerifier();
    const b = generateCodeVerifier();
    expect(a).not.toBe(b);
  });
});

describe("generateCodeChallenge", () => {
  it("returns a base64url string", () => {
    const challenge = generateCodeChallenge("test-verifier");
    // base64url: no +, /, or = padding
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("is deterministic for same input", () => {
    const a = generateCodeChallenge("same-input");
    const b = generateCodeChallenge("same-input");
    expect(a).toBe(b);
  });
});

// ─── constantTimeCompare ────────────────────────────────────────────

describe("constantTimeCompare", () => {
  it("returns true for equal strings", () => {
    expect(constantTimeCompare("secret", "secret")).toBe(true);
  });

  it("returns false for different strings", () => {
    expect(constantTimeCompare("secret", "wrong")).toBe(false);
  });

  it("returns false for different lengths", () => {
    expect(constantTimeCompare("short", "longer-string")).toBe(false);
  });

  it("returns true for empty strings", () => {
    expect(constantTimeCompare("", "")).toBe(true);
  });
});

// ─── validateRedirectUri ────────────────────────────────────────────

describe("validateRedirectUri", () => {
  it("matches exact URI", () => {
    const client = { redirect_uris: ["https://example.com/callback"] };
    expect(validateRedirectUri(client, "https://example.com/callback")).toBe(true);
  });

  it("rejects non-matching URI", () => {
    const client = { redirect_uris: ["https://example.com/callback"] };
    expect(validateRedirectUri(client, "https://evil.com/callback")).toBe(false);
  });

  it("allows localhost with different ports", () => {
    const client = { redirect_uris: ["http://localhost:3000/callback"] };
    expect(validateRedirectUri(client, "http://localhost:8080/callback")).toBe(true);
  });

  it("allows 127.0.0.1 cross-matching with localhost", () => {
    const client = { redirect_uris: ["http://localhost:3000/callback"] };
    expect(validateRedirectUri(client, "http://127.0.0.1:9090/callback")).toBe(true);
  });

  it("requires matching pathname for localhost", () => {
    const client = { redirect_uris: ["http://localhost:3000/callback"] };
    expect(validateRedirectUri(client, "http://localhost:3000/other")).toBe(false);
  });

  it("does not apply port-agnostic matching for non-localhost", () => {
    const client = { redirect_uris: ["https://example.com:3000/callback"] };
    expect(validateRedirectUri(client, "https://example.com:8080/callback")).toBe(false);
  });
});

// ─── getOAuthSession single-flight refresh ──────────────────────────

describe("getOAuthSession — single-flight refresh", () => {
  const sessionId = "session-1";

  beforeEach(async () => {
    await mockStore.removeSession(sessionId);
    // Need NESTR_OAUTH_CLIENT_ID for refreshAccessToken to proceed
    process.env.NESTR_OAUTH_CLIENT_ID = "test-client";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("collapses N concurrent refreshes into a single /token call", async () => {
    // Store an already-expired session with a refresh token
    await mockStore.storeSession(sessionId, {
      accessToken: "old-access-token",
      refreshToken: "refresh-token-abc",
      expiresAt: Date.now() - 60_000, // expired 1 min ago
    });

    let fetchCallCount = 0;
    const fetchMock = vi.fn(async () => {
      fetchCallCount++;
      // Simulate latency so concurrent callers pile up before the first resolves
      await new Promise((r) => setTimeout(r, 50));
      return new Response(
        JSON.stringify({
          access_token: "new-access-token",
          refresh_token: "refresh-token-abc",
          token_type: "Bearer",
          expires_in: 3600,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    // Fire 10 concurrent calls
    const results = await Promise.all(
      Array.from({ length: 10 }, () => getOAuthSession(sessionId))
    );

    // All callers should get the refreshed session
    for (const r of results) {
      expect(r).toBeDefined();
      expect(r!.accessToken).toBe("new-access-token");
    }

    // But only ONE network call to /token
    expect(fetchCallCount).toBe(1);
  });

  it("allows a fresh refresh after the in-flight one completes", async () => {
    await mockStore.storeSession(sessionId, {
      accessToken: "old",
      refreshToken: "rt",
      expiresAt: Date.now() - 60_000,
    });

    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          access_token: "new",
          refresh_token: "rt",
          token_type: "Bearer",
          expires_in: -60, // still expired — forces next call to refresh again
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    await getOAuthSession(sessionId);
    await getOAuthSession(sessionId);

    // Two sequential expired sessions → two refresh calls (the lock released)
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

