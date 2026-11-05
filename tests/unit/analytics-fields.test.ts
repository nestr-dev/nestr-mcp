import { describe, it, expect } from "vitest";
import { NestrApiError } from "../../src/api/client.js";
import { PrimeLabelConflictError } from "../../src/tools/validation.js";
import { READONLY_TOOL_NAMES } from "../../src/tools/index.js";
import {
  safeLabel, errorCodeFor, accessFor, workspaceIdFromResult, WorkspaceResolver,
} from "../../src/analytics/fields.js";

const WS = "AbCdEfGhIjKlMnOpQ"; // 17-char id shape, not a real workspace
const NEST = "ZyXwVuTsRqPoNmLkJ";

const result = (body: unknown) => ({ content: [{ type: "text", text: JSON.stringify(body) }] });

describe("safeLabel", () => {
  it("keeps a client name or version as a short label", () => {
    expect(safeLabel("claude-code")).toBe("claude-code");
    expect(safeLabel("1.4.2+build.7", 24)).toBe("1.4.2+build.7");
  });

  it("drops anything that looks like an email address", () => {
    expect(safeLabel("someone@example.com")).toBeUndefined();
  });

  it("replaces unsafe characters and caps the length", () => {
    expect(safeLabel("My Client <script>")).toBe("My_Client_script_");
    expect(safeLabel("x".repeat(100))?.length).toBe(40);
  });

  it("returns undefined for non-strings and empty values", () => {
    expect(safeLabel(undefined)).toBeUndefined();
    expect(safeLabel("   ")).toBeUndefined();
  });
});

describe("errorCodeFor", () => {
  it("reports an API error by its code, never its message", () => {
    const err = new NestrApiError("Nest 'Quarterly plan for a client' not found", 404, "/nests/x");
    const code = errorCodeFor(err);
    expect(code).toBe("NOT_FOUND");
    expect(code).not.toContain("Quarterly");
  });

  it("maps known local errors to fixed codes", () => {
    expect(errorCodeFor(new PrimeLabelConflictError(["role", "project"]))).toBe("PRIME_LABEL_CONFLICT");
    const zod = new Error("Expected string, received number at title");
    zod.name = "ZodError";
    expect(errorCodeFor(zod)).toBe("VALIDATION_ERROR");
  });

  it("collapses anything else to one generic code", () => {
    expect(errorCodeFor(new Error("contains someone@example.com"))).toBe("TOOL_ERROR");
    expect(errorCodeFor("a string")).toBe("TOOL_ERROR");
  });
});

describe("accessFor", () => {
  it("follows the tools' own read-only annotations", () => {
    expect(READONLY_TOOL_NAMES.size).toBeGreaterThan(0);
    const readTool = [...READONLY_TOOL_NAMES][0];
    expect(accessFor(readTool, READONLY_TOOL_NAMES)).toBe("read");
    expect(READONLY_TOOL_NAMES.has("nestr_update_nest")).toBe(false);
    expect(accessFor("nestr_update_nest", READONLY_TOOL_NAMES)).toBe("write");
  });
});

describe("workspaceIdFromResult", () => {
  it("reads a nest's workspaceId", () => {
    expect(workspaceIdFromResult(result({ data: { _id: NEST, workspaceId: WS } }))).toBe(WS);
  });

  it("falls back to the last ancestor", () => {
    expect(workspaceIdFromResult(result({ _id: NEST, ancestors: [NEST, "ParentParentParen", WS] }))).toBe(WS);
  });

  it("reads the write envelope and list rows", () => {
    expect(workspaceIdFromResult(result({ message: "ok", nest: { status: "success", data: { ancestors: [NEST, WS] } } }))).toBe(WS);
    expect(workspaceIdFromResult(result({ items: [{ ancestors: [NEST, WS] }] }))).toBe(WS);
  });

  it("returns undefined for text that is not JSON or names no workspace", () => {
    expect(workspaceIdFromResult({ content: [{ type: "text", text: "plain help text" }] })).toBeUndefined();
    expect(workspaceIdFromResult(result({ ok: true }))).toBeUndefined();
  });
});

describe("WorkspaceResolver", () => {
  it("prefers the call's own workspaceId", () => {
    expect(new WorkspaceResolver().resolve({ workspaceId: WS })).toBe(WS);
  });

  it("remembers a nest's workspace for later calls in the session", () => {
    const r = new WorkspaceResolver();
    expect(r.resolve({ nestId: NEST }, result({ data: { workspaceId: WS } }))).toBe(WS);
    // A failed call has no result; the session still knows the nest.
    expect(r.resolve({ nestId: NEST })).toBe(WS);
  });

  it("stays bounded", () => {
    const r = new WorkspaceResolver(2);
    const id = (n: number) => `Nest${String(n).padStart(13, "0")}`;
    r.resolve({ nestId: id(1), workspaceId: WS });
    r.resolve({ nestId: id(2), workspaceId: WS });
    r.resolve({ nestId: id(3), workspaceId: WS });
    expect(r.resolve({ nestId: id(1) })).toBeUndefined();
    expect(r.resolve({ nestId: id(3) })).toBe(WS);
  });
});
