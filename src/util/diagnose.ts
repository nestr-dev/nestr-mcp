/**
 * Snapshot of session-level state used by `nestr_diagnose`.
 *
 * Built fresh on each tool call (the getter is invoked per-call) so the
 * snapshot reflects the latest session state without the tool handler
 * needing direct access to the SessionData record.
 */
export interface DiagnoseSnapshot {
  flow: "A" | "B" | "unknown";
  tokenPresented: boolean;
  tokenFingerprint: string;
  /** Decoded iat/exp from the bearer if it parses as a JWT. `null` for opaque tokens / API keys. */
  tokenAge: { iat?: number; exp?: number; now: number } | null;
  lastUpstream401At?: number;
  lastRefreshAttempt?: { at: number; success: boolean; error?: string };
  sessionCorrelationId?: string;
  hasStoredOAuthSession: boolean;
  isApiKey: boolean;
  mcpClient?: string;
  userId?: string;
}

/**
 * Best-effort JWT decode for nestr_diagnose. Returns null when the token
 * isn't a JWT (e.g., API keys are opaque). Does NOT verify the signature —
 * we just want iat/exp for diagnostics. The check is intentionally narrow:
 * three base64url segments separated by dots, middle segment parses as JSON
 * with at least one of iat/exp.
 */
export function tryDecodeJwtAge(token: string): DiagnoseSnapshot["tokenAge"] {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf-8"));
    if (typeof payload !== "object" || payload === null) return null;
    const iat = typeof payload.iat === "number" ? payload.iat : undefined;
    const exp = typeof payload.exp === "number" ? payload.exp : undefined;
    if (iat === undefined && exp === undefined) return null;
    return { iat, exp, now: Math.floor(Date.now() / 1000) };
  } catch {
    return null;
  }
}
