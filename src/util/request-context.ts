/**
 * Request-scoped context.
 *
 * AsyncLocalStorage carries a per-request `correlationId` through every async
 * call inside `app.post("/mcp", ...)` so log lines emitted by deeply-nested
 * code (NestrClient, OAuth refresh, tool handlers) can be grepped by a single
 * id. The id is also exposed on tool errors so an LLM client can include it
 * in bug reports.
 *
 * Outside a request (e.g., during startup, or in tests that bypass the HTTP
 * layer) `getCorrelationId()` returns `undefined` and callers should treat
 * the absence as "no current request context".
 */
import { AsyncLocalStorage } from "node:async_hooks";

export interface RequestContext {
  correlationId: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithContext<T>(ctx: RequestContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

export function getCorrelationId(): string | undefined {
  return storage.getStore()?.correlationId;
}

/**
 * Format a `[cid=...]` log prefix for the current request, or an empty string
 * if there is no active context. Use as: `console.log(`${cidTag()}message`)`.
 */
export function cidTag(): string {
  const cid = getCorrelationId();
  return cid ? `[cid=${cid}] ` : "";
}
