/**
 * What an analytics event may carry about a tool call, and nothing more.
 *
 * Every value here goes to Google Analytics, so none of it may identify a
 * person or carry their content. Free text supplied by a client (its name, its
 * version, the consumer it claims) is cut down to a short label of safe
 * characters, and an error is reported as a fixed code, never as its message:
 * an API error message can echo a title, a name or an email address.
 */

import { NestrApiError } from "../api/client.js";

const SAFE_LABEL = /[^A-Za-z0-9._+-]/g;

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

/** A fixed code for a failed tool call. Never the error's message. */
export function errorCodeFor(error: unknown): string {
  if (error instanceof NestrApiError) return error.code;
  if (error instanceof Error) {
    if (error.name === "PrimeLabelConflictError") return "PRIME_LABEL_CONFLICT";
    if (error.name === "ZodError") return "VALIDATION_ERROR";
  }
  return "TOOL_ERROR";
}

/** Read when the tool is annotated read-only, write otherwise. */
export function accessFor(toolName: string, readOnlyTools: ReadonlySet<string>): "read" | "write" {
  return readOnlyTools.has(toolName) ? "read" : "write";
}

const ID = /^[A-Za-z0-9]{17}$/;
const MAX_PARSE = 500_000;

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
    if (ws && nestId && ID.test(nestId)) {
      if (this.byNest.size >= this.max && !this.byNest.has(nestId)) {
        const oldest = this.byNest.keys().next().value;
        if (oldest !== undefined) this.byNest.delete(oldest);
      }
      this.byNest.set(nestId, ws);
    }
    return ws;
  }
}
