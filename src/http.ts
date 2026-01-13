#!/usr/bin/env node
/**
 * Nestr MCP Server - HTTP entry point
 *
 * For hosted deployment at mcp.nestr.io
 *
 * Serves:
 *   GET  /        - Landing page with documentation
 *   POST /mcp     - MCP protocol endpoint (Streamable HTTP)
 *   GET  /mcp     - SSE stream for server-initiated messages
 *   DELETE /mcp   - Session termination
 *   GET  /health  - Health check endpoint
 */

import express, { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { createServer } from "./server.js";
import { NestrClient } from "./api/client.js";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;

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

// Store transports and servers by session ID
interface SessionData {
  transport: StreamableHTTPServerTransport;
  server: Server;
  apiKey: string;
}
const sessions: Record<string, SessionData> = {};

/**
 * Validate API key from request headers
 */
function getApiKey(req: Request): string | null {
  return (req.headers["x-nestr-api-key"] as string) || null;
}

/**
 * MCP POST endpoint - handles JSON-RPC requests
 */
app.post("/mcp", async (req: Request, res: Response) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  const apiKey = getApiKey(req);

  try {
    // Check for existing session
    if (sessionId && sessions[sessionId]) {
      const session = sessions[sessionId];
      await session.transport.handleRequest(req, res, req.body);
      return;
    }

    // New session - requires API key and must be initialization request
    if (!apiKey) {
      res.status(401).json({
        jsonrpc: "2.0",
        error: {
          code: -32001,
          message: "Missing X-Nestr-API-Key header",
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

    // Create new session
    const client = new NestrClient({ apiKey });
    const server = createServer({ client });

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (newSessionId) => {
        console.log(`Session initialized: ${newSessionId}`);
        sessions[newSessionId] = { transport, server, apiKey };
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
  console.log(`Health check: http://localhost:${PORT}/health`);
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
