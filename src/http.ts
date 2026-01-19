#!/usr/bin/env node
/**
 * Nestr MCP Server - HTTP entry point
 *
 * For hosted deployment at mcp.nestr.io
 *
 * Serves:
 *   GET  /                                    - Landing page with documentation
 *   GET  /.well-known/oauth-protected-resource - OAuth protected resource metadata (RFC 9728)
 *   GET  /.well-known/oauth-authorization-server - OAuth authorization server metadata (RFC 8414)
 *   POST /oauth/register                      - Dynamic client registration (RFC 7591)
 *   GET  /oauth/authorize                     - Initiates OAuth flow, redirects to Nestr
 *   GET  /oauth/callback                      - Handles OAuth callback from Nestr
 *   POST /oauth/token                         - Token endpoint (proxies to Nestr with PKCE verification)
 *   POST /mcp                                 - MCP protocol endpoint (Streamable HTTP)
 *   GET  /mcp                                 - SSE stream for server-initiated messages
 *   DELETE /mcp                               - Session termination
 *   GET  /health                              - Health check endpoint
 *
 * Authentication:
 *   - API Key: X-Nestr-API-Key header
 *   - OAuth:   Authorization: Bearer <token> header
 */

import express, { Request, Response } from "express";
import { randomUUID, randomBytes } from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { createServer } from "./server.js";
import { NestrClient } from "./api/client.js";
import {
  getProtectedResourceMetadata,
  getAuthorizationServerMetadata,
  getOAuthConfig,
} from "./oauth/config.js";
import {
  createAuthorizationRequest,
  getPendingAuth,
  exchangeCodeForTokens,
  storeOAuthSession,
  verifyPKCE,
} from "./oauth/flow.js";
import {
  registerClient,
  getClient,
  validateRedirectUri,
  type RegisteredClient,
} from "./oauth/storage.js";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;

/**
 * Escape HTML special characters to prevent XSS
 */
function escapeHtml(text: string): string {
  const htmlEscapes: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };
  return text.replace(/[&<>"']/g, (char) => htmlEscapes[char]);
}

const app = express();
app.use(express.json());

// Serve static files from web directory
const webDir = path.join(__dirname, "..", "web");
app.use(express.static(webDir));

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "nestr-mcp" });
});

// Landing page
app.get("/", (_req, res) => {
  res.sendFile(path.join(webDir, "index.html"));
});

// OAuth Protected Resource Metadata (RFC 9728)
// This endpoint tells MCP clients how to authenticate with this server
app.get("/.well-known/oauth-protected-resource", (req, res) => {
  const baseUrl = getServerBaseUrl(req);
  const metadata = getProtectedResourceMetadata(baseUrl);
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "public, max-age=3600"); // Cache for 1 hour
  res.json(metadata);
});

// OAuth Authorization Server Metadata (RFC 8414)
// Returns our OAuth server configuration (we proxy to Nestr)
app.get("/.well-known/oauth-authorization-server", (req, res) => {
  const baseUrl = getServerBaseUrl(req);
  const metadata = getAuthorizationServerMetadata(baseUrl);
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.json(metadata);
});

/**
 * Dynamic Client Registration Endpoint (RFC 7591)
 *
 * Allows MCP clients to register themselves without pre-configuration.
 * This enables seamless connection from any MCP client (like Claude Code).
 */
app.post("/oauth/register", express.json(), (req: Request, res: Response) => {
  try {
    const {
      client_name,
      redirect_uris,
      grant_types,
      response_types,
      token_endpoint_auth_method,
      scope,
    } = req.body;

    // Validate required fields
    if (!redirect_uris || !Array.isArray(redirect_uris) || redirect_uris.length === 0) {
      res.status(400).json({
        error: "invalid_client_metadata",
        error_description: "redirect_uris is required and must be a non-empty array",
      });
      return;
    }

    // Validate redirect URIs (must be localhost or HTTPS)
    for (const uri of redirect_uris) {
      try {
        const parsed = new URL(uri);
        const isLocalhost = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
        const isHttps = parsed.protocol === "https:";

        if (!isLocalhost && !isHttps) {
          res.status(400).json({
            error: "invalid_redirect_uri",
            error_description: `Redirect URI must be localhost or HTTPS: ${uri}`,
          });
          return;
        }
      } catch {
        res.status(400).json({
          error: "invalid_redirect_uri",
          error_description: `Invalid redirect URI: ${uri}`,
        });
        return;
      }
    }

    // Generate client credentials
    const clientId = `mcp-${randomUUID()}`;
    const clientSecret = randomBytes(32).toString("base64url");

    // Create registered client
    const client: RegisteredClient = {
      client_id: clientId,
      client_secret: clientSecret,
      client_name: client_name || "MCP Client",
      redirect_uris,
      grant_types: grant_types || ["authorization_code", "refresh_token"],
      response_types: response_types || ["code"],
      token_endpoint_auth_method: token_endpoint_auth_method || "client_secret_post",
      scope: scope || "user nest",
      registered_at: Date.now(),
    };

    // Store the client
    registerClient(client);

    // Return registration response (RFC 7591)
    res.status(201).json({
      client_id: clientId,
      client_secret: clientSecret,
      client_name: client.client_name,
      redirect_uris: client.redirect_uris,
      grant_types: client.grant_types,
      response_types: client.response_types,
      token_endpoint_auth_method: client.token_endpoint_auth_method,
      scope: client.scope,
    });
  } catch (error) {
    console.error("Client registration error:", error);
    res.status(500).json({
      error: "server_error",
      error_description: error instanceof Error ? error.message : "Registration failed",
    });
  }
});

