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

import express, { Request, Response, NextFunction } from "express";
import { randomUUID, randomBytes } from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { createServer } from "./server.js";
import { toolDefinitions } from "./tools/index.js";
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
import { VERSION } from "./version.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;
const GTM_ID = process.env.GTM_ID || process.env.NESTR_GTM_ID;

const GTM_ID_REGEX = /^GTM-[A-Z0-9]+$/;

export function isValidGtmId(id: string | undefined): id is string {
  return !!id && GTM_ID_REGEX.test(id);
}

export function escapeHtml(text: string): string {
  const htmlEscapes: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };
  return text.replace(/[&<>"']/g, (char) => htmlEscapes[char]);
}

export const app = express();

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

// CORS for browser-based MCP clients (e.g., claude.ai)
// Placed before express.json() so OPTIONS preflight requests skip body parsing
app.use((req: Request, res: Response, next: NextFunction) => {
  const origin = req.headers.origin;
  const allowedOrigins = [
    "https://claude.ai",
    "https://claude.com",
  ];
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Nestr-API-Key, Mcp-Session-Id");
    res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  next();
});

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
  res.json({ status: "ok", service: "nestr-mcp", version: VERSION });
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

// OpenAI Apps domain verification challenge
// Token is set via OPENAI_CHALLENGE_TOKEN env var during app submission
app.get("/.well-known/openai-apps-challenge", (_req, res) => {
  const token = process.env.OPENAI_CHALLENGE_TOKEN;
  if (!token) {
    res.status(404).json({ error: "Challenge token not configured" });
    return;
  }
  res.type("text/plain").send(token);
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
export interface SessionData {
  transport: StreamableHTTPServerTransport;
  server: Server;
  authToken: string; // API key or OAuth token
  mcpClient?: string; // MCP client name (e.g., "claude-desktop")
  isApiKey: boolean; // Whether the auth came in via X-Nestr-API-Key
  wantsJsonOnly: boolean; // Whether the client preferred JSON over SSE at init
  hasStoredOAuthSession: boolean; // Whether the server holds a refreshable OAuth session for this token
  userId?: string; // Resolved user ID (or workspace ID for API keys)
  userName?: string; // Resolved display name
  analytics?: AnalyticsContext; // GA4 analytics context
  toolCallCount?: number; // Count of tool calls for session end tracking
  sessionStartTime?: number; // Session start time for duration tracking
  lastActivityAt: number; // Timestamp of last request (for session coalescing)
  initCallCount: number; // Number of initialize requests coalesced into this session
  sseResponse?: Response; // Active SSE stream response (for liveness check)
  lastPersistedAt?: number; // Last time we refreshed the Redis TTL (debounced)
}
export const sessions: Record<string, SessionData> = {};
let shuttingDown = false;
let inFlightRequests = 0;

/**
 * Session coalescing for poorly-behaved clients that create a new MCP connection per tool call.
 * If an initialize request arrives with the same auth token + client name as a recent session
 * (within 10 minutes, fewer than 5 original init requests), reuse the existing session.
 * The initCallCount limit prevents unbounded coalescing — after 5 inits it's either a
 * legitimately new session or a client that needs fixing.
 */
export const SESSION_COALESCE_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
export const SESSION_COALESCE_MAX_INITS = 5;
const SESSION_STALE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes without activity
// Debounce for touchMcpSession. We refresh the Redis TTL at most this often
// so a chatty client doesn't hammer the store.
const MCP_SESSION_TOUCH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// Periodically clean up dead sessions (closed SSE + stale).
// We only drop the in-memory entry — the persistent Redis record lives on until
// its own TTL so a late-returning client can still rehydrate.
// .unref() so this timer doesn't prevent process exit (tests, graceful shutdown)
setInterval(() => {
  const now = Date.now();
  for (const [sid, session] of Object.entries(sessions)) {
    const sseAlive = session.sseResponse && !session.sseResponse.writableEnded;
    const stale = (now - session.lastActivityAt) > SESSION_STALE_TIMEOUT_MS;
    if (!sseAlive && stale) {
      delete sessions[sid];
    }
  }
}, 60000).unref();

/**
 * Refresh the Redis TTL of a persisted MCP session, debounced per-session so
 * an active client doesn't hammer the store.
 */
async function maybeTouchMcpSession(sessionId: string, session: SessionData): Promise<void> {
  const now = Date.now();
  const last = session.lastPersistedAt ?? 0;
  if (now - last < MCP_SESSION_TOUCH_INTERVAL_MS) return;
  session.lastPersistedAt = now;
  try {
    await getStore().touchMcpSession(sessionId);
  } catch (e) {
    console.error("[McpSession] touch failed:", e instanceof Error ? e.message : e);
  }
}

export function findCoalescableSession(authToken: string, mcpClient: string | undefined): { sessionId: string; session: SessionData } | undefined {
  const now = Date.now();
  let bestMatch: { sessionId: string; session: SessionData; lastActivity: number; sseAlive: boolean } | undefined;

  for (const [sid, session] of Object.entries(sessions)) {
    if (
      session.authToken === authToken &&
      session.mcpClient === mcpClient &&
      session.initCallCount < SESSION_COALESCE_MAX_INITS &&
      (now - session.lastActivityAt) < SESSION_COALESCE_WINDOW_MS
    ) {
      const sseAlive = !!(session.sseResponse && !session.sseResponse.writableEnded);

      // Pick the best session: prefer live SSE, then most recently active
      if (
        !bestMatch ||
        (sseAlive && !bestMatch.sseAlive) || // prefer live SSE over dead
        (sseAlive === bestMatch.sseAlive && session.lastActivityAt > bestMatch.lastActivity)
      ) {
        bestMatch = { sessionId: sid, session, lastActivity: session.lastActivityAt, sseAlive };
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
 * Build an in-memory MCP session: NestrClient + MCP server + transport, all
 * registered in the local sessions map. Used for both fresh sessions (init
 * request from the client) and rehydrated sessions (sessionId we no longer
 * hold in memory but exists in Redis from a previous pod).
 *
 * For rehydrated sessions, the transport is pre-marked as already initialized
 * so the SDK skips the init handshake — the client never knows the server
 * restarted.
 */
function buildMcpSession(opts: {
  authToken: string;
  isApiKey: boolean;
  mcpClient?: string;
  userId?: string;
  userName?: string;
  wantsJsonOnly: boolean;
  hasStoredOAuthSession: boolean;
  analyticsCtx?: AnalyticsContext;
  /** When set, skips the init handshake and registers the session immediately under this id. */
  rehydrateFor?: string;
}): SessionData {
  const sessionStartTime = Date.now();
  let sessionRef: SessionData | undefined;

  const client = new NestrClient({
    apiKey: opts.authToken,
    baseUrl: process.env.NESTR_API_BASE,
    mcpClient: opts.mcpClient,
    // tokenProvider enables server-side token refresh for stored sessions (browser flow).
    // In the standard MCP OAuth flow there's no stored session — the client manages refresh.
    // When tokenProvider is undefined, NestrClient lets 401 propagate to the client.
    tokenProvider: opts.hasStoredOAuthSession ? async () => {
      const session = await getOAuthSession(opts.authToken);
      if (!session) {
        // Stored session expired and refresh failed — surface a 401 to the
        // client without ripping the MCP session out from under the protocol.
        // The HTTP-level pre-check in the POST handler will normally catch
        // this first; this is the in-flight fallback.
        const sid = sessionRef?.transport?.sessionId;
        console.log(`OAuth session expired mid-session (MCP session: ${sid ?? "unknown"}). Returning 401 to client.`);
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
    userId: opts.userId,
    userName: opts.userName,
    onToolCall: (toolName, args, success, error) => {
      try {
        if (sessionRef?.analytics) {
          if (sessionRef.toolCallCount !== undefined) {
            sessionRef.toolCallCount++;
          }
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

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => opts.rehydrateFor ?? randomUUID(),
    enableJsonResponse: opts.wantsJsonOnly,
    onsessioninitialized: (newSessionId) => {
      // Only fires for fresh sessions — rehydrated transports skip the handshake.
      console.log(`Session initialized: ${newSessionId}${opts.mcpClient ? ` (client: ${opts.mcpClient})` : ""}`);
      const sessionData: SessionData = {
        transport,
        server,
        authToken: opts.authToken,
        mcpClient: opts.mcpClient,
        isApiKey: opts.isApiKey,
        wantsJsonOnly: opts.wantsJsonOnly,
        hasStoredOAuthSession: opts.hasStoredOAuthSession,
        userId: opts.userId,
        userName: opts.userName,
        analytics: opts.analyticsCtx,
        toolCallCount: 0,
        sessionStartTime,
        lastActivityAt: Date.now(),
        initCallCount: 1,
        lastPersistedAt: Date.now(),
      };
      sessions[newSessionId] = sessionData;
      sessionRef = sessionData;

      // Persist for rehydration after restart
      getStore().storeMcpSession(newSessionId, {
        authToken: opts.authToken,
        mcpClient: opts.mcpClient,
        userId: opts.userId,
        userName: opts.userName,
        isApiKey: opts.isApiKey,
        wantsJsonOnly: opts.wantsJsonOnly,
        hasStoredOAuthSession: opts.hasStoredOAuthSession,
        createdAt: Date.now(),
      }).catch(e => console.error("[McpSession] Failed to persist session:", e instanceof Error ? e.message : e));

      if (opts.analyticsCtx) {
        try {
          analytics.trackSessionStart(opts.analyticsCtx, {
            hasToken: true,
            authMethod: opts.isApiKey ? "api_key" : "oauth",
          });
        } catch (e) { console.error("[Analytics] Session start error:", e); }
      }
    },
  });

  transport.onclose = () => {
    const sid = transport.sessionId;
    if (sid && sessions[sid]) {
      const session = sessions[sid];
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
    // Drop persisted record on explicit close (DELETE /mcp). Pod-shutdown does
    // NOT call transport.close() so persisted records survive deploys.
    if (sid) {
      getStore().removeMcpSession(sid).catch(e =>
        console.error("[McpSession] Failed to remove persisted session:", e instanceof Error ? e.message : e)
      );
    }
  };

  // For rehydration we mark the transport as already initialized and register
  // the SessionData immediately. The SDK exposes no public API for this, so
  // we touch private fields — the alternative is forcing every client to
  // re-init on every deploy, which is the bug we're fixing.
  if (opts.rehydrateFor) {
    const inner = (transport as unknown as { _webStandardTransport: { _initialized: boolean; sessionId?: string } })._webStandardTransport;
    inner._initialized = true;
    inner.sessionId = opts.rehydrateFor;

    const sessionData: SessionData = {
      transport,
      server,
      authToken: opts.authToken,
      mcpClient: opts.mcpClient,
      isApiKey: opts.isApiKey,
      wantsJsonOnly: opts.wantsJsonOnly,
      hasStoredOAuthSession: opts.hasStoredOAuthSession,
      userId: opts.userId,
      userName: opts.userName,
      analytics: opts.analyticsCtx,
      toolCallCount: 0,
      sessionStartTime,
      lastActivityAt: Date.now(),
      initCallCount: 0,
      lastPersistedAt: Date.now(),
    };
    sessions[opts.rehydrateFor] = sessionData;
    sessionRef = sessionData;
    console.log(`[Rehydrate] Rebuilt session ${opts.rehydrateFor} (client: ${opts.mcpClient ?? "unknown"})`);
    return sessionData;
  }

  // Fresh session: caller still needs to attach via server.connect(transport)
  // and call transport.handleRequest() to drive the init handshake.
  return {
    transport,
    server,
    authToken: opts.authToken,
    mcpClient: opts.mcpClient,
    isApiKey: opts.isApiKey,
    wantsJsonOnly: opts.wantsJsonOnly,
    hasStoredOAuthSession: opts.hasStoredOAuthSession,
    userId: opts.userId,
    userName: opts.userName,
    analytics: opts.analyticsCtx,
    lastActivityAt: Date.now(),
    initCallCount: 0,
  } as SessionData;
}

/**
 * Look up a sessionId in the persistent store and rebuild the in-memory
 * session if found. Cross-checks the auth token to refuse rehydration when
 * the request token doesn't match the stored one (defense in depth).
 *
 * Returns the rebuilt SessionData (already in `sessions` map) or undefined.
 */
async function rehydrateSession(sessionId: string, authToken: string): Promise<SessionData | undefined> {
  let stored;
  try {
    stored = await getStore().getMcpSession(sessionId);
  } catch (e) {
    console.error("[Rehydrate] Failed to read MCP session from store:", e instanceof Error ? e.message : e);
    return undefined;
  }
  if (!stored) return undefined;

  // Cross-check token: rotated tokens or hijacking attempts → refuse, force re-init.
  if (stored.authToken !== authToken) {
    console.warn(`[Rehydrate] Session ${sessionId} found but token mismatch — refusing rehydration`);
    return undefined;
  }

  let analyticsCtx: AnalyticsContext | undefined;
  try {
    analyticsCtx = analytics.isEnabled() ? {
      clientId: analytics.generateClientId(),
      userId: stored.userId,
      mcpClient: stored.mcpClient,
      transport: "http",
    } : undefined;
  } catch (e) { console.error("[Analytics] Context creation error:", e); }

  const session = buildMcpSession({
    authToken: stored.authToken,
    isApiKey: stored.isApiKey,
    mcpClient: stored.mcpClient,
    userId: stored.userId,
    userName: stored.userName,
    wantsJsonOnly: stored.wantsJsonOnly,
    hasStoredOAuthSession: stored.hasStoredOAuthSession,
    analyticsCtx,
    rehydrateFor: sessionId,
  });

  // Wire the protocol layer to the transport. server.connect() doesn't touch
  // _initialized so our hack stays valid.
  await session.server.connect(session.transport);

  // Refresh TTL: this session is being actively used.
  try {
    await getStore().touchMcpSession(sessionId);
  } catch (e) {
    console.error("[McpSession] touch on rehydrate failed:", e instanceof Error ? e.message : e);
  }

  return session;
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
export function getAuthToken(req: Request): string | null {
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

// In-flight request tracking for /mcp so the shutdown handler can wait for
// outstanding tool calls to finish before the pod terminates.
app.use("/mcp", (_req: Request, res: Response, next: NextFunction) => {
  inFlightRequests++;
  let decremented = false;
  const decrement = () => {
    if (decremented) return;
    decremented = true;
    inFlightRequests--;
  };
  res.on("finish", decrement);
  res.on("close", decrement);
  next();
});

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

    // Check for existing session, or rehydrate from persistent store if the
    // pod has restarted since this client last connected.
    if (sessionId) {
      let session: SessionData | undefined = sessions[sessionId];
      if (!session && authToken) {
        session = await rehydrateSession(sessionId, authToken) ?? undefined;
      }
      if (session) {
        // For sessions held over from a previous pod, the OAuth token may have
        // expired. Pre-check before invoking the transport so we can return a
        // proper HTTP 401 + WWW-Authenticate that triggers MCP client re-auth,
        // instead of wrapping the failure as a tool error the client ignores.
        if (session.hasStoredOAuthSession) {
          const oauthSession = await getOAuthSession(session.authToken);
          if (!oauthSession) {
            res.status(401);
            res.setHeader("WWW-Authenticate", buildWwwAuthenticateHeader(req));
            res.json({
              jsonrpc: "2.0",
              error: {
                code: -32001,
                message: "OAuth session expired. Reconnect to re-authenticate.",
              },
              id: req.body?.id ?? null,
            });
            return;
          }
        }

        session.lastActivityAt = Date.now();
        await maybeTouchMcpSession(sessionId, session);
        await session.transport.handleRequest(req, res, req.body);
        return;
      }

      // Session ID was provided but not found anywhere - return 404 per MCP spec.
      // Compliant clients will re-initialize automatically.
      console.log(`Session not found: ${sessionId} (no persisted record either)`);
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

    // Allow unauthenticated tools/list for tool scanners (e.g., OpenAI app submission)
    // Tool definitions are public (published on npm/GitHub), no data is exposed
    if (!authToken && req.body?.method === "tools/list") {
      res.json({
        jsonrpc: "2.0",
        result: { tools: toolDefinitions },
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

    // Check if we have a stored session for this token (browser flow).
    // Standard MCP OAuth clients manage tokens client-side and won't have a stored session.
    const hasStoredSession = !isApiKey && !!(await getStore().getSession(authToken));

    const session = buildMcpSession({
      authToken,
      isApiKey,
      mcpClient: mcpClientName,
      userId,
      userName,
      wantsJsonOnly,
      hasStoredOAuthSession: hasStoredSession,
      analyticsCtx,
    });

    await session.server.connect(session.transport);
    await session.transport.handleRequest(req, res, req.body);
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
  // Capture auth token before stripping headers, so we can rehydrate.
  const authToken = getAuthToken(req);
  delete req.headers.authorization;
  delete req.headers["x-nestr-api-key"];
  delete req.headers.cookie;

  if (!sessionId) {
    res.status(404).json({
      jsonrpc: "2.0",
      error: { code: -32001, message: "Session not found" },
      id: null,
    });
    return;
  }

  let session: SessionData | undefined = sessions[sessionId];
  if (!session && authToken) {
    session = await rehydrateSession(sessionId, authToken) ?? undefined;
  }
  if (!session) {
    res.status(404).json({
      jsonrpc: "2.0",
      error: { code: -32001, message: "Session not found" },
      id: null,
    });
    return;
  }

  console.log(`SSE stream requested for session: ${sessionId}`);

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
  const authToken = getAuthToken(req);
  delete req.headers.authorization;
  delete req.headers["x-nestr-api-key"];
  delete req.headers.cookie;

  if (!sessionId) {
    res.status(404).json({
      jsonrpc: "2.0",
      error: { code: -32001, message: "Session not found" },
      id: null,
    });
    return;
  }

  let session: SessionData | undefined = sessions[sessionId];
  if (!session && authToken) {
    // Rehydrate so we can route the DELETE through the SDK and clean up Redis.
    session = await rehydrateSession(sessionId, authToken) ?? undefined;
  }
  if (!session) {
    // Even if we can't rehydrate, drop any persisted record so a stale entry
    // doesn't outlive the client's intent.
    await getStore().removeMcpSession(sessionId).catch(() => {});
    res.status(404).json({
      jsonrpc: "2.0",
      error: { code: -32001, message: "Session not found" },
      id: null,
    });
    return;
  }

  console.log(`Session termination requested: ${sessionId}`);

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

// Return a proper JSON-RPC error for malformed request bodies instead of Express's default HTML.
app.use((err: Error & { type?: string; status?: number }, _req: Request, res: Response, next: NextFunction) => {
  if (err.type === "entity.parse.failed" && err.status === 400) {
    res.status(400).json({
      jsonrpc: "2.0",
      error: {
        code: -32700,
        message: "Parse error: request body is not valid JSON. Expected a JSON-RPC object like {\"jsonrpc\":\"2.0\",\"method\":\"initialize\",...}",
      },
      id: null,
    });
    return;
  }
  next(err);
});

// Only start the server when this module is executed directly (not imported by tests)
const isDirectRun = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isDirectRun) {
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
}

// Graceful shutdown (handles both SIGINT for local dev and SIGTERM from Kubernetes)
async function shutdown(signal: string) {
  if (shuttingDown) return; // Prevent double shutdown
  shuttingDown = true;
  console.log(`\nReceived ${signal}, draining...`);

  // Wait for in-flight /mcp requests to finish so the client doesn't see a
  // mid-tool-call abort. Capped so a stuck request can't block forever.
  const DRAIN_TIMEOUT_MS = 25000;
  const POLL_MS = 200;
  const start = Date.now();
  while (inFlightRequests > 0 && Date.now() - start < DRAIN_TIMEOUT_MS) {
    if ((Date.now() - start) % 2000 < POLL_MS) {
      console.log(`  ${inFlightRequests} request(s) in flight, waiting...`);
    }
    await new Promise(resolve => setTimeout(resolve, POLL_MS));
  }
  if (inFlightRequests > 0) {
    console.warn(`Drain timeout: ${inFlightRequests} request(s) still in flight, exiting anyway`);
  }

  // IMPORTANT: do NOT call transport.close() here. That fires onclose, which
  // removes the session from Redis — and we want persisted sessions to
  // survive the deploy so clients can rehydrate against the new pod.
  // Just drop the local map; tcp connections terminate when the pod exits.
  const count = Object.keys(sessions).length;
  for (const sid of Object.keys(sessions)) {
    delete sessions[sid];
  }
  if (count > 0) {
    console.log(`Released ${count} in-memory session handle(s) (persisted records preserved for rehydration)`);
  }

  try {
    await getStore().close();
  } catch { /* ignore close errors during shutdown */ }

  console.log("Server shutdown complete");
  process.exit(0);
}

if (isDirectRun) {
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}
