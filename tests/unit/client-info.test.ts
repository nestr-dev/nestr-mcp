import { describe, it, expect, vi } from "vitest";
import {
  tagOAuthClientInfo,
  deriveOAuthBaseUrl,
} from "../../src/oauth/client-info.js";

describe("tagOAuthClientInfo", () => {
  function mockResponse(status: number, body = "", ok = status < 400) {
    return {
      ok,
      status,
      statusText: `status ${status}`,
      text: async () => body,
    } as unknown as Response;
  }

  it("POSTs form-urlencoded body with bearer auth to the right URL", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(mockResponse(204));
    const result = await tagOAuthClientInfo({
      bearerToken: "bearer-abc",
      baseUrl: "https://app.nestr.io",
      clientVersion: "2.1.15",
      clientSoftwareId: "claude-code",
      fetchImpl,
    });

    expect(result).toEqual({ ok: true, status: 204 });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, opts] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://app.nestr.io/oauth/tokens/client-info");
    expect(opts.method).toBe("POST");
    expect(opts.headers.Authorization).toBe("Bearer bearer-abc");
    expect(opts.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    const body = opts.body as URLSearchParams;
    expect(body.get("client_version")).toBe("2.1.15");
    expect(body.get("client_software_id")).toBe("claude-code");
  });

  it("omits client_software_id from body when not provided", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(mockResponse(204));
    await tagOAuthClientInfo({
      bearerToken: "bearer-abc",
      baseUrl: "https://app.nestr.io",
      clientVersion: "2.1.15",
      fetchImpl,
    });

    const body = fetchImpl.mock.calls[0][1].body as URLSearchParams;
    expect(body.get("client_version")).toBe("2.1.15");
    expect(body.has("client_software_id")).toBe(false);
  });

  it("omits client_version from body when not provided (software_id only)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(mockResponse(204));
    await tagOAuthClientInfo({
      bearerToken: "bearer-abc",
      baseUrl: "https://app.nestr.io",
      clientSoftwareId: "claude-code",
      fetchImpl,
    });

    const body = fetchImpl.mock.calls[0][1].body as URLSearchParams;
    expect(body.has("client_version")).toBe(false);
    expect(body.get("client_software_id")).toBe("claude-code");
  });

  it("returns ok:false without calling fetch when no fields are provided", async () => {
    const fetchImpl = vi.fn();
    const result = await tagOAuthClientInfo({
      bearerToken: "bearer-abc",
      baseUrl: "https://app.nestr.io",
      fetchImpl,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/no fields/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns ok:false without calling fetch when bearer token is empty", async () => {
    const fetchImpl = vi.fn();
    const result = await tagOAuthClientInfo({
      bearerToken: "",
      baseUrl: "https://app.nestr.io",
      clientVersion: "2.1.15",
      fetchImpl,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/bearer/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("strips trailing slash from baseUrl", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(mockResponse(204));
    await tagOAuthClientInfo({
      bearerToken: "bearer-abc",
      baseUrl: "https://app.nestr.io/",
      clientVersion: "2.1.15",
      fetchImpl,
    });

    expect(fetchImpl.mock.calls[0][0]).toBe("https://app.nestr.io/oauth/tokens/client-info");
  });

  it("surfaces non-2xx responses with status and body for logging", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      mockResponse(401, '{"error":"invalid_token"}'),
    );
    const result = await tagOAuthClientInfo({
      bearerToken: "bearer-abc",
      baseUrl: "https://app.nestr.io",
      clientVersion: "2.1.15",
      fetchImpl,
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(401);
    expect(result.error).toContain("invalid_token");
  });

  it("falls back to statusText when error body is empty", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(mockResponse(500, ""));
    const result = await tagOAuthClientInfo({
      bearerToken: "bearer-abc",
      baseUrl: "https://app.nestr.io",
      clientVersion: "2.1.15",
      fetchImpl,
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(500);
    expect(result.error).toBe("status 500");
  });

  it("catches network errors and returns ok:false", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const result = await tagOAuthClientInfo({
      bearerToken: "bearer-abc",
      baseUrl: "https://app.nestr.io",
      clientVersion: "2.1.15",
      fetchImpl,
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBeUndefined();
    expect(result.error).toContain("ECONNREFUSED");
  });

  // ─── Gate-equivalent shapes (clientInfo → tag call) ─────────────
  // The src/http.ts initialize handler gates this helper on
  // `(mcpClientVersion || mcpClientSoftwareId)`. The cases below mirror
  // the three gate-relevant clientInfo shapes so the test names line up
  // with the gate behavior they document.

  it("clientInfo with software_id only (no version) → fetch fires with client_software_id, no client_version", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(mockResponse(204));
    const result = await tagOAuthClientInfo({
      bearerToken: "bearer-abc",
      baseUrl: "https://app.nestr.io",
      clientSoftwareId: "anthropic/claude-code",
      fetchImpl,
    });

    expect(result.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledOnce();
    const body = fetchImpl.mock.calls[0][1].body as URLSearchParams;
    expect(body.has("client_version")).toBe(false);
    expect(body.get("client_software_id")).toBe("anthropic/claude-code");
  });

  it("clientInfo with both version and software_id → fetch fires with both fields in body", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(mockResponse(204));
    const result = await tagOAuthClientInfo({
      bearerToken: "bearer-abc",
      baseUrl: "https://app.nestr.io",
      clientVersion: "2.1.15",
      clientSoftwareId: "anthropic/claude-code",
      fetchImpl,
    });

    expect(result.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledOnce();
    const body = fetchImpl.mock.calls[0][1].body as URLSearchParams;
    expect(body.get("client_version")).toBe("2.1.15");
    expect(body.get("client_software_id")).toBe("anthropic/claude-code");
  });

  it("clientInfo with neither version nor software_id → no fetch call", async () => {
    const fetchImpl = vi.fn();
    const result = await tagOAuthClientInfo({
      bearerToken: "bearer-abc",
      baseUrl: "https://app.nestr.io",
      fetchImpl,
    });

    expect(result.ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("deriveOAuthBaseUrl", () => {
  it("strips trailing /api from NESTR_API_BASE", () => {
    expect(deriveOAuthBaseUrl("https://app.nestr.io/api")).toBe("https://app.nestr.io");
  });

  it("leaves base alone when /api suffix is absent", () => {
    expect(deriveOAuthBaseUrl("https://app.nestr.io")).toBe("https://app.nestr.io");
  });

  it("works for local dev URLs", () => {
    expect(deriveOAuthBaseUrl("http://localhost:4001/api")).toBe("http://localhost:4001");
  });

  it("defaults to production when no env value is provided", () => {
    expect(deriveOAuthBaseUrl(undefined)).toBe("https://app.nestr.io");
    expect(deriveOAuthBaseUrl("")).toBe("https://app.nestr.io");
  });
});
