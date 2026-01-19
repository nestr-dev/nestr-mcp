/**
 * OAuth Configuration for Nestr MCP Server
 *
 * Implements MCP Authorization Specification using Nestr as the authorization server.
 * See: https://modelcontextprotocol.io/specification/draft/basic/authorization
 */

export interface OAuthConfig {
  // Nestr OAuth endpoints
  authorizationEndpoint: string;
  tokenEndpoint: string;

  // MCP server resource identifier
  resourceIdentifier: string;

  // OAuth client credentials (optional - for registered clients)
  clientId?: string;
  clientSecret?: string;

  // Supported scopes
  scopes: string[];
}

/**
 * Get OAuth configuration from environment
 *
 * For local development, set:
 *   NESTR_API_BASE=http://localhost:4001/api
 *   NESTR_OAUTH_CLIENT_ID=your-local-client-id
 */
export function getOAuthConfig(): OAuthConfig {
  const baseUrl = process.env.NESTR_API_BASE || "https://app.nestr.io/api";
  const nestrBase = baseUrl.replace(/\/api$/, "");

  // MCP resource identifier - the canonical URL of this MCP server
  const resourceIdentifier = process.env.MCP_RESOURCE_URL || "https://mcp.nestr.io/mcp";

  return {
    // /dialog/oauth is the UI page, /oauth/authorize is the backend endpoint
    authorizationEndpoint: `${nestrBase}/dialog/oauth`,
    tokenEndpoint: `${nestrBase}/oauth/token`,
    resourceIdentifier,
    clientId: process.env.NESTR_OAUTH_CLIENT_ID,
    clientSecret: process.env.NESTR_OAUTH_CLIENT_SECRET,
    scopes: ["user", "nest"],
  };
}

/**
 * OAuth Protected Resource Metadata (RFC 9728)
 *
 * This is returned at /.well-known/oauth-protected-resource
 * to inform MCP clients how to authenticate.
 */
export interface ProtectedResourceMetadata {
  resource: string;
  authorization_servers: string[];
  bearer_methods_supported?: string[];
  scopes_supported?: string[];
  resource_documentation?: string;
}

/**
 * Generate Protected Resource Metadata for this MCP server
 *
 * Note: We return a placeholder for authorization_servers. The actual
 * MCP server URL is filled in dynamically by the HTTP handler based
 * on the request's host header.
 */
export function getProtectedResourceMetadata(mcpServerBaseUrl?: string): ProtectedResourceMetadata {
  const config = getOAuthConfig();

  // If we have the MCP server's base URL, use it as the authorization server
  // (we proxy OAuth requests to Nestr). Otherwise, fall back to Nestr directly.
  const authServer = mcpServerBaseUrl || config.authorizationEndpoint.replace(/\/dialog\/oauth$/, "");

  return {
    resource: config.resourceIdentifier,
    authorization_servers: [authServer],
    bearer_methods_supported: ["header"],
    scopes_supported: config.scopes,
    resource_documentation: "https://mcp.nestr.io",
  };
}

/**
 * Authorization Server Metadata (RFC 8414)
 *
 * Describes our OAuth server capabilities.
 * We act as an authorization server, proxying to Nestr.
 */
export interface AuthorizationServerMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  response_types_supported: string[];
  grant_types_supported: string[];
  code_challenge_methods_supported: string[];
  scopes_supported: string[];
}

/**
 * Get authorization server metadata
 *
 * When mcpServerBaseUrl is provided, returns metadata for our MCP server
 * acting as an authorization server (proxying to Nestr).
 *
 * PKCE Support: We advertise S256 support because we handle PKCE verification
 * in our proxy layer, even though Nestr doesn't support PKCE natively.
 */
export function getAuthorizationServerMetadata(mcpServerBaseUrl?: string): AuthorizationServerMetadata {
  const config = getOAuthConfig();

  if (mcpServerBaseUrl) {
    // Our MCP server acts as the authorization server
    return {
      issuer: mcpServerBaseUrl,
      authorization_endpoint: `${mcpServerBaseUrl}/oauth/authorize`,
      token_endpoint: `${mcpServerBaseUrl}/oauth/token`,
      registration_endpoint: `${mcpServerBaseUrl}/oauth/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"], // We handle PKCE in our proxy
      scopes_supported: config.scopes,
    };
  }

  // Fall back to Nestr directly (no PKCE, no registration)
  const nestrBase = config.authorizationEndpoint.replace(/\/dialog\/oauth$/, "");
  return {
    issuer: nestrBase,
    authorization_endpoint: config.authorizationEndpoint,
    token_endpoint: config.tokenEndpoint,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: [],
    scopes_supported: config.scopes,
  };
}
