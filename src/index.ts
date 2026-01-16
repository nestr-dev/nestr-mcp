#!/usr/bin/env node
/**
 * Nestr MCP Server - stdio entry point
 *
 * Run with: npx @nestr/mcp
 *
 * Authentication (one of the following):
 *   NESTR_API_KEY    - Your Nestr API key (get from workspace settings)
 *   NESTR_OAUTH_TOKEN - OAuth Bearer token from Nestr OAuth flow
 *
 * Optional environment variables:
 *   NESTR_API_BASE - API base URL (default: https://app.nestr.io/api)
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

async function main() {
  // Validate authentication is present
  if (!process.env.NESTR_API_KEY && !process.env.NESTR_OAUTH_TOKEN) {
    console.error("Error: Authentication required.");
    console.error("");
    console.error("Option 1: OAuth Token (Recommended)");
    console.error("  OAuth respects your user-specific permissions in Nestr.");
    console.error("  Use an OAuth Bearer token from the Nestr OAuth flow.");
    console.error("");
    console.error("  Then set: export NESTR_OAUTH_TOKEN=your-oauth-token");
    console.error("");
    console.error("Option 2: API Key");
    console.error("  API keys have full workspace access (ignores user permissions).");
    console.error("  1. Go to your Nestr workspace");
    console.error("  2. Click Settings (gear icon)");
    console.error("  3. Go to Integrations tab");
    console.error("  4. Find 'Workspace API access' and click Configure");
    console.error("  5. Create a new API key");
    console.error("");
    console.error("  Then set: export NESTR_API_KEY=your-api-key");
    console.error("");
    console.error("Or configure in your MCP client (e.g., Claude Desktop):");
    console.error(JSON.stringify({
      mcpServers: {
        nestr: {
          command: "npx",
          args: ["-y", "@nestr/mcp"],
          env: {
            NESTR_OAUTH_TOKEN: "your-oauth-token"
          }
        }
      }
    }, null, 2));
    process.exit(1);
  }

  const server = createServer();
  const transport = new StdioServerTransport();

  await server.connect(transport);

  // Log to stderr so it doesn't interfere with MCP protocol on stdout
  console.error("Nestr MCP server running on stdio");
  console.error("Connected to:", process.env.NESTR_API_BASE || "https://app.nestr.io/api");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
