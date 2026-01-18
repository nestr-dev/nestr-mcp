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
import { toolDefinitions, handleToolCall } from "./tools/index.js";

export interface NestrMcpServerConfig {
  client?: NestrClient;
}

// Server instructions provide context to AI assistants about what Nestr is and how to use it
const SERVER_INSTRUCTIONS = `
Nestr is a work management platform for teams practicing self-organization, Holacracy, Sociocracy, and Teal methodologies.

## Workspace Types

Most workspaces are organizational, representing a self-organized team. Check the workspace's labels to determine the type:

- **Organizational Workspace** (most common): Has the "anchor-circle" label. The workspace IS the anchor circle of a self-organized team using Holacracy/Sociocracy/Teal governance. Contains sub-circles, roles with accountabilities and domains, and collaborative projects.
- **Personal Workspace**: No "anchor-circle" label. A personal space where an individual tracks their own work and projects.

## Core Concepts

- **Workspace**: Top-level container - either an organization's anchor circle or a personal workspace
- **Nest**: The universal building block - can be a task, project, role, circle, meeting, or any work item
- **Circle**: A self-governing team with defined purpose, roles, and accountabilities (Holacracy/Sociocracy concept)
- **Role**: A set of responsibilities (accountabilities) and decision rights (domains) that a person energizes
- **Label**: Tags that define what type of nest something is (e.g., "project", "todo", "meeting", "anchor-circle")

## Best Practices

1. **Start by listing workspaces** to get the workspace ID and check if it has the "anchor-circle" label
2. **Use search** to find specific items rather than browsing through hierarchies
3. **Check labels** to understand what type of nest you're working with
4. **Use @mentions** in comments to notify team members
5. **Respect the hierarchy**: nests live under parents (workspace → circle → role/project → task)

## Common Workflows

- **Task Management**: Create nests with "todo" label, update status fields, add comments for updates
- **Project Tracking**: List projects, get children to see tasks, check insights for metrics
- **Team Structure**: List circles to see teams, get roles to understand accountabilities and domains
- **Search & Discovery**: Use search to find any item by title or content across the workspace
`.trim();

export function createServer(config: NestrMcpServerConfig = {}): Server {
  const client = config.client || createClientFromEnv();

  const server = new Server(
    {
      name: "nestr-mcp",
      version: "0.1.0",
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
    return handleToolCall(client, name, (args as Record<string, unknown>) || {});
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

    throw new Error(`Unknown resource: ${uri}`);
  });

  return server;
}
