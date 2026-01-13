# CLAUDE.md

This file provides guidance to Claude Code when working with the Nestr MCP Server.

## Project Overview

This is an MCP (Model Context Protocol) server that connects AI assistants (Claude, Cursor, etc.) to Nestr workspaces. It wraps the Nestr REST API and exposes it as MCP tools.

**Package:** `@nestr/mcp`
**Landing page:** https://mcp.nestr.io
**Nestr API docs:** https://app.nestr.io/api/docs

## Development Commands

```bash
# Install dependencies
npm install

# Development (stdio transport)
npm run dev

# Development (HTTP server for mcp.nestr.io)
npm run dev:http

# Build TypeScript
npm run build

# Test with MCP Inspector
npm run inspect

# Production (stdio)
npm start

# Production (HTTP)
npm run start:http
```

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `NESTR_API_KEY` | Nestr API key from workspace settings | Yes |
| `NESTR_API_BASE` | API base URL (default: `https://app.nestr.io/api`) | No |
| `PORT` | HTTP server port (default: `3000`) | No (HTTP only) |

## Architecture

```
src/
├── index.ts          # Entry point - stdio transport (npx @nestr/mcp)
├── http.ts           # Entry point - HTTP transport (mcp.nestr.io)
├── server.ts         # MCP server setup, tool & resource registration
├── api/
│   └── client.ts     # Nestr REST API client wrapper
└── tools/
    └── index.ts      # Tool definitions and handlers

web/
├── index.html        # Landing page for mcp.nestr.io
└── styles.css        # Landing page styles
```

## Key Files

- **src/server.ts** - Creates the MCP server, registers tools and resources
- **src/tools/index.ts** - Defines all 16 MCP tools with Zod schemas and handlers
- **src/api/client.ts** - Type-safe wrapper for Nestr REST API
- **web/index.html** - User-facing documentation at mcp.nestr.io

## MCP Tools

The server exposes these tools to AI assistants:

| Tool | Nestr API |
|------|-----------|
| `nestr_list_workspaces` | `GET /workspaces` |
| `nestr_get_workspace` | `GET /workspaces/{id}` |
| `nestr_search` | `GET /workspaces/{id}/search` |
| `nestr_get_nest` | `GET /nests/{id}` |
| `nestr_get_nest_children` | `GET /nests/{id}/children` |
| `nestr_create_nest` | `POST /nests` |
| `nestr_update_nest` | `PATCH /nests/{id}` |
| `nestr_delete_nest` | `DELETE /nests/{id}` |
| `nestr_add_comment` | `POST /nests/{id}/posts` |
| `nestr_list_circles` | `GET /workspaces/{id}/circles` |
| `nestr_get_circle_roles` | `GET /workspaces/{id}/circles/{cid}/roles` |
| `nestr_list_roles` | `GET /workspaces/{id}/roles` |
| `nestr_get_insights` | `GET /workspaces/{id}/insights` |
| `nestr_list_users` | `GET /workspaces/{id}/users` |
| `nestr_list_labels` | `GET /workspaces/{id}/labels` |
| `nestr_get_projects` | `GET /workspaces/{id}/projects` |

## Adding a New Tool

1. Add the Zod schema in `src/tools/index.ts` under `schemas`
2. Add the tool definition in `toolDefinitions` array
3. Add the handler case in `handleToolCall` switch statement
4. If needed, add the API method in `src/api/client.ts`

Example:
```typescript
// 1. Schema
const schemas = {
  myNewTool: z.object({
    workspaceId: z.string().describe("Workspace ID"),
  }),
};

// 2. Definition
const toolDefinitions = [
  {
    name: "nestr_my_new_tool",
    description: "Does something useful",
    inputSchema: {
      type: "object",
      properties: {
        workspaceId: { type: "string", description: "Workspace ID" },
      },
      required: ["workspaceId"],
    },
  },
];

// 3. Handler
case "nestr_my_new_tool": {
  const parsed = schemas.myNewTool.parse(args);
  const result = await client.someMethod(parsed.workspaceId);
  return formatResult(result);
}
```

## Deployment

### NPM Package
- Published as `@nestr/mcp`
- Users run via `npx @nestr/mcp`
- Requires `NESTR_API_KEY` environment variable

### Hosted Service (mcp.nestr.io)
- Docker image published to `ghcr.io/nestr-dev/nestr-mcp`
- Deployed via nestr-flux
- Serves landing page at `/` and MCP endpoint at `/mcp`
- Users pass API key via `X-Nestr-API-Key` header

## Testing

```bash
# Set API key
export NESTR_API_KEY=your-key

# Test with MCP Inspector (opens web UI)
npm run inspect

# Test HTTP server locally
npm run dev:http
# Then visit http://localhost:3000
```

## Nestr Concepts

- **Nest** - Base building block (task, project, role, circle, etc.)
- **Workspace** - Top-level container (organization)
- **Circle** - Team/department with roles
- **Role** - Position with accountabilities and domains
- **Label** - Tag that gives meaning to nests (e.g., "project", "todo")

## Resources

- [Nestr Help](https://help.nestr.io)
- [Nestr API Swagger](https://app.nestr.io/api/docs)
- [MCP Specification](https://modelcontextprotocol.io/specification/2025-11-25)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