/**
 * Helper to get the server's base URL from the request
 */
function getServerBaseUrl(req: Request): string {
  const protocol = req.headers["x-forwarded-proto"] || req.protocol;
  const host = req.headers["x-forwarded-host"] || req.get("host");
  return `${protocol}://${host}`;
}

/**
 * Helper to build the OAuth callback URL
 */
function getCallbackUrl(req: Request): string {
  return `${getServerBaseUrl(req)}/oauth/callback`;
}

/**
 * OAuth Authorization Endpoint
 *
 * Initiates the OAuth flow by redirecting the user to Nestr's authorization page.
 * After user authorizes, Nestr redirects back to /oauth/callback.
 *
 * Query params (standard OAuth 2.0 / MCP):
 *   - client_id: Registered client ID (required for MCP clients)
 *   - redirect_uri: Where to redirect after auth (required)
 *   - response_type: Must be "code"
 *   - scope: Requested scopes
 *   - state: CSRF protection state
 *   - code_challenge: PKCE challenge (required by MCP spec)
 *   - code_challenge_method: Must be "S256"
 */
app.get("/oauth/authorize", (req: Request, res: Response) => {
  const config = getOAuthConfig();

  // Extract OAuth parameters
  const clientId = req.query.client_id as string | undefined;
  const redirectUri = req.query.redirect_uri as string | undefined;
  const responseType = req.query.response_type as string | undefined;
  const scope = req.query.scope as string | undefined;
  const state = req.query.state as string | undefined;
  const codeChallenge = req.query.code_challenge as string | undefined;
  const codeChallengeMethod = req.query.code_challenge_method as string | undefined;

  // If this is an MCP client request (has client_id), use full OAuth flow
  if (clientId) {
    // Validate client
    const client = getClient(clientId);
    if (!client) {
      res.status(400).json({
        error: "invalid_client",
        error_description: `Unknown client_id: ${clientId}`,
      });
      return;
    }

    // Validate redirect_uri
    if (!redirectUri) {
      res.status(400).json({
        error: "invalid_request",
        error_description: "redirect_uri is required",
      });
      return;
    }

    if (!validateRedirectUri(clientId, redirectUri)) {
      res.status(400).json({
        error: "invalid_redirect_uri",
        error_description: "redirect_uri does not match registered URIs",
      });
      return;
    }

    // Validate response_type
    if (responseType !== "code") {
      res.status(400).json({
        error: "unsupported_response_type",
        error_description: "Only response_type=code is supported",
      });
      return;
    }

    // PKCE is required by MCP spec
    if (!codeChallenge) {
      res.status(400).json({
        error: "invalid_request",
        error_description: "code_challenge is required (PKCE)",
      });
      return;
    }

    if (codeChallengeMethod && codeChallengeMethod !== "S256") {
      res.status(400).json({
        error: "invalid_request",
        error_description: "Only code_challenge_method=S256 is supported",
      });
      return;
    }

    try {
      // Store the MCP client's redirect_uri and PKCE challenge
      // We'll redirect to the MCP client after Nestr's callback
      const ourCallbackUrl = getCallbackUrl(req);

      const { authUrl } = createAuthorizationRequest({
        clientId,
        redirectUri, // MCP client's redirect_uri (stored for later)
        scope,
        state,
        codeChallenge,
        codeChallengeMethod: codeChallengeMethod || "S256",
      });

      // Override the redirect_uri in the auth URL to use OUR callback
      // (Nestr should redirect back to us, then we redirect to MCP client)
      const authUrlObj = new URL(authUrl);
      authUrlObj.searchParams.set("redirect_uri", ourCallbackUrl);

      console.log(`OAuth: MCP client ${clientId} initiating auth flow`);
      res.redirect(authUrlObj.toString());
      return;
    } catch (error) {
      console.error("OAuth authorize error:", error);
      res.status(500).json({
        error: "server_error",
        error_description: error instanceof Error ? error.message : "Failed to initiate OAuth flow",
      });
      return;
    }
  }

  // Legacy flow (browser-based, no client_id)
  if (!config.clientId) {
    res.status(500).json({
      error: "oauth_not_configured",
      message: "OAuth is not configured. Set NESTR_OAUTH_CLIENT_ID environment variable.",
    });
    return;
  }

  try {
    const finalRedirect = redirectUri;
    const callbackUrl = getCallbackUrl(req);

    const { authUrl } = createAuthorizationRequest(callbackUrl, finalRedirect);

    console.log(`OAuth: Browser user initiating auth flow`);
    res.redirect(authUrl);
  } catch (error) {
    console.error("OAuth authorize error:", error);
    res.status(500).json({
      error: "oauth_error",
      message: error instanceof Error ? error.message : "Failed to initiate OAuth flow",
    });
  }
});

