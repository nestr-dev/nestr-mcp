/**
 * Tag an already-issued upstream OAuth token with MCP `clientInfo` metadata
 * (clientVersion / clientSoftwareId).
 *
 * Why: Phase 1 of the MCP `clientInfo` plumbing forwards `client_version` /
 * `client_software_id` to Nestr's OAuth server via authorize-URL query params.
 * Standard MCP clients (Claude Code, Cursor, Claude Desktop, etc.) don't put
 * those on the OAuth URL — they only emit `clientInfo` in the JSON-RPC
 * `initialize` handshake which lands AFTER the grant. So in real-world
 * traffic the upstream token row's clientVersion stays empty even though
 * the plumbing is in place.
 *
 * The slashme-online side exposes POST /oauth/tokens/client-info (bearer-
 * authenticated, form-urlencoded body) which writes `clientVersion` /
 * `clientSoftwareId` as metadata on the existing token row without touching
 * the dedup key. We call it once after capturing `clientInfo` at init.
 *
 * Fire-and-forget. Failures are logged and swallowed — the metadata is nice
 * to have but never load-bearing for the MCP session.
 */

export interface TagOAuthClientInfoOptions {
  /** Bearer token of the upstream OAuth row to tag. */
  bearerToken: string;
  /**
   * Base URL of the upstream OAuth server (e.g. `https://app.nestr.io`).
   * NOT the `/api` base — the endpoint lives at `${baseUrl}/oauth/tokens/client-info`.
   */
  baseUrl: string;
  /** Value for `clientInfo.version` from the MCP initialize handshake. */
  clientVersion?: string;
  /**
   * Value for `clientInfo.name` (or an extension `software_id`). Stored on
   * the token row alongside clientVersion for triage; not part of dedup.
   */
  clientSoftwareId?: string;
  /** Optional fetch override for tests. Defaults to globalThis.fetch. */
  fetchImpl?: typeof fetch;
}

export interface TagOAuthClientInfoResult {
  ok: boolean;
  /** HTTP status when the call completed; absent on network errors. */
  status?: number;
  /** Server-supplied or transport-level error message; absent on success. */
  error?: string;
}

/**
 * POST {baseUrl}/oauth/tokens/client-info with the bearer + form body.
 *
 * Returns `{ ok: false }` (without throwing) for missing inputs and network
 * errors so callers can use it as fire-and-forget without a try/catch.
 */
export async function tagOAuthClientInfo(
  opts: TagOAuthClientInfoOptions,
): Promise<TagOAuthClientInfoResult> {
  if (!opts.bearerToken) {
    return { ok: false, error: "missing bearer token" };
  }
  if (!opts.clientVersion && !opts.clientSoftwareId) {
    return { ok: false, error: "no fields to tag" };
  }

  const body = new URLSearchParams();
  if (opts.clientVersion) body.set("client_version", opts.clientVersion);
  if (opts.clientSoftwareId) body.set("client_software_id", opts.clientSoftwareId);

  const url = `${opts.baseUrl.replace(/\/$/, "")}/oauth/tokens/client-info`;
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;

  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.bearerToken}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, status: res.status, error: text || res.statusText };
    }
    return { ok: true, status: res.status };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Strip the trailing `/api` suffix off NESTR_API_BASE to get the OAuth host
 * (where `/oauth/tokens/client-info` lives, sibling to `/oauth/token`).
 */
export function deriveOAuthBaseUrl(apiBase?: string): string {
  const base = apiBase || "https://app.nestr.io/api";
  return base.replace(/\/api$/, "");
}
