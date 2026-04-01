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
 *   POST /oauth/device                        - Device authorization endpoint (RFC 8628)
 *   POST /oauth/token                         - Token endpoint (proxies to Nestr with PKCE verification)
 *   POST /mcp                                 - MCP protocol endpoint (Streamable HTTP)
 *   GET  /mcp                                 - SSE stream for server-initiated messages
 *   DELETE /mcp                               - Session termination
 *   GET  /health                              - Health check endpoint
 *
 * Authentication:
 *   - API Key: X-Nestr-API-Key header
 *   - OAuth:   Authorization: Bearer <token> header
 *
 * Response format:
 *   By default, POST /mcp returns SSE streams (text/event-stream).
 *   Send Accept: application/json (without text/event-stream) on the
 *   initialization request to get plain JSON responses for the entire session.
 */

import express, { Request, Response } from "express";
import { randomUUID, randomBytes } from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { createServer } from "./server.js";
import { NestrClient, NestrApiError } from "./api/client.js";
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
  getOAuthSession,
} from "./oauth/flow.js";
import {
  initStore,
  getStore,
  type RegisteredClient,
} from "./oauth/store.js";
import {
  constantTimeCompare,
  validateRedirectUri,
} from "./oauth/storage.js";
import { analytics, type AnalyticsContext } from "./analytics/index.js";
import "./analytics/ga4.js";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;
const GTM_ID = process.env.GTM_ID || process.env.NESTR_GTM_ID;

const GTM_ID_REGEX = /^GTM-[A-Z0-9]+$/;

function isValidGtmId(id: string | undefined): id is string {
  return !!id && GTM_ID_REGEX.test(id);
}

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

app.set("trust proxy", 1);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://www.googletagmanager.com"],
      connectSrc: ["'self'", "https://www.google-analytics.com"],
      imgSrc: ["'self'", "https://www.googletagmanager.com", "data:"],
      frameSrc: ["https://www.googletagmanager.com"],
    },
  },
}));

app.use(express.json({ limit: "1mb" }));

const oauthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "too_many_requests", error_description: "Too many requests, please try again later" },
});

const tokenLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "too_many_requests", error_description: "Too many token requests, please try again later" },
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "too_many_requests", error_description: "Too many registration requests" },
});

// Serve static files from web directory (index: false so "/" goes to route handler for GTM injection)
const webDir = path.join(__dirname, "..", "web");
app.use(express.static(webDir, { index: false }));

// Redirect /index.html to / for consistent GTM injection
app.get("/index.html", (_req, res) => res.redirect("/"));

// Health check (returns 503 during shutdown so k8s stops routing traffic)
app.get("/health", (_req, res) => {
  if (shuttingDown) {
    res.status(503).json({ status: "shutting_down", service: "nestr-mcp" });
    return;
  }
  res.json({ status: "ok", service: "nestr-mcp" });
});

