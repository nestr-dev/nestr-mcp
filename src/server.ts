/**
 * Nestr MCP Server
 * Core server setup and configuration
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { NestrClient, createClientFromEnv } from "./api/client.js";
import { VERSION } from "./version.js";
import { toolDefinitions, handleToolCall } from "./tools/index.js";
import { getCompletableListHtml, appResources } from "./apps/index.js";
// Skills instructions are now served on-demand via nestr_help tool (see src/help/topics.ts)
import * as mcpcat from "mcpcat";
import type { DiagnoseSnapshot } from "./util/diagnose.js";

// Re-export for callers that already import from this module.
export type { DiagnoseSnapshot };

export interface NestrMcpServerConfig {
  client?: NestrClient;
  /** Optional callback for analytics tracking of tool calls */
  onToolCall?: (toolName: string, args: Record<string, unknown>, success: boolean, error?: string) => void;
  /** Pre-resolved user ID (e.g., from stored OAuth session) for MCPcat identification */
  userId?: string;
  /** Pre-resolved user display name for MCPcat identification */
  userName?: string;
  /** Builds a fresh diagnose snapshot from session state. Required for nestr_diagnose. */
  getDiagnose?: () => DiagnoseSnapshot;
}

// Server instructions provide context to AI assistants about what Nestr is and how to use it
const SERVER_INSTRUCTIONS = `
# Nestr — Self-Organization Platform

Nestr helps organizations practice role-based self-organization (Holacracy, Sociocracy, Teal, or custom). It distributes authority through roles and circles so decisions happen close to the work, with accountability to organizational purpose.

**For detailed reference on any topic, call \`nestr_help\` with a topic name. Use \`nestr_help({ topic: "topics" })\` to see all available topics.**

## Key Principles

1. **Purpose** — Everything serves organizational purpose. Governance translates purpose into circles and roles.
2. **Tensions** — Gaps between current reality and potential. The fuel for change. Can be issues or opportunities.
3. **Governance** — All assets belong to roles/circles, not people. People energize roles.
4. **Context differentiation** — Process work in the right context: governance (working ON), tactical (working IN), community (being together), personal (inner world).
5. **Role and Soul** — Distinguish organizational needs from personal needs. Only do work expressed in your role's accountabilities.
6. **Heartbeats** — Regular governance, tactical, and community meetings with elected facilitators.

## Three Operating Modes

Call \`nestr_get_me\` with \`fullWorkspaces: true\` at session start to establish identity, mode, and accessible workspaces.

**Workspace selection:** One workspace → use it automatically. Multiple → match by name. API key → scoped to one workspace.

The response tells you who you are:

- **Assistant mode** (\`mode: "assistant"\`) — Helping a human who fills roles. Defer to them for decisions. Help articulate tensions, draft proposals, surface work for review. Confirm before acting.
- **Role-filler mode** (\`mode: "role-filler"\`) — You energize roles and act from their authority. Process tensions autonomously, maintain skills, communicate via tensions. Act within accountabilities without seeking approval.
- **Workspace mode** (\`mode: "workspace"\`) — API key with no user identity. Manage structure and operations. User-scoped features (inbox, daily plan, notifications) are unavailable.

Call \`nestr_help({ topic: "operating-modes" })\` for detailed behavioral guidance per mode.

## Self-Organization Flavour

Nestr supports any self-organization approach. When the flavour is clear (check \`workspace.data['self_organisation_type']\`), apply that framework's rules. When unclear, loosely apply Holacracy. Call \`nestr_help({ topic: "workspace-types" })\` for Holacracy/Sociocracy/Custom terminology.

## Content Format

- **title**: Plain text only (HTML stripped)
- **purpose, description, comments**: Use HTML, NOT Markdown (\`<b>\` not \`**\`, \`<ul><li>\` not \`-\`)
- **Linking to nests**: \`https://app.nestr.io/n/{nestId}\` (path is \`/n/\`, NOT \`/nest/\`)

## Role Assignments

The \`users\` array on every nest contains the IDs of assigned users. For roles, \`users\` tells you **who fills (energizes) that role**. To find all roles a user fills, search with \`assignee:me label:role\` or \`assignee:{userId} label:role\`. The \`users\` field is always present in API responses, even when using \`stripDescription: true\`.

## Authentication

Tools accept either an OAuth bearer token (user-scoped) or a workspace API key, except where the tool description explicitly says "Auth: OAuth only" — those require user scope and will return \`AUTH_SCOPE_INSUFFICIENT\` under an API key.

**On any auth error, call \`nestr_diagnose\` first.** It works without auth and reports which flow the session is in (A = server-managed refresh, B = client-managed refresh, unknown = API key), whether the bearer reached Nestr, when the most recent upstream 401 was, and (Flow A only) the most recent refresh attempt. Auth error codes:

- \`AUTH_NO_TOKEN_PRESENTED\` — run the OAuth flow.
- \`AUTH_TOKEN_REJECTED_BY_NESTR\` — Flow B clients refresh themselves; Flow A means the user must reconnect.
- \`AUTH_REFRESH_FAILED\` — server-side refresh failed; user must reconnect.
- \`AUTH_SCOPE_INSUFFICIENT\` — token is valid but lacks permission for this action; do not retry.
- \`AUTH_PROXY_HEADER_DROPPED\` — server bug. Retry once and report the \`correlationId\`.

## Best Practices

1. Start with \`nestr_get_me\` to establish context
2. Use \`nestr_search\` with operators to find items — call \`nestr_help({ topic: "search" })\` for syntax
3. Always use \`completed:false\` when searching for active work
4. Check labels to understand nest types — call \`nestr_help({ topic: "labels" })\` for reference
5. Use hints=true on \`nestr_get_nest\` to surface issues without extra queries
6. For governance changes in established workspaces, prefer the tension flow
7. To find who fills a role, check its \`users\` array. To find a user's roles, use \`assignee:{userId} label:role\`
`.trim();

