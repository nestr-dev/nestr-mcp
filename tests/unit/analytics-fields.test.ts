import { describe, it, expect } from "vitest";
import { NestrApiError } from "../../src/api/client.js";
import { PrimeLabelConflictError } from "../../src/tools/validation.js";
import { READONLY_TOOL_NAMES } from "../../src/tools/index.js";
import {
  safeLabel, errorCodeFor, errorCodeFromResult, errorMessageFromResult, errorMessageFor, accessFor, workspaceIdFromResult, WorkspaceResolver,
} from "../../src/analytics/fields.js";
import { createServer, type ToolCallInfo } from "../../src/server.js";
import type { NestrClient } from "../../src/api/client.js";

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
  it("reports an API error by its code", () => {
    const err = new NestrApiError("Nest 'Quarterly plan for a client' not found", 404, "/nests/x");
    const code = errorCodeFor(err);
    expect(code).toBe("NOT_FOUND");
    expect(code).not.toContain("Quarterly");
  });

  it("uses the handler's codes for local validation errors", () => {
    expect(errorCodeFor(new PrimeLabelConflictError(["role", "project"]))).toBe("VALIDATION");
    const zod = new Error("Expected string, received number at title");
    zod.name = "ZodError";
    expect(errorCodeFor(zod)).toBe("VALIDATION");
  });

  it("collapses anything else to UNKNOWN", () => {
    expect(errorCodeFor(new Error("contains someone@example.com"))).toBe("UNKNOWN");
    expect(errorCodeFor("a string")).toBe("UNKNOWN");
  });
});

describe("errorCodeFromResult", () => {
  const errResult = (body: unknown) => ({ isError: true, content: [{ type: "text", text: JSON.stringify(body) }] });

  it("reads the fixed code from a ToolError result", () => {
    expect(errorCodeFromResult(errResult({ error: "Nest 'Board plan' not found", code: "NOT_FOUND" }))).toBe("NOT_FOUND");
  });

  it("never lets a message pass as a code", () => {
    expect(errorCodeFromResult(errResult({ code: "someone@example.com" }))).toBe("UNKNOWN");
    expect(errorCodeFromResult(errResult({ code: "Nest not found" }))).toBe("UNKNOWN");
    expect(errorCodeFromResult({ isError: true, content: [{ type: "text", text: "not json" }] })).toBe("UNKNOWN");
  });
});

describe("error messages", () => {
  const errResult = (body: unknown) => ({ isError: true, content: [{ type: "text", text: JSON.stringify(body) }] });

  it("keeps the message of a ToolError result, capped at 100 characters", () => {
    expect(errorMessageFromResult(errResult({ error: true, code: "NOT_FOUND", message: "Nest not found" }))).toBe("Nest not found");
    expect(errorMessageFromResult(errResult({ error: true, code: "UNKNOWN", message: "x".repeat(300) }))?.length).toBe(100);
  });

  it("keeps the message of a thrown error, on one line", () => {
    expect(errorMessageFor(new Error("first line\nsecond line"))).toBe("first line second line");
    expect(errorMessageFor("not an error")).toBeUndefined();
  });

  it("masks a long message without spaces quickly", () => {
    // A JSON error body has no spaces; the mask pattern is quadratic on such a run.
    const start = Date.now();
    expect(errorMessageFor(new Error("x".repeat(200_000)))?.length).toBe(100);
    expect(Date.now() - start).toBeLessThan(500);
  });

  it("masks email addresses in a message, whole, before capping it", () => {
    expect(errorMessageFromResult(errResult({ error: true, code: "CONFLICT", message: "User jane.doe+x@example.co.uk already exists" })))
      .toBe("User [email] already exists");
    expect(errorMessageFor(new Error("Invite to <a@b> failed"))).toBe("Invite to [email] failed");
    // A long prefix must not push half an address past the cap unmasked.
    const long = errorMessageFromResult(errResult({ error: true, code: "UNKNOWN", message: "x ".repeat(48) + "someone@example.com" }));
    expect(long).not.toContain("@");
    expect(long).not.toContain("someone");
  });
});

describe("tool-call analytics through the server", () => {
  async function call(client: Partial<NestrClient>, name: string, args: Record<string, unknown>) {
    const seen: ToolCallInfo[] = [];
    const server = createServer({
      client: client as NestrClient,
      onToolCall: (_tool, _args, info) => { seen.push(info); },
    });
    const handler = (server as unknown as { _requestHandlers: Map<string, (req: unknown, extra: unknown) => Promise<unknown>> })
      ._requestHandlers.get("tools/call");
    if (!handler) throw new Error("tools/call handler not registered");
    await handler({ method: "tools/call", params: { name, arguments: args } }, {});
    return seen;
  }

  it("records a failed API call as a failure with its code and message", async () => {
    const failing = new Proxy({}, {
      get: () => async () => { throw new NestrApiError("Nest 'A private title' not found", 404, "/nests/x"); },
    }) as Partial<NestrClient>;
    const seen = await call(failing, "nestr_get_nest", { nestId: NEST });
    expect(seen).toHaveLength(1);
    expect(seen[0].success).toBe(false);
    expect(seen[0].errorCode).toBe("NOT_FOUND");
    expect(seen[0].errorMessage).toContain("not found");
    expect(seen[0].errorMessage!.length).toBeLessThanOrEqual(100);
    expect(seen[0].access).toBe("read");
    expect(seen[0].durationMs).toBeGreaterThanOrEqual(0);
  });

  it("masks an email address the API echoes back before it reaches analytics", async () => {
    const failing = new Proxy({}, {
      get: () => async () => { throw new NestrApiError("User jane@example.com is already a member", 400, "/workspaces/x/users"); },
    }) as Partial<NestrClient>;
    const seen = await call(failing, "nestr_get_nest", { nestId: NEST });
    expect(seen[0].success).toBe(false);
    expect(seen[0].errorMessage).toBe("User [email] is already a member");
  });

  it("records a successful call with the workspace from its result", async () => {
    const ok = new Proxy({}, {
      get: () => async () => ({ _id: NEST, workspaceId: WS, title: "x" }),
    }) as Partial<NestrClient>;
    const seen = await call(ok, "nestr_get_nest", { nestId: NEST });
    expect(seen[0].success).toBe(true);
    expect(seen[0].errorCode).toBeUndefined();
    expect(seen[0].errorMessage).toBeUndefined();
    expect(seen[0].workspaceId).toBe(WS);
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

  it("reads a bare array, as a read of several nests returns", () => {
    expect(workspaceIdFromResult(result([{ _id: NEST, workspaceId: WS }, { _id: "OtherOtherOtherOt", workspaceId: WS }]))).toBe(WS);
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

  it("remembers a nest the call created, for later calls on it", () => {
    const r = new WorkspaceResolver();
    expect(r.resolve({ parentId: "ParentParentParen" }, result({ nest: { status: "success", data: { _id: NEST, ancestors: [NEST, WS] } } }))).toBe(WS);
    // A later failed delete of the new nest has no result to read.
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
