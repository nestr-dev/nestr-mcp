import { describe, it, expect } from "vitest";
import {
  verifyPKCE,
  generateCodeChallenge,
  generateCodeVerifier,
} from "../../src/oauth/flow.js";
import {
  constantTimeCompare,
  validateRedirectUri,
} from "../../src/oauth/storage.js";

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