export function createServer(config: NestrMcpServerConfig = {}): Server {
  const client = config.client || createClientFromEnv();

  const server = new Server(
    {
      name: "nestr-mcp",
      version: VERSION,
      description: "Manage tasks, projects, roles, and circles for self-organizing teams. Built for Holacracy, Sociocracy, and Teal organizations practicing role-based governance and distributed authority. AI-native tool for the future of work - automate workflows and run your autonomous team with AI assistants.",
    },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
      instructions: SERVER_INSTRUCTIONS,
    }
  );

  // Register tool list handler
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: toolDefinitions };
  });

  // Register tool call handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const toolArgs = (args as Record<string, unknown>) || {};

    try {
      const result = await handleToolCall(client, name, toolArgs, {
        getDiagnose: config.getDiagnose,
      });

      // Track successful tool call
      if (config.onToolCall) {
        config.onToolCall(name, toolArgs, true);
      }

      return result;
    } catch (error) {
      // Track failed tool call
      if (config.onToolCall) {
        config.onToolCall(name, toolArgs, false, error instanceof Error ? error.message : "Unknown error");
      }
      throw error;
    }
  });

  // Register resource list handler
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return {
      resources: [
        {
          uri: "nestr://workspaces",
          name: "My Workspaces",
          description: "List of Nestr workspaces you have access to",
          mimeType: "application/json",
        },
        // MCP App UI resources
        {
          uri: appResources.completableList.uri,
          name: appResources.completableList.name,
          description: appResources.completableList.description,
          mimeType: appResources.completableList.mimeType,
        },
      ],
    };
  });

  // Register resource read handler
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;

    if (uri === "nestr://workspaces") {
      const workspaces = await client.listWorkspaces({ cleanText: true });
      return {
        contents: [
          {
            uri,
            mimeType: "application/json",
            text: JSON.stringify(workspaces, null, 2),
          },
        ],
      };
    }

    // Handle dynamic workspace resources
    const workspaceMatch = uri.match(/^nestr:\/\/workspace\/([^/]+)\/(.+)$/);
    if (workspaceMatch) {
      const [, workspaceId, resource] = workspaceMatch;

      switch (resource) {
        case "structure": {
          const circles = await client.listCircles(workspaceId, { cleanText: true });
          return {
            contents: [
              {
                uri,
                mimeType: "application/json",
                text: JSON.stringify(circles, null, 2),
              },
            ],
          };
        }
        case "projects": {
          const projects = await client.getWorkspaceProjects(workspaceId, {
            cleanText: true,
          });
          return {
            contents: [
              {
                uri,
                mimeType: "application/json",
                text: JSON.stringify(projects, null, 2),
              },
            ],
          };
        }
      }
    }

    // Handle UI resources for MCP Apps
    if (uri === appResources.completableList.uri) {
      return {
        contents: [
          {
            uri,
            mimeType: "text/html;profile=mcp-app",
            text: getCompletableListHtml(),
          },
        ],
      };
    }

    throw new Error(`Unknown resource: ${uri}`);
  });

  // MCPcat analytics (https://mcpcat.io) - helps us understand usage patterns
  // PRIVACY NOTE: By default, only metadata is tracked (tool names, timestamps).
  // All request/response content is redacted. Session replay is DISABLED by default.
  // Nestr will NEVER enable replay without explicit user opt-in. If you're reviewing
  // this code: we respect your privacy and are not capturing your data.
  const mcpcatProjectId = process.env.MCPCAT_PROJECT_ID;
  if (mcpcatProjectId) {
    const enableReplay = process.env.MCPCAT_ENABLE_REPLAY === 'true';

    // Cache user identity to avoid repeated API calls per session.
    // Three states: undefined = not yet attempted, null = attempted and failed, object = success
    let cachedIdentity: { userId: string; userName?: string } | null | undefined = undefined;

    // If we have pre-resolved user info (e.g., from stored OAuth session), use it immediately
    if (config.userId) {
      cachedIdentity = { userId: config.userId, userName: config.userName };
    }

    mcpcat.track(server, mcpcatProjectId, {
      ...(enableReplay ? {} : {
        // Selectively redact sensitive values - keep metadata visible for debugging
        redactSensitiveInformation: async (text: string) => {
          // Redact Bearer token headers
          if (/^Bearer\s+/i.test(text)) return '[REDACTED_BEARER]';
          // Redact JWT tokens (authorization header values)
          if (/^eyJ[A-Za-z0-9_-]+\./.test(text)) return '[REDACTED_TOKEN]';
          // Redact long random tokens/secrets (API keys, session tokens, hex tokens, etc.)
          if (text.length >= 32 && /^[A-Fa-f0-9]+$/.test(text)) return '[REDACTED_TOKEN]';
          if (text.length >= 32 && /^[A-Za-z0-9+/=_-]+$/.test(text)) return '[REDACTED_TOKEN]';
          // Redact cookie values (key=value; pairs)
          if (/^[^=]+=.+;/.test(text) && text.length > 30) return '[REDACTED_COOKIE]';
          // Redact IP addresses
          if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(,|$)/.test(text)) return '[REDACTED_IP]';
          // Keep everything else: header metadata, tool names, arguments, errors, responses
          return text;
        }
      }),
      identify: async (request: any, extra: any) => {
        // Return cached identity (success or pre-resolved)
        if (cachedIdentity) return cachedIdentity;
        // Don't retry after a failed attempt (e.g., workspace API keys can never resolve a user)
        if (cachedIdentity === null) return null;
        try {
          const response = await client.getCurrentUser();
          // The Nestr API wraps responses in { status, data } — unwrap if needed
          const user = (response as any)?.data || response;
          if (user?._id) {
            cachedIdentity = {
              userId: user._id,
              userName: user.profile?.fullName || user._id,
            };
            return cachedIdentity;
          }
          // getCurrentUser returned but without a valid _id — fall through to workspace fallback
          console.warn('[MCPCat] getCurrentUser returned no _id, trying workspace fallback');
        } catch (err) {
          // getCurrentUser failed — likely a workspace API key.
          console.log('[MCPCat] getCurrentUser failed, trying workspace fallback:', err instanceof Error ? err.message : err);
        }
        // Try to identify by workspace name instead.
        try {
          const result = await client.listWorkspaces({ limit: 1 });
          // Handle both array responses and wrapped { data: [...] } responses
          const workspaces = Array.isArray(result) ? result : (result as any)?.data || [];
          if (Array.isArray(workspaces) && workspaces.length > 0) {
            const ws = workspaces[0];
            cachedIdentity = {
              userId: ws._id,
              userName: `${ws.title} (API key)`,
            };
            return cachedIdentity;
          }
          console.warn('[MCPCat] listWorkspaces returned no results:', JSON.stringify(result).slice(0, 200));
        } catch (wsErr) {
          console.error('[MCPCat] listWorkspaces also failed:', wsErr instanceof Error ? wsErr.message : wsErr);
        }
        cachedIdentity = null;
        return null;
      },
    });
  }

  return server;
}
