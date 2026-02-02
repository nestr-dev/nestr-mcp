/**
 * OAuth Authorization Code Flow with PKCE
 *
 * Handles the OAuth flow where the MCP server acts as the OAuth client
 * and users authenticate directly with Nestr.
 *
 * PKCE Support:
 * - MCP clients send PKCE parameters (code_challenge) to this server
 * - We verify the code_verifier against the stored code_challenge
 * - We proxy to Nestr WITHOUT PKCE (Nestr doesn't support it)
 * - This provides PKCE security from the MCP client's perspective
 */

import { randomBytes, createHash } from "node:crypto";
import { getOAuthConfig } from "./config.js";
import {
  storePendingAuth as storePendingAuthToDisk,
  consumePendingAuth as consumePendingAuthFromDisk,
  storeSession,
  getSession,
  updateSession,
  removeSession,
  type PendingAuthWithPKCE,
  type StoredOAuthSession,
} from "./storage.js";

/**
 * Pending OAuth authorization request
 * @deprecated Use PendingAuthWithPKCE from storage.ts
 */
export interface PendingAuth {
  state: string;
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
 * @deprecated Use StoredOAuthSession from storage.ts
 */
export type OAuthSession = StoredOAuthSession;

// Buffer time before token expiration to trigger refresh (60 seconds)
const TOKEN_EXPIRY_BUFFER_MS = 60 * 1000;

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
 * Parameters for creating an authorization request
 */
export interface AuthorizationRequestParams {
  clientId: string;
  redirectUri: string;
  scope?: string;
  state?: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
  /** Identifier for the MCP client (e.g., "claude-code", "cursor") for token metadata */
  clientConsumer?: string;
}

/**
 * Create a new pending auth request and return the authorization URL
 *
 * Supports PKCE: We store the code_challenge and verify it when the client
 * exchanges the code. Nestr doesn't support PKCE, so we handle it in our proxy.
 */
export function createAuthorizationRequest(
  redirectUri: string,
  finalRedirect?: string
): { authUrl: string; state: string };
export function createAuthorizationRequest(
  params: AuthorizationRequestParams
): { authUrl: string; state: string };
export function createAuthorizationRequest(
  redirectUriOrParams: string | AuthorizationRequestParams,
  finalRedirect?: string
): { authUrl: string; state: string } {
  const config = getOAuthConfig();

  // Handle legacy signature (redirectUri, finalRedirect)
  if (typeof redirectUriOrParams === "string") {
    if (!config.clientId) {
      throw new Error(
        "NESTR_OAUTH_CLIENT_ID environment variable is required for OAuth flow"
      );
    }

    const state = generateState();

    // Store pending auth with disk persistence
    storePendingAuthToDisk({
      state,
      redirectUri: redirectUriOrParams,
      clientId: config.clientId,
      createdAt: Date.now(),
    });

    // Build authorization URL (without PKCE - Nestr doesn't support it)
    const urlParams = new URLSearchParams({
      response_type: "code",
      client_id: config.clientId,
      redirect_uri: redirectUriOrParams,
      state,
      scope: config.scopes.join(" "),
    });

    const authUrl = `${config.authorizationEndpoint}?${urlParams}`;
    return { authUrl, state };
  }

  // New signature with full params (for dynamic client registration)
  const params = redirectUriOrParams;
  const state = params.state || generateState();

  // Store pending auth with PKCE info
  // redirectUri here is the MCP CLIENT's redirect_uri (where we redirect with the code)
  storePendingAuthToDisk({
    state,
    redirectUri: params.redirectUri, // MCP client's callback URL
    clientId: params.clientId,
    codeChallenge: params.codeChallenge,
    codeChallengeMethod: params.codeChallengeMethod,
    createdAt: Date.now(),
    scope: params.scope,
    clientConsumer: params.clientConsumer,
  });

  // Build authorization URL for Nestr (without PKCE - we handle it ourselves)
  // Use our configured client_id to talk to Nestr
  // IMPORTANT: We tell Nestr to redirect back to OUR callback, not the MCP client's
  const nestrClientId = config.clientId || params.clientId;

  // We need our own callback URL to be passed here, not the MCP client's
  // The caller should pass ourCallbackUrl in a separate field if needed
  // For now, we construct it - this will be overridden by http.ts
  const urlParams = new URLSearchParams({
    response_type: "code",
    client_id: nestrClientId,
    redirect_uri: params.redirectUri, // Will be overridden by caller with our callback URL
    state,
    scope: params.scope || config.scopes.join(" "),
  });

  // Pass client_consumer to Nestr for token metadata (identifies MCP client like claude-code, cursor)
  if (params.clientConsumer) {
    urlParams.set("client_consumer", params.clientConsumer);
  }

  const authUrl = `${config.authorizationEndpoint}?${urlParams}`;
  return { authUrl, state };
}

/**
 * Get and remove a pending auth request
 */
export function getPendingAuth(state: string): PendingAuthWithPKCE | undefined {
  return consumePendingAuthFromDisk(state);
}

/**
 * Verify PKCE code_verifier against stored code_challenge
 *
 * @param codeVerifier - The code_verifier from the token request
 * @param codeChallenge - The stored code_challenge from the auth request
 * @param method - The code_challenge_method (only S256 is supported)
 * @returns true if verification passes
 */
export function verifyPKCE(
  codeVerifier: string,
  codeChallenge: string,
  method: string = "S256"
): boolean {
  if (method !== "S256") {
    // Only S256 is supported per OAuth 2.1
    return false;
  }

  // Generate challenge from verifier and compare
  const computedChallenge = generateCodeChallenge(codeVerifier);
  return computedChallenge === codeChallenge;
}

/**
 * Exchange authorization code for tokens
 */
export async function exchangeCodeForTokens(
  code: string,
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
 * Store an OAuth session (persisted to disk)
 */
export function storeOAuthSession(
  sessionId: string,
  tokens: TokenResponse
): void {
  storeSession(sessionId, {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: Date.now() + tokens.expires_in * 1000,
    scope: tokens.scope,
  });
}

/**
 * Get an OAuth session, refreshing if needed (loaded from disk)
 */
export async function getOAuthSession(
  sessionId: string
): Promise<OAuthSession | undefined> {
  const session = getSession(sessionId);

  if (!session) {
    return undefined;
  }

  // Check if token is expired (with buffer to allow for refresh)
  if (Date.now() >= session.expiresAt - TOKEN_EXPIRY_BUFFER_MS) {
    // Try to refresh
    if (session.refreshToken) {
      try {
        const tokens = await refreshAccessToken(session.refreshToken);
        storeOAuthSession(sessionId, tokens);
        return getSession(sessionId);
      } catch {
        // Refresh failed, remove session
        removeSession(sessionId);
        return undefined;
      }
    } else {
      // No refresh token, session expired
      removeSession(sessionId);
      return undefined;
    }
  }

  return session;
}

/**
 * Remove an OAuth session (removes from disk)
 */
export function removeOAuthSession(sessionId: string): void {
  removeSession(sessionId);
}

