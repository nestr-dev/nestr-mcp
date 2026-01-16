/**
 * OAuth Authorization Code Flow with PKCE
 *
 * Handles the OAuth flow where the MCP server acts as the OAuth client
 * and users authenticate directly with Nestr.
 */

import { randomBytes, createHash } from "node:crypto";
import { getOAuthConfig } from "./config.js";

/**
 * Pending OAuth authorization request
 * Stored temporarily while user completes auth on Nestr
 */
export interface PendingAuth {
  state: string;
  codeVerifier: string;
  redirectUri: string;
  createdAt: number;
  // Where to redirect after successful auth (for browser-based flow)
  finalRedirect?: string;
}

/**
 * OAuth token response from Nestr
 */
export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in: number;
  scope?: string;
}

/**
 * Stored OAuth session after successful authentication
 */
export interface OAuthSession {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  scope?: string;
}

// In-memory storage for pending auth requests (keyed by state)
// In production, use Redis or similar for multi-instance support
const pendingAuths = new Map<string, PendingAuth>();

// In-memory storage for OAuth sessions (keyed by session ID)
const oauthSessions = new Map<string, OAuthSession>();

// Cleanup interval for expired pending auths (5 minutes)
const PENDING_AUTH_TTL = 5 * 60 * 1000;

/**
 * Generate a cryptographically secure random string
 */
function generateRandomString(length: number): string {
  return randomBytes(length).toString("base64url").slice(0, length);
}

/**
 * Generate PKCE code verifier (43-128 characters)
 */
export function generateCodeVerifier(): string {
  return generateRandomString(64);
}

/**
 * Generate PKCE code challenge from verifier (S256 method)
 */
export function generateCodeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

/**
 * Generate OAuth state parameter
 */
export function generateState(): string {
  return generateRandomString(32);
}

/**
 * Create a new pending auth request and return the authorization URL
 *
 * Note: PKCE is disabled because Nestr's OAuth server doesn't support it.
 */
export function createAuthorizationRequest(
  redirectUri: string,
  finalRedirect?: string
): { authUrl: string; state: string } {
  const config = getOAuthConfig();

  if (!config.clientId) {
    throw new Error(
      "NESTR_OAUTH_CLIENT_ID environment variable is required for OAuth flow"
    );
  }

  const state = generateState();

  // Store pending auth (no PKCE - Nestr doesn't support it)
  pendingAuths.set(state, {
    state,
    codeVerifier: "", // Not used - PKCE disabled
    redirectUri,
    createdAt: Date.now(),
    finalRedirect,
  });

  // Build authorization URL (without PKCE params)
  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: redirectUri,
    state,
    scope: config.scopes.join(" "),
  });

  const authUrl = `${config.authorizationEndpoint}?${params}`;

  return { authUrl, state };
}

/**
 * Get and remove a pending auth request
 */
export function getPendingAuth(state: string): PendingAuth | undefined {
  const pending = pendingAuths.get(state);

  if (!pending) {
    return undefined;
  }

  // Check if expired
  if (Date.now() - pending.createdAt > PENDING_AUTH_TTL) {
    pendingAuths.delete(state);
    return undefined;
  }

  // Remove from pending (one-time use)
  pendingAuths.delete(state);

  return pending;
}

/**
 * Exchange authorization code for tokens
 *
 * Note: PKCE (code_verifier) is not used because Nestr doesn't support it.
 */
export async function exchangeCodeForTokens(
  code: string,
  _codeVerifier: string, // Unused - PKCE disabled
  redirectUri: string
): Promise<TokenResponse> {
  const config = getOAuthConfig();

  if (!config.clientId) {
    throw new Error("NESTR_OAUTH_CLIENT_ID is required");
  }

  const body: Record<string, string> = {
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: config.clientId,
  };

  // Add client secret (required by Nestr)
  if (config.clientSecret) {
    body.client_secret = config.clientSecret;
  }

  const response = await fetch(config.tokenEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Token exchange failed: ${response.status} - ${errorText}`);
  }

  return response.json() as Promise<TokenResponse>;
}

/**
 * Refresh an access token using refresh token
 */
export async function refreshAccessToken(
  refreshToken: string
): Promise<TokenResponse> {
  const config = getOAuthConfig();

  if (!config.clientId) {
    throw new Error("NESTR_OAUTH_CLIENT_ID is required");
  }

  const body: Record<string, string> = {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: config.clientId,
  };

  if (config.clientSecret) {
    body.client_secret = config.clientSecret;
  }

  const response = await fetch(config.tokenEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Token refresh failed: ${response.status} - ${errorText}`);
  }

  return response.json() as Promise<TokenResponse>;
}

/**
 * Store an OAuth session
 */
export function storeOAuthSession(
  sessionId: string,
  tokens: TokenResponse
): void {
  oauthSessions.set(sessionId, {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: Date.now() + tokens.expires_in * 1000,
    scope: tokens.scope,
  });
}

/**
 * Get an OAuth session, refreshing if needed
 */
export async function getOAuthSession(
  sessionId: string
): Promise<OAuthSession | undefined> {
  const session = oauthSessions.get(sessionId);

  if (!session) {
    return undefined;
  }

  // Check if token is expired (with 60s buffer)
  if (Date.now() >= session.expiresAt - 60000) {
    // Try to refresh
    if (session.refreshToken) {
      try {
        const tokens = await refreshAccessToken(session.refreshToken);
        storeOAuthSession(sessionId, tokens);
        return oauthSessions.get(sessionId);
      } catch {
        // Refresh failed, remove session
        oauthSessions.delete(sessionId);
        return undefined;
      }
    } else {
      // No refresh token, session expired
      oauthSessions.delete(sessionId);
      return undefined;
    }
  }

  return session;
}

/**
 * Remove an OAuth session
 */
export function removeOAuthSession(sessionId: string): void {
  oauthSessions.delete(sessionId);
}

/**
 * Cleanup expired pending auths (call periodically)
 */
export function cleanupPendingAuths(): void {
  const now = Date.now();
  for (const [state, pending] of pendingAuths) {
    if (now - pending.createdAt > PENDING_AUTH_TTL) {
      pendingAuths.delete(state);
    }
  }
}

// Run cleanup every minute
setInterval(cleanupPendingAuths, 60000);