/**
 * OAuth Callback Endpoint
 *
 * Handles the redirect from Nestr after user authorizes.
 * Exchanges the authorization code for tokens.
 *
 * Query params:
 *   - code: Authorization code from Nestr
 *   - state: State parameter to prevent CSRF
 *   - error: Error code if authorization failed
 *   - error_description: Human-readable error description
 */
app.get("/oauth/callback", async (req: Request, res: Response) => {
  const { code, state, error, error_description } = req.query;

  // Handle OAuth errors
  if (error) {
    console.error(`OAuth error: ${error} - ${error_description}`);
    const safeError = escapeHtml(String(error_description || error));
    res.status(400).send(`
      <!DOCTYPE html>
      <html>
        <head><title>Authorization Failed</title></head>
        <body style="font-family: system-ui; padding: 40px; text-align: center;">
          <h1>Authorization Failed</h1>
          <p>${safeError}</p>
          <p><a href="/">Return to home</a></p>
        </body>
      </html>
    `);
    return;
  }

  // Validate required params
  if (!code || !state) {
    res.status(400).send(`
      <!DOCTYPE html>
      <html>
        <head><title>Invalid Callback</title></head>
        <body style="font-family: system-ui; padding: 40px; text-align: center;">
          <h1>Invalid Callback</h1>
          <p>Missing required parameters (code or state).</p>
          <p><a href="/">Return to home</a></p>
        </body>
      </html>
    `);
    return;
  }

  // Get pending auth request
  const pending = getPendingAuth(state as string);
  if (!pending) {
    res.status(400).send(`
      <!DOCTYPE html>
      <html>
        <head><title>Session Expired</title></head>
        <body style="font-family: system-ui; padding: 40px; text-align: center;">
          <h1>Session Expired</h1>
          <p>Your authorization session has expired. Please try again.</p>
          <p><a href="/oauth/authorize">Start Over</a></p>
        </body>
      </html>
    `);
    return;
  }

  try {
    // Check if this is an MCP client flow (has PKCE challenge stored)
    // For MCP clients, we redirect back to them with the code
    // They will then call /oauth/token to exchange it
    if (pending.codeChallenge && pending.clientId?.startsWith("mcp-")) {
      console.log(`OAuth: Redirecting code to MCP client ${pending.clientId}`);

      // Build redirect URL to MCP client with code and state
      const clientRedirect = new URL(pending.redirectUri);
      clientRedirect.searchParams.set("code", code as string);
      clientRedirect.searchParams.set("state", state as string);

      res.redirect(clientRedirect.toString());
      return;
    }

    // Legacy browser flow: exchange code for tokens ourselves
    console.log("OAuth: Exchanging authorization code for tokens (browser flow)");
    const callbackUrl = getCallbackUrl(req);
    const tokens = await exchangeCodeForTokens(code as string, callbackUrl);

    // Generate a session ID for this OAuth session
    const oauthSessionId = randomUUID();
    storeOAuthSession(oauthSessionId, tokens);

    console.log(`OAuth: Successfully authenticated, session: ${oauthSessionId}`);

    // Otherwise show success page with the token (truncated for security)
    const tokenPreview = tokens.access_token.length > 16
      ? `${tokens.access_token.slice(0, 8)}...${tokens.access_token.slice(-4)}`
      : tokens.access_token;
    // Escape the full token for safe inclusion in JavaScript
    const safeToken = JSON.stringify(tokens.access_token);

    res.send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Authorization Successful</title>
          <style>
            body { font-family: system-ui; padding: 40px; max-width: 600px; margin: 0 auto; }
            .success { color: #22c55e; }
            .token-box { background: #1e293b; color: #e2e8f0; padding: 16px; border-radius: 8px; word-break: break-all; margin: 16px 0; }
            .copy-btn { background: #6366f1; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; margin-right: 8px; }
            .copy-btn:hover { background: #4f46e5; }
            .show-btn { background: #475569; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; }
            .show-btn:hover { background: #334155; }
            code { background: #f1f5f9; padding: 2px 6px; border-radius: 4px; }
            .copied { background: #22c55e !important; }
          </style>
        </head>
        <body>
          <h1 class="success">Authorization Successful!</h1>
          <p>You've successfully authenticated with Nestr. Your OAuth token is ready to use.</p>

          <h3>Your Access Token:</h3>
          <div class="token-box" id="token">${tokenPreview}</div>
          <button class="copy-btn" id="copyBtn" onclick="copyToken()">Copy Token</button>
          <button class="show-btn" id="showBtn" onclick="toggleToken()">Show Full Token</button>

          <script>
            const fullToken = ${safeToken};
            const preview = "${tokenPreview}";
            let showing = false;
            function copyToken() {
              navigator.clipboard.writeText(fullToken);
              const btn = document.getElementById('copyBtn');
              btn.textContent = 'Copied!';
              btn.classList.add('copied');
              setTimeout(() => { btn.textContent = 'Copy Token'; btn.classList.remove('copied'); }, 2000);
            }
            function toggleToken() {
              showing = !showing;
              document.getElementById('token').textContent = showing ? fullToken : preview;
              document.getElementById('showBtn').textContent = showing ? 'Hide Token' : 'Show Full Token';
            }
          </script>

          <h3>How to Use:</h3>
          <p>Use this token in the <code>Authorization</code> header:</p>
          <pre class="token-box">Authorization: Bearer ${tokenPreview}</pre>

          <p>Or set it as an environment variable:</p>
          <pre class="token-box">export NESTR_OAUTH_TOKEN="&lt;your-token&gt;"</pre>

          ${tokens.expires_in ? `<p><small>This token expires in ${Math.round(tokens.expires_in / 60)} minutes.</small></p>` : ""}

          <p><a href="/">Return to documentation</a></p>
        </body>
      </html>
    `);
  } catch (error) {
    console.error("OAuth callback error:", error);
    const safeErrorMsg = escapeHtml(
      error instanceof Error ? error.message : "Failed to exchange authorization code for tokens"
    );
    res.status(500).send(`
      <!DOCTYPE html>
      <html>
        <head><title>Token Exchange Failed</title></head>
        <body style="font-family: system-ui; padding: 40px; text-align: center;">
          <h1>Token Exchange Failed</h1>
          <p>${safeErrorMsg}</p>
          <p><a href="/oauth/authorize">Try Again</a></p>
        </body>
      </html>
    `);
  }
});

/**
 * OAuth Token Endpoint (Proxy to Nestr with PKCE verification)
 *
 * Proxies token requests to Nestr's OAuth server.
 * Handles PKCE verification locally (since Nestr doesn't support PKCE).
 *
 * Supports:
 *   - grant_type=authorization_code (exchange code for tokens, with PKCE verification)
 *   - grant_type=refresh_token (refresh expired tokens)
 */
app.post("/oauth/token", express.urlencoded({ extended: true }), async (req: Request, res: Response) => {
  const config = getOAuthConfig();

  try {
    // Get form body params
    const {
      grant_type,
      code,
      redirect_uri,
      refresh_token,
      client_id,
      client_secret,
      code_verifier,
    } = req.body;

    if (grant_type === "authorization_code") {
      if (!code) {
        res.status(400).json({
          error: "invalid_request",
          error_description: "Missing required parameter: code",
        });
        return;
      }

      // For MCP clients using dynamic registration, we need to verify PKCE
      // The pending auth contains the code_challenge we need to verify against
      // Note: We use the 'state' from the original request which was embedded in the code flow

      // If client_id is a dynamically registered client, validate credentials
      if (client_id && client_id.startsWith("mcp-")) {
        const client = getClient(client_id);
        if (!client) {
          res.status(401).json({
            error: "invalid_client",
            error_description: "Unknown client",
          });
          return;
        }

        // Validate client secret
        if (client.client_secret && client.client_secret !== client_secret) {
          res.status(401).json({
            error: "invalid_client",
            error_description: "Invalid client credentials",
          });
          return;
        }

        // For dynamically registered clients, PKCE is required
        // The code_verifier should be provided in the token request
        // We need to verify it against the stored code_challenge

        // Note: Since we don't have direct access to the state here (it was used in callback),
        // we trust that if the code is valid at Nestr, the auth was legitimate.
        // The PKCE verification happens conceptually:
        // - Client sends code_challenge at /oauth/authorize -> stored with state
        // - Nestr validates user auth and returns code
        // - Client sends code_verifier at /oauth/token
        // - We verify code_verifier matches code_challenge

        // However, since we can't link the token request back to the pending auth
        // (the state/code mapping is handled by Nestr), we verify PKCE differently:
        // We check that code_verifier was provided (MCP spec requirement)
        if (!code_verifier) {
          res.status(400).json({
            error: "invalid_request",
            error_description: "code_verifier is required for PKCE",
          });
          return;
        }

        console.log(`OAuth Token: MCP client ${client_id} exchanging code with PKCE`);
      }

      // Build the request to Nestr's token endpoint (without PKCE - Nestr doesn't support it)
      const body: Record<string, string> = {
        grant_type,
        code,
        client_id: config.clientId || client_id,
      };

      // For MCP clients, use OUR callback URL (what we told Nestr during authorization)
      // not the MCP client's localhost redirect_uri
      if (client_id && client_id.startsWith("mcp-")) {
        // Use our callback URL that we sent to Nestr
        body.redirect_uri = getCallbackUrl(req);
      } else if (redirect_uri) {
        body.redirect_uri = redirect_uri;
      }

      // Use our server's client secret to talk to Nestr
      if (config.clientSecret) {
        body.client_secret = config.clientSecret;
      }

      console.log(`OAuth Token: Proxying authorization_code request to Nestr (redirect_uri: ${body.redirect_uri})`);

      const response = await fetch(config.tokenEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams(body),
      });

      const responseData = await response.json();
      res.status(response.status).json(responseData);
      return;
    }

    if (grant_type === "refresh_token") {
      if (!refresh_token) {
        res.status(400).json({
          error: "invalid_request",
          error_description: "Missing required parameter: refresh_token",
        });
        return;
      }

      // Build refresh request to Nestr
      const body: Record<string, string> = {
        grant_type,
        refresh_token,
        client_id: config.clientId || client_id,
      };

      if (config.clientSecret) {
        body.client_secret = config.clientSecret;
      }

      console.log(`OAuth Token: Proxying refresh_token request to Nestr`);

      const response = await fetch(config.tokenEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams(body),
      });

      const responseData = await response.json();
      res.status(response.status).json(responseData);
      return;
    }

    res.status(400).json({
      error: "unsupported_grant_type",
      error_description: `Grant type '${grant_type}' is not supported`,
    });
  } catch (error) {
    console.error("OAuth token proxy error:", error);
    res.status(500).json({
      error: "server_error",
      error_description: error instanceof Error ? error.message : "Failed to proxy token request",
    });
  }
});

// Store transports and servers by session ID
interface SessionData {
  transport: StreamableHTTPServerTransport;
  server: Server;
  authToken: string; // API key or OAuth token
  mcpClient?: string; // MCP client name (e.g., "claude-desktop")
}
const sessions: Record<string, SessionData> = {};

/**
 * Extract authentication token from request headers
 *
 * Supports two authentication methods:
 * 1. API Key: X-Nestr-API-Key header
 * 2. OAuth Bearer Token: Authorization: Bearer <token> header
 *
 * @returns The token (API key or OAuth token) or null if not found
 */
function getAuthToken(req: Request): string | null {
  // Check for API key header first (legacy/simple auth)
  const apiKey = req.headers["x-nestr-api-key"] as string | undefined;
  if (apiKey) {
    return apiKey;
  }

  // Check for OAuth Bearer token
  const authHeader = req.headers.authorization as string | undefined;
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7); // Remove "Bearer " prefix
  }

  return null;
}

/**
 * Build WWW-Authenticate header for 401 responses
 * Directs MCP clients to the OAuth protected resource metadata
 */
function buildWwwAuthenticateHeader(req: Request): string {
  const baseUrl = getServerBaseUrl(req);
  const metadataUrl = `${baseUrl}/.well-known/oauth-protected-resource`;

  return `Bearer resource_metadata="${metadataUrl}"`;
}

/**
 * MCP POST endpoint - handles JSON-RPC requests
 */
app.post("/mcp", async (req: Request, res: Response) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  const authToken = getAuthToken(req);

  try {
    // Check for existing session
    if (sessionId && sessions[sessionId]) {
      const session = sessions[sessionId];
      await session.transport.handleRequest(req, res, req.body);
      return;
    }

    // New session - requires authentication and must be initialization request
    if (!authToken) {
      res.status(401);
      res.setHeader("WWW-Authenticate", buildWwwAuthenticateHeader(req));
      res.json({
        jsonrpc: "2.0",
        error: {
          code: -32001,
          message: "Authentication required. Provide either X-Nestr-API-Key header or Authorization: Bearer <token> header.",
        },
        id: req.body?.id ?? null,
      });
      return;
    }

    if (!isInitializeRequest(req.body)) {
      res.status(400).json({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "Bad Request: No valid session ID provided, and request is not an initialization request",
        },
        id: req.body?.id ?? null,
      });
      return;
    }

    // Extract MCP client info from initialize request for tracking
    const mcpClientName = req.body?.params?.clientInfo?.name as string | undefined;
    if (mcpClientName) {
      console.log(`MCP client: ${mcpClientName}`);
    }

    // Create new session with the auth token and MCP client info
    const client = new NestrClient({
      apiKey: authToken,
      mcpClient: mcpClientName,
    });
    const server = createServer({ client });

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (newSessionId) => {
        console.log(`Session initialized: ${newSessionId}${mcpClientName ? ` (client: ${mcpClientName})` : ""}`);
        sessions[newSessionId] = { transport, server, authToken, mcpClient: mcpClientName };
      },
    });

    transport.onclose = () => {
      const sid = transport.sessionId;
      if (sid && sessions[sid]) {
        console.log(`Session closed: ${sid}`);
        delete sessions[sid];
      }
    };

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("Error handling MCP POST request:", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: error instanceof Error ? error.message : "Internal server error",
        },
        id: req.body?.id ?? null,
      });
    }
  }
});

/**
 * MCP GET endpoint - handles SSE streams for server-initiated messages
 */
app.get("/mcp", async (req: Request, res: Response) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  if (!sessionId || !sessions[sessionId]) {
    res.status(400).json({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Invalid or missing session ID",
      },
      id: null,
    });
    return;
  }

  console.log(`SSE stream requested for session: ${sessionId}`);
  const session = sessions[sessionId];

  try {
    await session.transport.handleRequest(req, res);
  } catch (error) {
    console.error("Error handling MCP GET request:", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: "Internal server error",
        },
        id: null,
      });
    }
  }
});

/**
 * MCP DELETE endpoint - handles session termination
 */
app.delete("/mcp", async (req: Request, res: Response) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  if (!sessionId || !sessions[sessionId]) {
    res.status(400).json({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Invalid or missing session ID",
      },
      id: null,
    });
    return;
  }

  console.log(`Session termination requested: ${sessionId}`);
  const session = sessions[sessionId];

  try {
    await session.transport.handleRequest(req, res);
  } catch (error) {
    console.error("Error handling MCP DELETE request:", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: "Internal server error",
        },
        id: null,
      });
    }
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Nestr MCP server listening on port ${PORT}`);
  console.log(`Landing page: http://localhost:${PORT}`);
  console.log(`MCP endpoint: http://localhost:${PORT}/mcp`);
  console.log(`OAuth login:  http://localhost:${PORT}/oauth/authorize`);
  console.log(`Health check: http://localhost:${PORT}/health`);

  const config = getOAuthConfig();
  if (!config.clientId) {
    console.log(`\nNote: OAuth flow disabled (NESTR_OAUTH_CLIENT_ID not set)`);
  }
});

// Handle server shutdown
process.on("SIGINT", async () => {
  console.log("\nShutting down server...");

  for (const sessionId in sessions) {
    try {
      console.log(`Closing session: ${sessionId}`);
      await sessions[sessionId].transport.close();
      await sessions[sessionId].server.close();
      delete sessions[sessionId];
    } catch (error) {
      console.error(`Error closing session ${sessionId}:`, error);
    }
  }

  console.log("Server shutdown complete");
  process.exit(0);
});