// Landing page (with optional GTM injection)
app.get("/", (_req, res) => {
  const indexPath = path.join(webDir, "index.html");

  if (!isValidGtmId(GTM_ID)) {
    if (GTM_ID) {
      console.warn(`Invalid GTM_ID format: ${GTM_ID}. Expected format: GTM-XXXXXXX`);
    }
    res.sendFile(indexPath);
    return;
  }

  try {
    let html = fs.readFileSync(indexPath, "utf-8");

    const gtmScript = `<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer','${GTM_ID}');</script>`;

    const gtmNoscript = `<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=${GTM_ID}"
height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>`;

    html = html.replace("<!-- __GTM_SCRIPT__ -->", gtmScript);
    html = html.replace("<!-- __GTM_NOSCRIPT__ -->", gtmNoscript);

    res.setHeader("Content-Type", "text/html");
    res.send(html);
  } catch (error) {
    console.error("Error serving landing page:", error);
    res.sendFile(indexPath);
  }
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
app.post("/oauth/register", registerLimiter, express.json(), async (req: Request, res: Response) => {
  try {
    const store = getStore();
    const {
      client_name,
      redirect_uris,
      grant_types,
      response_types,
      token_endpoint_auth_method,
      scope,
    } = req.body;

    // Limit total registered clients to prevent unbounded growth
    const MAX_REGISTERED_CLIENTS = 1000;
    if (await store.getClientCount() >= MAX_REGISTERED_CLIENTS) {
      res.status(503).json({
        error: "server_error",
        error_description: "Maximum number of registered clients reached",
      });
      return;
    }

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
    await store.registerClient(client);

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
  const protocol = req.protocol;
  const host = req.hostname;
  // Include port if non-standard
  const port = req.get("host")?.split(":")[1];
  const portSuffix = port && !["80", "443"].includes(port) ? `:${port}` : "";
  return `${protocol}://${host}${portSuffix}`;
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
 *   - client_consumer: (optional) Identifier for the MCP client (e.g., "claude-code", "cursor")
 *   - _ga_client_id: (optional) GA4 client_id for cross-domain analytics
 */
app.get("/oauth/authorize", oauthLimiter, async (req: Request, res: Response) => {
  const config = getOAuthConfig();
  const store = getStore();

  // Extract OAuth parameters
  const clientId = req.query.client_id as string | undefined;
  const redirectUri = req.query.redirect_uri as string | undefined;
  const responseType = req.query.response_type as string | undefined;
  const scope = req.query.scope as string | undefined;
  const state = req.query.state as string | undefined;
  const codeChallenge = req.query.code_challenge as string | undefined;
  const codeChallengeMethod = req.query.code_challenge_method as string | undefined;
  const clientConsumer = req.query.client_consumer as string | undefined;

  // GA4 analytics: use provided client_id or generate new one for tracking
  const gaClientId = (req.query._ga_client_id as string | undefined) ||
    (analytics.isEnabled() ? analytics.generateClientId() : undefined);

  // If this is an MCP client request (has client_id), use full OAuth flow
  if (clientId) {
    // Validate client
    const client = await store.getClient(clientId);
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

    if (!validateRedirectUri(client, redirectUri)) {
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

      // Use client_consumer from URL if provided, otherwise fall back to client_name
      // from dynamic registration. This ensures tokens are properly tagged with the
      // MCP client identity (e.g., "claude-desktop", "cursor") for deduplication.
      // Normalize to lowercase for consistent matching with API layer.
      const effectiveClientConsumer = (clientConsumer || client.client_name)?.toLowerCase();

      const { authUrl } = await createAuthorizationRequest({
        clientId,
        redirectUri, // MCP client's redirect_uri (stored for later)
        scope,
        state,
        codeChallenge,
        codeChallengeMethod: codeChallengeMethod || "S256",
        clientConsumer: effectiveClientConsumer,
        gaClientId,
      });

      // Override the redirect_uri in the auth URL to use OUR callback
      // (Nestr should redirect back to us, then we redirect to MCP client)
      const authUrlObj = new URL(authUrl);
      authUrlObj.searchParams.set("redirect_uri", ourCallbackUrl);

      // Pass GA4 client_id to Nestr for cross-domain tracking (app.nestr.io will read it)
      // Also add UTM params for attribution fallback
      if (gaClientId) {
        authUrlObj.searchParams.set("_ga_client_id", gaClientId);
        authUrlObj.searchParams.set("utm_source", "mcp");
        authUrlObj.searchParams.set("utm_medium", "oauth");
        authUrlObj.searchParams.set("utm_campaign", effectiveClientConsumer || "nestr-mcp");
      }

      // Track OAuth flow start (wrapped to never break OAuth)
      if (gaClientId) {
        try {
          analytics.trackOAuthStart(
            { clientId: gaClientId, transport: "http" },
            { clientConsumer: effectiveClientConsumer }
          );
        } catch (e) { console.error("[Analytics] Error:", e); }
      }

      console.log(`OAuth: MCP client ${clientId} initiating auth flow${effectiveClientConsumer ? ` (consumer: ${effectiveClientConsumer})` : ""}`);
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

    const { authUrl } = await createAuthorizationRequest(callbackUrl, finalRedirect);

    // Add GA4 tracking params to auth URL for browser flow
    const authUrlObj = new URL(authUrl);
    if (gaClientId) {
      authUrlObj.searchParams.set("_ga_client_id", gaClientId);
      authUrlObj.searchParams.set("utm_source", "mcp");
      authUrlObj.searchParams.set("utm_medium", "oauth");
      authUrlObj.searchParams.set("utm_campaign", "browser-flow");

      try {
        analytics.trackOAuthStart(
          { clientId: gaClientId, transport: "http" },
          { clientConsumer: "browser" }
        );
      } catch (e) { console.error("[Analytics] Error:", e); }
    }

    console.log(`OAuth: Browser user initiating auth flow`);
    res.redirect(gaClientId ? authUrlObj.toString() : authUrl);
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
  const pending = await getPendingAuth(state as string);
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
    if (pending.codeChallenge && pending.clientId?.startsWith("mcp-")) {
      console.log(`OAuth: Redirecting code to MCP client ${pending.clientId}`);

      await getStore().storePkceForCode(
        code as string,
        pending.codeChallenge,
        pending.codeChallengeMethod || "S256"
      );

      const clientRedirect = new URL(pending.redirectUri);
      clientRedirect.searchParams.set("code", code as string);
      clientRedirect.searchParams.set("state", state as string);
      clientRedirect.searchParams.set("iss", getServerBaseUrl(req));

      res.redirect(clientRedirect.toString());
      return;
    }

    // Legacy browser flow: exchange code for tokens ourselves
    console.log("OAuth: Exchanging authorization code for tokens (browser flow)");
    const callbackUrl = getCallbackUrl(req);
    const tokens = await exchangeCodeForTokens(code as string, callbackUrl);

    // Try to fetch user_id for analytics (non-blocking)
    let userId: string | undefined;
    try {
      const tempClient = new NestrClient({ apiKey: tokens.access_token, baseUrl: process.env.NESTR_API_BASE });
      const currentUser = await tempClient.getCurrentUser();
      userId = currentUser._id;
    } catch (userError) {
      // Non-fatal: user_id is optional for analytics
      console.log("OAuth: Could not fetch user info for analytics:", userError);
    }

    // Key the session by access_token so getSession(authToken) can find it later.
    // This enables tokenProvider to do server-side token refresh for browser flow users.
    await storeOAuthSession(tokens.access_token, tokens, userId);

    // Track OAuth completion (wrapped to never break OAuth)
    if (pending.gaClientId) {
      try {
        analytics.trackOAuthComplete(
          { clientId: pending.gaClientId, userId, transport: "http" },
          { isNewUser: false } // TODO: Could detect new user by checking account age
        );
      } catch (e) { console.error("[Analytics] Error:", e); }
    }

    console.log(`OAuth: Successfully authenticated${userId ? ` (user: ${userId})` : ""}`);

    // Redirect to landing page with token in hash fragment (not sent to server logs)
    // The landing page JavaScript will detect this and display the token in context
    const encodedToken = encodeURIComponent(tokens.access_token);
    res.redirect(`/#token=${encodedToken}`);
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
 * Device Authorization Endpoint (RFC 8628)
 *
 * Initiates the device authorization flow for CLI tools and headless environments.
 * The client receives a device_code and user_code, displays the user_code to the user,
 * and polls the token endpoint until the user completes authorization.
 *
 * Request body:
 *   - client_id: The registered client ID
 *   - scope: (optional) Requested scopes
 *   - client_consumer: (optional) Identifier for the MCP client (e.g., "claude-code", "cursor")
 *
 * Response:
 *   - device_code: Code for the device to poll with
 *   - user_code: Short code for user to enter
 *   - verification_uri: URL for user to visit
 *   - verification_uri_complete: URL with user_code embedded (optional)
 *   - expires_in: Lifetime of codes in seconds
 *   - interval: Minimum polling interval in seconds
 */
app.post("/oauth/device", oauthLimiter, express.urlencoded({ extended: true }), async (req: Request, res: Response) => {
  const config = getOAuthConfig();

  try {
    const { client_id, scope, client_consumer } = req.body;

    // Require client_id
    if (!client_id) {
      res.status(400).json({
        error: "invalid_request",
        error_description: "Missing required parameter: client_id",
      });
      return;
    }

    // Validate client_id: must be a registered dynamic client or the server's own client
    let registeredClientName: string | undefined;
    if (client_id.startsWith("mcp-")) {
      const client = await getStore().getClient(client_id);
      if (!client) {
        res.status(401).json({
          error: "invalid_client",
          error_description: "Unknown client",
        });
        return;
      }
      registeredClientName = client.client_name;
    } else if (client_id !== config.clientId) {
      res.status(401).json({
        error: "invalid_client",
        error_description: "Unknown client",
      });
      return;
    }

    // Use client_consumer from request if provided, otherwise fall back to client_name
    // from dynamic registration. This ensures tokens are properly tagged with the
    // MCP client identity (e.g., "claude-desktop", "cursor") for deduplication.
    // Normalize to lowercase for consistent matching with API layer.
    const effectiveClientConsumer = (client_consumer || registeredClientName)?.toLowerCase();

    // Proxy to Nestr's device authorization endpoint
    const body: Record<string, string> = {
      client_id: config.clientId!, // Use our registered client_id with Nestr
      scope: scope || config.scopes.join(" "),
    };

    // Pass client_consumer to Nestr for token metadata
    if (effectiveClientConsumer) {
      body.client_consumer = effectiveClientConsumer;
    }

    console.log(`OAuth Device: Requesting device code from Nestr${effectiveClientConsumer ? ` (consumer: ${effectiveClientConsumer})` : ""}`);

    const response = await fetch(config.deviceAuthorizationEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(body),
    });

    const responseData = await response.json();
    res.status(response.status).json(responseData);
  } catch (error) {
    console.error("OAuth device authorization error:", error);
    res.status(500).json({
      error: "server_error",
      error_description: error instanceof Error ? error.message : "Failed to initiate device authorization",
    });
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
 *   - grant_type=urn:ietf:params:oauth:grant-type:device_code (device flow polling)
 *
 * Optional parameters:
 *   - client_consumer: Identifier for the MCP client (e.g., "claude-code", "cursor")
 *     Passed to Nestr for token metadata to differentiate tokens by consuming client.
 */
app.post("/oauth/token", tokenLimiter, express.urlencoded({ extended: true }), async (req: Request, res: Response) => {
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
      client_consumer,
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
        const client = await getStore().getClient(client_id);
        if (!client) {
          res.status(401).json({
            error: "invalid_client",
            error_description: "Unknown client",
          });
          return;
        }

        // Validate client secret (constant-time comparison to prevent timing attacks)
        if (client.client_secret && !constantTimeCompare(client.client_secret, client_secret || "")) {
          res.status(401).json({
            error: "invalid_client",
            error_description: "Invalid client credentials",
          });
          return;
        }
      }

      // PKCE verification for all authorization_code grants
      const pkceData = await getStore().consumePkceForCode(code);
      if (pkceData) {
        // PKCE was stored for this code - verify it
        if (!code_verifier) {
          res.status(400).json({
            error: "invalid_request",
            error_description: "code_verifier is required for PKCE",
          });
          return;
        }

        if (!verifyPKCE(code_verifier, pkceData.codeChallenge, pkceData.codeChallengeMethod)) {
          console.warn(`PKCE verification failed for client ${client_id}`);
          res.status(400).json({
            error: "invalid_grant",
            error_description: "PKCE verification failed",
          });
          return;
        }
      } else if (client_id?.startsWith("mcp-")) {
        // PKCE data missing for an MCP client — code may have been retried or expired
        console.warn(`PKCE data missing for mcp- client ${client_id} — code may have been retried`);
      }

      // Build the request to Nestr's token endpoint (without PKCE - Nestr doesn't support it)
      // IMPORTANT: Always use OUR callback URL and client credentials when talking to Nestr
      // The redirect_uri must match what we used during authorization
      const body: Record<string, string> = {
        grant_type,
        code,
        client_id: config.clientId!, // Always use our registered client_id
        redirect_uri: getCallbackUrl(req), // Always use our callback URL
      };

      // Use our server's client secret to talk to Nestr
      if (config.clientSecret) {
        body.client_secret = config.clientSecret;
      }

      // Pass client_consumer to Nestr for token metadata
      if (client_consumer) {
        body.client_consumer = client_consumer;
      }

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

    // Device code grant type (RFC 8628)
    if (grant_type === "urn:ietf:params:oauth:grant-type:device_code") {
      const { device_code } = req.body;

      if (!device_code) {
        res.status(400).json({
          error: "invalid_request",
          error_description: "Missing required parameter: device_code",
        });
        return;
      }

      // Proxy to Nestr's token endpoint
      const body: Record<string, string> = {
        grant_type,
        device_code,
        client_id: config.clientId!,
      };

      if (config.clientSecret) {
        body.client_secret = config.clientSecret;
      }

      // Pass client_consumer to Nestr for token metadata (if provided again during polling)
      if (client_consumer) {
        body.client_consumer = client_consumer;
      }

      console.log(`OAuth Token: Polling device code at Nestr${client_consumer ? ` (consumer: ${client_consumer})` : ""}`);

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
  analytics?: AnalyticsContext; // GA4 analytics context
  toolCallCount?: number; // Count of tool calls for session end tracking
  sessionStartTime?: number; // Session start time for duration tracking
  lastActivityAt: number; // Timestamp of last request (for session coalescing)
  initCallCount: number; // Number of initialize requests coalesced into this session
  sseResponse?: Response; // Active SSE stream response (for liveness check)
}
const sessions: Record<string, SessionData> = {};
let shuttingDown = false;

/**
 * Session coalescing for poorly-behaved clients that create a new MCP connection per tool call.
 * If an initialize request arrives with the same auth token + client name as a recent session
 * (within 10 minutes, fewer than 5 original init requests), reuse the existing session.
 * The initCallCount limit prevents unbounded coalescing — after 5 inits it's either a
 * legitimately new session or a client that needs fixing.
 */
const SESSION_COALESCE_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const SESSION_COALESCE_MAX_INITS = 5;
const SESSION_STALE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes without activity

// Periodically clean up dead sessions (closed SSE + stale)
setInterval(() => {
  const now = Date.now();
  for (const [sid, session] of Object.entries(sessions)) {
    const sseAlive = session.sseResponse && !session.sseResponse.writableEnded;
    const stale = (now - session.lastActivityAt) > SESSION_STALE_TIMEOUT_MS;
    if (!sseAlive && stale) {
      delete sessions[sid];
    }
  }
}, 60000);

function findCoalescableSession(authToken: string, mcpClient: string | undefined): { sessionId: string; session: SessionData } | undefined {
  const now = Date.now();
  let bestMatch: { sessionId: string; session: SessionData; lastActivity: number } | undefined;

  for (const [sid, session] of Object.entries(sessions)) {
    if (
      session.authToken === authToken &&
      session.mcpClient === mcpClient &&
      session.initCallCount < SESSION_COALESCE_MAX_INITS &&
      (now - session.lastActivityAt) < SESSION_COALESCE_WINDOW_MS &&
      session.sseResponse && !session.sseResponse.writableEnded // Only coalesce if SSE stream is alive
    ) {
      // Pick the most recently active session if multiple match
      if (!bestMatch || session.lastActivityAt > bestMatch.lastActivity) {
        bestMatch = { sessionId: sid, session, lastActivity: session.lastActivityAt };
      }
    }
  }

  return bestMatch ? { sessionId: bestMatch.sessionId, session: bestMatch.session } : undefined;
}

/**
 * Cache resolved identities by auth token to avoid repeated /users/me calls.
 * Cursor-vscode reconnects every ~60s, and workspace API keys sent as Bearer tokens
 * would otherwise 403 on /users/me every time. This cache ensures we resolve once
 * and reuse across sessions with the same token.
 * TTL: 10 minutes — long enough to survive reconnection storms, short enough to
 * pick up token changes (e.g., after OAuth refresh).
 */
const identityCache = new Map<string, { userId: string; userName?: string; expiresAt: number }>();
const IDENTITY_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

function getCachedIdentity(token: string): { userId: string; userName?: string } | undefined {
  const entry = identityCache.get(token);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    identityCache.delete(token);
    return undefined;
  }
  return { userId: entry.userId, userName: entry.userName };
}

function cacheIdentity(token: string, userId: string, userName?: string) {
  identityCache.set(token, { userId, userName, expiresAt: Date.now() + IDENTITY_CACHE_TTL_MS });
}

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
  const isApiKey = !!req.headers["x-nestr-api-key"];

  // Strip sensitive headers so they don't leak into MCP SDK's extra.requestInfo
  // (which MCPCat and other middleware can capture)
  delete req.headers.authorization;
  delete req.headers["x-nestr-api-key"];
  delete req.headers.cookie;

  try {
    // Support Accept: application/json for non-streaming JSON responses.
    // The MCP SDK requires both application/json and text/event-stream in Accept,
    // but clients wanting plain JSON can send just application/json.
    // We detect this and amend the header so SDK validation passes.
    const acceptHeader = req.headers.accept || "";
    const wantsJsonOnly = acceptHeader.includes("application/json") && !acceptHeader.includes("text/event-stream");
    if (wantsJsonOnly) {
      req.headers.accept = `${acceptHeader}, text/event-stream`;
    }

    // Check for existing session
    if (sessionId && sessions[sessionId]) {
      const session = sessions[sessionId];
      session.lastActivityAt = Date.now();
      await session.transport.handleRequest(req, res, req.body);
      return;
    }

    // Session ID was provided but not found - return 404 per MCP spec
    // This signals compliant clients to re-initialize automatically
    if (sessionId) {
      console.log(`Session not found: ${sessionId} (server may have restarted)`);
      res.status(404).json({
        jsonrpc: "2.0",
        error: {
          code: -32001,
          message: "Session not found",
        },
        id: req.body?.id ?? null,
      });
      return;
    }

    // Reject new session creation during shutdown
    if (shuttingDown) {
      res.status(503).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Server is shutting down, please retry" },
        id: req.body?.id ?? null,
      });
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

    // Extract MCP client info early (needed for coalescing check)
    const mcpClientName = req.body?.params?.clientInfo?.name as string | undefined;

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

    // Session coalescing: if a client sends repeated initialize requests with the same
    // auth token + client name (common with agent frameworks that create a new connection
    // per tool call), reuse the existing session instead of creating a new one.
    const coalescable = findCoalescableSession(authToken, mcpClientName);
    if (coalescable) {
      const { sessionId: existingSid, session: existingSession } = coalescable;
      existingSession.initCallCount++;
      existingSession.lastActivityAt = Date.now();
      console.log(`Session coalesced: reusing ${existingSid} for ${mcpClientName || "unknown client"} (init #${existingSession.initCallCount})`);
      await existingSession.transport.handleRequest(req, res, req.body);
      return;
    }
    if (mcpClientName) {
      console.log(`MCP client: ${mcpClientName}`);
    }

    let userId: string | undefined;
    let userName: string | undefined;

    // Check cross-session identity cache first (survives cursor-vscode reconnections)
    const cached = getCachedIdentity(authToken);
    if (cached) {
      userId = cached.userId;
      userName = cached.userName;
    } else if (isApiKey) {
      // For API keys, resolve identity by fetching the workspace name.
      // API keys can't call /users/me, so we identify by workspace instead.
      try {
        const tempClient = new NestrClient({ apiKey: authToken });
        const result = await tempClient.listWorkspaces({ limit: 1 });
        const workspaces = Array.isArray(result) ? result : (result as any)?.data || [];
        if (Array.isArray(workspaces) && workspaces.length > 0) {
          const ws = workspaces[0];
          userId = ws._id;
          userName = `${ws.title} (API key)`;
          cacheIdentity(authToken, ws._id, userName);
        }
      } catch (e) {
        console.log('[Identity] API key workspace lookup failed:', e instanceof Error ? e.message : e);
      }
    } else {
      // For OAuth/Bearer tokens, check if we have a stored session (browser flow).
      try {
        const storedSession = await getStore().getSession(authToken);
        if (storedSession?.userId) {
          userId = storedSession.userId;
        }
      } catch (e) { console.error("[GA4] Analytics lookup error:", e); }

      // If no stored session, resolve eagerly. This handles both standard MCP OAuth
      // tokens and workspace API keys sent as Bearer tokens (common with cursor).
      if (!userId) {
        try {
          const tempClient = new NestrClient({ apiKey: authToken, baseUrl: process.env.NESTR_API_BASE });
          const currentUser = await tempClient.getCurrentUser();
          const user = (currentUser as any)?.data || currentUser;
          if (user?._id) {
            userId = user._id;
            userName = user.profile?.fullName || user._id;
            cacheIdentity(authToken, user._id, userName);
          }
        } catch {
          // getCurrentUser failed — likely a workspace API key sent as Bearer token.
          // Fall back to workspace name, same as the API key path.
          try {
            const tempClient = new NestrClient({ apiKey: authToken, baseUrl: process.env.NESTR_API_BASE });
            const result = await tempClient.listWorkspaces({ limit: 1 });
            const workspaces = Array.isArray(result) ? result : (result as any)?.data || [];
            if (Array.isArray(workspaces) && workspaces.length > 0) {
              const ws = workspaces[0];
              userId = ws._id;
              userName = `${ws.title} (Bearer key)`;
              cacheIdentity(authToken, ws._id, userName);
            }
          } catch (wsErr) {
            console.log('[Identity] Bearer token identity resolution failed:', wsErr instanceof Error ? wsErr.message : wsErr);
          }
        }
      }
    }

    // Create analytics context for this MCP session (wrapped to never break MCP)
    let analyticsCtx: AnalyticsContext | undefined;
    try {
      analyticsCtx = analytics.isEnabled() ? {
        clientId: analytics.generateClientId(),
        userId,
        mcpClient: mcpClientName,
        transport: "http",
      } : undefined;
    } catch (e) { console.error("[Analytics] Context creation error:", e); }

    // Track tool calls for analytics
    // We use a mutable ref so the callback can access the session's analytics context
    // after the session is initialized, and to allow tokenProvider to invalidate the session
    let sessionRef: SessionData | undefined;

    // Check if we have a stored session for this token (browser flow).
    // Standard MCP OAuth clients manage tokens client-side and won't have a stored session.
    const hasStoredSession = !isApiKey && !!(await getStore().getSession(authToken));

    // Create new session with the auth token and MCP client info
    const client = new NestrClient({
      apiKey: authToken,
      baseUrl: process.env.NESTR_API_BASE,
      mcpClient: mcpClientName,
      // tokenProvider enables server-side token refresh for stored sessions (browser flow).
      // In the standard MCP OAuth flow, there's no stored session — the client manages refresh.
      // When tokenProvider is undefined, NestrClient lets 401 propagate to the client.
      tokenProvider: hasStoredSession ? async () => {
        const session = await getOAuthSession(authToken);
        if (!session) {
          // Stored session expired and refresh failed — remove the MCP session
          // so the next request triggers re-initialization
          const sid = sessionRef?.transport?.sessionId;
          if (sid && sessions[sid]) {
            console.log(`OAuth session expired mid-session, removing MCP session: ${sid}`);
            delete sessions[sid];
          }
          throw new NestrApiError("OAuth session expired", 401, "/", {
            code: "AUTH_FAILED",
            hint: "Your OAuth session has expired or the server was restarted. Reconnect to the MCP server to re-authenticate.",
          });
        }
        return session.accessToken;
      } : undefined,
    });

    const server = createServer({
      client,
      userId,
      userName,
      onToolCall: (toolName, args, success, error) => {
        try {
          if (sessionRef?.analytics) {
            // Increment tool call count
            if (sessionRef.toolCallCount !== undefined) {
              sessionRef.toolCallCount++;
            }

            // Track the tool call
            analytics.trackToolCall(sessionRef.analytics, {
              toolName,
              workspaceId: (args as Record<string, unknown>).workspaceId as string | undefined,
              success,
              errorCode: error,
            });
          }
        } catch (e) { console.error("[Analytics] Tool call tracking error:", e); }
      },
    });

    const sessionStartTime = Date.now();

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      enableJsonResponse: wantsJsonOnly,
      onsessioninitialized: (newSessionId) => {
        console.log(`Session initialized: ${newSessionId}${mcpClientName ? ` (client: ${mcpClientName})` : ""}`);
        sessions[newSessionId] = {
          transport,
          server,
          authToken,
          mcpClient: mcpClientName,
          analytics: analyticsCtx,
          toolCallCount: 0,
          sessionStartTime,
          lastActivityAt: Date.now(),
          initCallCount: 1, // This is the first (original) init
        };

        // Set ref for tool call tracking callback
        sessionRef = sessions[newSessionId];

        // Track session start (wrapped to never break MCP)
        if (analyticsCtx) {
          try {
            analytics.trackSessionStart(analyticsCtx, {
              hasToken: true,
              authMethod: isApiKey ? "api_key" : "oauth",
            });
          } catch (e) { console.error("[Analytics] Session start error:", e); }
        }
      },
    });

    transport.onclose = () => {
      const sid = transport.sessionId;
      if (sid && sessions[sid]) {
        const session = sessions[sid];

        // Track session end (wrapped to never break MCP)
        if (session.analytics && session.sessionStartTime) {
          try {
            const duration = Math.floor((Date.now() - session.sessionStartTime) / 1000);
            analytics.trackSessionEnd(session.analytics, {
              duration,
              toolCallCount: session.toolCallCount || 0,
            });
          } catch (e) { console.error("[Analytics] Session end tracking error:", e); }
        }
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
  delete req.headers.authorization;
  delete req.headers["x-nestr-api-key"];
  delete req.headers.cookie;

  if (!sessionId || !sessions[sessionId]) {
    res.status(404).json({
      jsonrpc: "2.0",
      error: {
        code: -32001,
        message: "Session not found",
      },
      id: null,
    });
    return;
  }

  console.log(`SSE stream requested for session: ${sessionId}`);
  const session = sessions[sessionId];

  // Track the SSE response for liveness detection (used by session coalescing)
  session.sseResponse = res;
  res.on("close", () => {
    if (session.sseResponse === res) {
      session.sseResponse = undefined;
    }
  });

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
  delete req.headers.authorization;
  delete req.headers["x-nestr-api-key"];
  delete req.headers.cookie;

  if (!sessionId || !sessions[sessionId]) {
    res.status(404).json({
      jsonrpc: "2.0",
      error: {
        code: -32001,
        message: "Session not found",
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

// Start server (async to initialize store before listening)
(async () => {
  // Initialize OAuth store (Redis if REDIS_URL is set, otherwise file-based)
  await initStore();

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
})().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});

// Graceful shutdown (handles both SIGINT for local dev and SIGTERM from Kubernetes)
async function shutdown(signal: string) {
  if (shuttingDown) return; // Prevent double shutdown
  shuttingDown = true;
  console.log(`\nReceived ${signal}, draining sessions...`);

  // Grace period: let in-flight requests complete and give the load balancer
  // time to stop routing new traffic (k8s endpoint removal).
  // Use a longer preStop sleep (e.g., 5s) in k8s to complement this.
  const DRAIN_TIMEOUT_MS = 5000;
  await new Promise(resolve => setTimeout(resolve, DRAIN_TIMEOUT_MS));

  const sessionIds = Object.keys(sessions);
  console.log(`Closing ${sessionIds.length} active session(s)...`);

  for (const sessionId of sessionIds) {
    try {
      await sessions[sessionId].transport.close();
      await sessions[sessionId].server.close();
      delete sessions[sessionId];
    } catch (error) {
      console.error(`Error closing session ${sessionId}:`, error);
    }
  }

  try {
    await getStore().close();
  } catch { /* ignore close errors during shutdown */ }

  console.log("Server shutdown complete");
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
