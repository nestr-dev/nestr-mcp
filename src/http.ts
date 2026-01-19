#!/usr/bin/env node
/**
 * Nestr MCP Server - HTTP entry point
 *
 * For hosted deployment at mcp.nestr.io
 *
 * Serves:
 *   GET  /                                    - Landing page with documentation
 *   GET  /.well-known/oauth-protected-resource - OAuth protected resource metadata (RFC 9728)
 *   GET  /oauth/authorize                     - Initiates OAuth flow, redirects to Nestr
 *   GET  /oauth/callback                      - Handles OAuth callback from Nestr
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
import { randomUUID } from "node:crypto";
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
} from "./oauth/flow.js";
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
 * Query params:
 *   - redirect_uri (optional): Where to redirect after successful auth
 */
app.get("/oauth/authorize", (req: Request, res: Response) => {
  const config = getOAuthConfig();

  if (!config.clientId) {
    res.status(500).json({
      error: "oauth_not_configured",
      message: "OAuth is not configured. Set NESTR_OAUTH_CLIENT_ID environment variable.",
    });
    return;
  }

  try {
    const finalRedirect = req.query.redirect_uri as string | undefined;
    const callbackUrl = getCallbackUrl(req);

    const { authUrl } = createAuthorizationRequest(callbackUrl, finalRedirect);

    console.log(`OAuth: Redirecting user to Nestr for authorization`);
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
    // Exchange code for tokens
    console.log("OAuth: Exchanging authorization code for tokens");
    const tokens = await exchangeCodeForTokens(
      code as string,
      pending.redirectUri
    );

    // Generate a session ID for this OAuth session
    const oauthSessionId = randomUUID();
    storeOAuthSession(oauthSessionId, tokens);

    console.log(`OAuth: Successfully authenticated, session: ${oauthSessionId}`);

    // If there's a final redirect, redirect there with the token
    // Validate redirect URL to prevent open redirect attacks
    if (pending.finalRedirect) {
      try {
        const serverOrigin = getServerBaseUrl(req);
        const redirectUrl = new URL(pending.finalRedirect, serverOrigin);
        // Only allow redirects to same origin or relative paths
        if (redirectUrl.origin === new URL(serverOrigin).origin) {
          redirectUrl.searchParams.set("oauth_session", oauthSessionId);
          res.redirect(redirectUrl.toString());
          return;
        }
        console.warn(`OAuth: Blocked redirect to external origin: ${redirectUrl.origin}`);
      } catch {
        console.warn(`OAuth: Invalid redirect URL: ${pending.finalRedirect}`);
      }
      // Fall through to show success page if redirect is invalid
    }

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
 * OAuth Token Endpoint (Proxy to Nestr)
 *
 * Proxies token requests to Nestr's OAuth server.
 * This allows MCP clients to exchange authorization codes and refresh tokens
 * through our server, even when Nestr is running on localhost.
 *
 * Supports:
 *   - grant_type=authorization_code (exchange code for tokens)
 *   - grant_type=refresh_token (refresh expired tokens)
 */
app.post("/oauth/token", express.urlencoded({ extended: true }), async (req: Request, res: Response) => {
  const config = getOAuthConfig();

  if (!config.clientId) {
    res.status(500).json({
      error: "server_error",
      error_description: "OAuth is not configured on this server",
    });
    return;
  }

  try {
    // Get form body params
    const { grant_type, code, redirect_uri, refresh_token, client_id, client_secret } = req.body;

    // Build the request to Nestr's token endpoint
    const body: Record<string, string> = {
      grant_type,
      client_id: client_id || config.clientId,
    };

    // Add client secret (use provided or our configured one)
    if (client_secret) {
      body.client_secret = client_secret;
    } else if (config.clientSecret) {
      body.client_secret = config.clientSecret;
    }

    if (grant_type === "authorization_code") {
      if (!code) {
        res.status(400).json({
          error: "invalid_request",
          error_description: "Missing required parameter: code",
        });
        return;
      }
      body.code = code;
      if (redirect_uri) {
        body.redirect_uri = redirect_uri;
      }
    } else if (grant_type === "refresh_token") {
      if (!refresh_token) {
        res.status(400).json({
          error: "invalid_request",
          error_description: "Missing required parameter: refresh_token",
        });
        return;
      }
      body.refresh_token = refresh_token;
    } else {
      res.status(400).json({
        error: "unsupported_grant_type",
        error_description: `Grant type '${grant_type}' is not supported`,
      });
      return;
    }

    console.log(`OAuth Token: Proxying ${grant_type} request to Nestr`);

    // Forward the request to Nestr's token endpoint
    const response = await fetch(config.tokenEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(body),
    });

    const responseData = await response.json();

    // Forward the response from Nestr
    res.status(response.status).json(responseData);
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
