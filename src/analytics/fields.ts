/**
 * What an analytics event may carry about a tool call, and nothing more.
 *
 * Every value here goes to Google Analytics. Free text supplied by a client
 * (its name, its version, the consumer it claims) is cut down to a short label
 * of safe characters. A failure is reported twice: as a fixed code, which groups
 * cleanly in reports, and as its message, kept on purpose with any email address
 * masked and capped at GA4's 100-character limit for a parameter value.
 */

import { NestrApiError } from "../api/client.js";

const SAFE_LABEL = /[^A-Za-z0-9._+-]/g;
const ID = /^[A-Za-z0-9]{17}$/;
const MAX_PARSE = 500_000;

/**
 * A short label of safe characters, or undefined. Anything that looks like an
 * email address is dropped outright rather than mangled into something that
 * still reads as one.
 */
export function safeLabel(value: unknown, max = 40): string | undefined {
  if (typeof value !== "string") return undefined;
  if (value.includes("@")) return undefined;
  const cleaned = value.trim().replace(SAFE_LABEL, "_").replace(/_+/g, "_").slice(0, max);
  return cleaned && cleaned !== "_" ? cleaned : undefined;
}

// The codes a tool error carries are an enum (ErrorCode in api/client.ts, plus
// VALIDATION and UNKNOWN from the tool handler). Anything not shaped like one is
// reported as UNKNOWN, so a message can never pass for a code.
const CODE = /^[A-Z][A-Z0-9_]{1,63}$/;
const asCode = (value: unknown): string => (typeof value === "string" && CODE.test(value) ? value : "UNKNOWN");

/**
 * A fixed code for an error that escaped the tool handler. Uses the same codes
 * the handler puts in its own error results. Never the error's message.
 */
export function errorCodeFor(error: unknown): string {
  if (error instanceof NestrApiError) return asCode(error.code);
  if (error instanceof Error && (error.name === "PrimeLabelConflictError" || error.name === "ZodError")) {
    return "VALIDATION";
  }
  return "UNKNOWN";
}

const MAX_MESSAGE = 100;
// Anything around an @ is masked whole, so a partial address cannot survive
// either: an API error can repeat the address a user typed.
const EMAIL = /\S*@\S*/g;
// Matching that pattern is quadratic on a long run without spaces (a JSON error
// body has none), so only this much is masked. Far more than the cap keeps, so
// an address straddling the cut lies beyond what is sent anyway.
const MAX_MASK = 1000;

function errorBody(result: unknown): { code?: unknown; error?: unknown; message?: unknown } | undefined {
  const content = (result as { content?: Array<{ type?: string; text?: string }> })?.content;
  const text = Array.isArray(content) ? content.find((c) => c && c.type === "text")?.text : undefined;
  if (!text || text.length > MAX_PARSE) return undefined;
  try {
    const body = JSON.parse(text);
    return body && typeof body === "object" ? body : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The tool handler reports a failure as a result with isError set and a
 * ToolError JSON body, rather than throwing. Reads that body's fixed code.
 */
export function errorCodeFromResult(result: unknown): string {
  return asCode(errorBody(result)?.code);
}

const capMessage = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.slice(0, MAX_MASK).replace(EMAIL, "[email]").replace(/\s+/g, " ").trim();
  return trimmed ? trimmed.slice(0, MAX_MESSAGE) : undefined;
};

/** The message of a ToolError result, emails masked, capped at GA4's parameter length. */
export function errorMessageFromResult(result: unknown): string | undefined {
  // ToolError carries `error: true` and the text in `message`.
  const body = errorBody(result);
  return capMessage(body?.message) ?? capMessage(body?.error);
}

/** The message of an error that escaped the handler, capped the same way. */
export function errorMessageFor(error: unknown): string | undefined {
  return capMessage(error instanceof Error ? error.message : undefined);
}

/** Read when the tool is annotated read-only, write otherwise. */
export function accessFor(toolName: string, readOnlyTools: ReadonlySet<string>): "read" | "write" {
  return readOnlyTools.has(toolName) ? "read" : "write";
}


function wsFrom(node: unknown): string | undefined {
  if (!node || typeof node !== "object") return undefined;
  const n = node as Record<string, unknown>;
  if (typeof n.workspaceId === "string" && ID.test(n.workspaceId)) return n.workspaceId;
  // A nest's ancestors end with its workspace.
  if (Array.isArray(n.ancestors) && n.ancestors.length > 0) {
    const last = n.ancestors[n.ancestors.length - 1];
    if (typeof last === "string" && ID.test(last)) return last;
  }
  return undefined;
}

/**
 * The workspace a tool result belongs to, read from the nest or rows it
 * returned. Undefined when the result names none or is too large to parse
 * cheaply.
 */
export function workspaceIdFromResult(result: unknown): string | undefined {
  const content = (result as { content?: Array<{ type?: string; text?: string }> })?.content;
  const text = Array.isArray(content) ? content.find((c) => c && c.type === "text")?.text : undefined;
  if (!text || text.length > MAX_PARSE) return undefined;
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return undefined;
  }
  const b = body as Record<string, unknown>;
  const candidates: unknown[] = [b, b?.data, (b?.nest as Record<string, unknown>)?.data, b?.nest];
  // A read of several nests at once returns them as a bare array.
  if (Array.isArray(body) && body.length > 0) candidates.push(body[0]);
  for (const list of [b?.items, b?.data]) {
    if (Array.isArray(list) && list.length > 0) candidates.push(list[0]);
  }
  for (const c of candidates) {
    const ws = wsFrom(c);
    if (ws) return ws;
  }
  return undefined;
}

/**
 * Resolves the workspace for a tool call: the call's own workspaceId, else the
 * one its result names, else the one an earlier call in this session learned
 * for the same nest. Remembers what it learns, bounded per session.
 */
export class WorkspaceResolver {
  private byNest = new Map<string, string>();

  constructor(private readonly max = 500) {}

  resolve(args: Record<string, unknown>, result?: unknown): string | undefined {
    const nestId = typeof args.nestId === "string" ? args.nestId : undefined;
    const direct = typeof args.workspaceId === "string" && ID.test(args.workspaceId) ? args.workspaceId : undefined;
    const ws = direct ?? (result !== undefined ? workspaceIdFromResult(result) : undefined)
      ?? (nestId ? this.byNest.get(nestId) : undefined);
    if (ws) {
      if (nestId) this.remember(nestId, ws);
      // A create returns the new nest's id, which later calls will pass as nestId.
      const created = result !== undefined ? nestIdFromResult(result) : undefined;
      if (created) this.remember(created, ws);
    }
    return ws;
  }

  private remember(nestId: string, ws: string): void {
    if (!ID.test(nestId) || nestId === ws) return;
    if (this.byNest.size >= this.max && !this.byNest.has(nestId)) {
      const oldest = this.byNest.keys().next().value;
      if (oldest !== undefined) this.byNest.delete(oldest);
    }
    this.byNest.set(nestId, ws);
  }
}

/** The id of the single nest a tool result returns, if it returns one. */
function nestIdFromResult(result: unknown): string | undefined {
  const content = (result as { content?: Array<{ type?: string; text?: string }> })?.content;
  const text = Array.isArray(content) ? content.find((c) => c && c.type === "text")?.text : undefined;
  if (!text || text.length > MAX_PARSE) return undefined;
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return undefined;
  for (const node of [body, body.data, body.nest, (body.nest as Record<string, unknown>)?.data]) {
    const id = (node as Record<string, unknown>)?._id;
    if (typeof id === "string" && ID.test(id)) return id;
  }
  return undefined;
}
