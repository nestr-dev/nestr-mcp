#!/usr/bin/env node
/**
 * Nestr MCP Server - stdio entry point
 *
 * Run with: npx @nestr/mcp
 *
 * Required environment variables:
 *   NESTR_API_KEY - Your Nestr API key (get from workspace settings)
 *
 * Optional environment variables:
 *   NESTR_API_BASE - API base URL (default: https://app.nestr.io/api)
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

async function main() {
  // Validate API key is present
  if (!process.env.NESTR_API_KEY) {
    console.error("Error: NESTR_API_KEY environment variable is required.");
    console.error("");
    console.error("To get your API key:");
    console.error("1. Go to your Nestr workspace");
    console.error("2. Click Settings (gear icon)");
    console.error("3. Go to Integrations tab");
    console.error("4. Find 'Workspace API access' and click Configure");
    console.error("5. Create a new API key");
    console.error("");
    console.error("Then set the environment variable:");
    console.error("  export NESTR_API_KEY=your-api-key");
    console.error("");
    console.error("Or configure in your MCP client (e.g., Claude Desktop):");
    console.error(JSON.stringify({
      mcpServers: {
        nestr: {
          command: "npx",
          args: ["-y", "@nestr/mcp"],
          env: {
            NESTR_API_KEY: "your-api-key"
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
