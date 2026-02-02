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
| `NESTR_OAUTH_TOKEN` | OAuth Bearer token from Nestr OAuth flow (recommended) | Yes* |
| `NESTR_API_KEY` | Nestr API key from workspace settings | Yes* |
| `NESTR_API_BASE` | API base URL (default: `https://app.nestr.io/api`) | No |
| `NESTR_OAUTH_CLIENT_ID` | OAuth client ID (for registered clients) | No |
| `NESTR_OAUTH_CLIENT_SECRET` | OAuth client secret (for registered clients) | No |
| `MCP_RESOURCE_URL` | MCP resource identifier (default: `https://mcp.nestr.io/mcp`) | No |
| `PORT` | HTTP server port (default: `3000`) | No (HTTP only) |
| `GTM_ID` or `NESTR_GTM_ID` | Google Tag Manager container ID (e.g., `GTM-XXXXXXX`) | No (HTTP only) |
| `MCPCAT_PROJECT_ID` | MCPcat project ID for analytics (from [mcpcat.io](https://mcpcat.io)) | No |
| `MCPCAT_ENABLE_REPLAY` | Enable session replay in MCPcat (default: `false`, only metadata tracked) | No |
| `OAUTH_ENCRYPTION_KEY` | 32-byte base64-encoded key for encrypting OAuth sessions at rest. If not set, sessions are stored in plaintext. | No |
| `GA4_MEASUREMENT_ID` | GA4 Measurement ID (e.g., `G-XXXXXXXXXX`) for server-side analytics | No |
| `GA4_API_SECRET` | GA4 Measurement Protocol API secret (from GA4 Admin → Data Streams) | No |
| `GA4_DEBUG` | Set to `true` to use GA4 debug endpoint (validates but doesn't record) | No |

\* Either `NESTR_OAUTH_TOKEN` (recommended) or `NESTR_API_KEY` is required.

**Security Note:** OAuth sessions can be encrypted at rest using AES-256-GCM. Set `OAUTH_ENCRYPTION_KEY` to enable encryption. When the key is added, existing plaintext sessions are automatically migrated to encrypted storage. Generate a key with: `openssl rand -base64 32`

**OAuth is recommended** because it respects user-specific permissions. API keys have full workspace access regardless of user permissions.

## Architecture

```
src/
├── index.ts          # Entry point - stdio transport (npx @nestr/mcp)
├── http.ts           # Entry point - HTTP transport (mcp.nestr.io)
├── server.ts         # MCP server setup, tool & resource registration
├── analytics/
│   ├── index.ts      # Generic event tracking interface and registry
│   └── ga4.ts        # GA4 Measurement Protocol implementation
├── api/
│   └── client.ts     # Nestr REST API client wrapper
├── apps/
│   └── index.ts      # MCP Apps - interactive UI components (HTML inlined)
├── oauth/
│   ├── config.ts     # OAuth configuration and metadata (RFC 9728)
│   ├── flow.ts       # OAuth authorization code flow with PKCE
│   └── storage.ts    # Persistent storage for OAuth sessions and clients
└── tools/
    └── index.ts      # Tool definitions and handlers

web/
├── index.html        # Landing page for mcp.nestr.io
└── styles.css        # Landing page styles
```

## OAuth Flow

The MCP server acts as an OAuth client with Nestr. Users see the Nestr login screen and authorize access.

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  MCP Client │     │  MCP Server │     │    Nestr    │
│ (Claude,etc)│     │(mcp.nestr.io│     │(app.nestr.io│
└──────┬──────┘     └──────┬──────┘     └──────┬──────┘
       │                   │                   │
       │ 1. Connect        │                   │
       │──────────────────>│                   │
       │                   │                   │
       │ 2. 401 + WWW-Auth │                   │
       │<──────────────────│                   │
       │                   │                   │
       │ 3. Open browser to /oauth/authorize   │
       │──────────────────>│                   │
       │                   │                   │
       │                   │ 4. Redirect to    │
       │                   │    Nestr OAuth    │
       │                   │──────────────────>│
       │                   │                   │
       │                   │    5. User logs   │
       │                   │       in & auth   │
       │                   │                   │
       │                   │ 6. Callback with  │
       │                   │    auth code      │
       │                   │<──────────────────│
       │                   │                   │
       │                   │ 7. Exchange code  │
       │                   │    for token      │
       │                   │──────────────────>│
       │                   │                   │
       │                   │ 8. Access token   │
       │                   │<──────────────────│
       │                   │                   │
       │ 9. Token for MCP  │                   │
       │<──────────────────│                   │
       │                   │                   │
       │ 10. MCP requests  │                   │
       │    with Bearer    │                   │
       │──────────────────>│                   │
       │                   │ 11. API calls     │
       │                   │──────────────────>│
       └───────────────────┴───────────────────┘
```

### OAuth Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /oauth/authorize` | Initiates OAuth flow, redirects to Nestr |
| `GET /oauth/callback` | Handles redirect from Nestr, exchanges code for token |
| `GET /.well-known/oauth-protected-resource` | OAuth metadata (RFC 9728) |
| `GET /.well-known/oauth-authorization-server` | Authorization server metadata (RFC 8414) |

### Setup OAuth Client in Nestr

To enable the OAuth flow, register an OAuth client in Nestr:

1. Create an OAuth client with:
   - **Client ID**: e.g., `nestr-mcp`
   - **Redirect URI**: `https://mcp.nestr.io/oauth/callback`
   - **Scopes**: `user`, `nest`

2. Set environment variables:
   ```bash
   NESTR_OAUTH_CLIENT_ID=your-client-id
   NESTR_OAUTH_CLIENT_SECRET=your-client-secret  # if required
   ```

## Analytics

Server-side event tracking with a pluggable architecture. Trackers register themselves and all receive events.

### Configuration

For GA4 tracking, set both environment variables:
```bash
GA4_MEASUREMENT_ID=G-XXXXXXXXXX  # Your GA4 Measurement ID
GA4_API_SECRET=your-api-secret   # From GA4 Admin → Data Streams → Measurement Protocol API secrets
```

**Note:** If `GA4_MEASUREMENT_ID` is set without `GA4_API_SECRET`, a warning is logged and GA4 tracking is disabled.

### Events Tracked

| Event | When | Parameters |
|-------|------|------------|
| `mcp_session_start` | MCP connection established | `auth_method`, `has_token`, `mcp_client` |
| `mcp_tool_call` | Tool invocation | `tool_name`, `workspace_id`, `success`, `error_code` |
| `mcp_oauth_start` | OAuth flow initiated | `client_consumer` |
| `mcp_oauth_complete` | OAuth flow completed | `is_new_user` |
| `mcp_session_end` | MCP connection closed | `duration_seconds`, `tool_call_count` |
| `mcp_error` | Error occurred | `error_type`, `error_message`, `tool_name` |

All events include: `app: "nestr_mcp"`, `mcp_client`, `transport`, and `user_id` (when available).

### Cross-Domain Tracking

The MCP server passes `_ga_client_id` and UTM parameters through OAuth redirects to enable session stitching between mcp.nestr.io and app.nestr.io. This allows tracking user journeys from MCP installation through OAuth to app usage.

### Adding a New Tracker

Implement the `EventTracker` interface and register it:

```typescript
// src/analytics/mixpanel.ts
import { analytics, EventTracker, AnalyticsContext } from "./index.js";

class MixpanelTracker implements EventTracker {
  readonly name = "Mixpanel";

  initialize() {
    // Validate config, throw if invalid
  }

  trackSessionStart(context: AnalyticsContext, params) {
    // Send to Mixpanel
  }
  // ... implement other methods
}

// Auto-register on import
analytics.register(new MixpanelTracker());
```

## Key Files

- **src/server.ts** - Creates the MCP server, registers tools and resources
- **src/tools/index.ts** - Defines all 33 MCP tools with Zod schemas and handlers
- **src/api/client.ts** - Type-safe wrapper for Nestr REST API
- **src/apps/index.ts** - MCP Apps with inlined HTML for interactive UI components
- **src/analytics/index.ts** - Generic event tracking interface with pluggable trackers
- **src/analytics/ga4.ts** - GA4 Measurement Protocol tracker implementation
- **src/oauth/config.ts** - OAuth configuration and metadata endpoints (RFC 9728)
- **src/oauth/flow.ts** - OAuth authorization code flow
- **web/index.html** - User-facing documentation at mcp.nestr.io

## MCP Tools

The server exposes these tools to AI assistants:

| Tool | Nestr API |
|------|-----------|
| `nestr_list_workspaces` | `GET /workspaces` |
| `nestr_get_workspace` | `GET /workspaces/{id}` |
| `nestr_create_workspace` | `POST /workspaces` (OAuth only) |
| `nestr_search` | `GET /workspaces/{id}/search` |
| `nestr_get_nest` | `GET /nests/{id}` |
| `nestr_get_nest_children` | `GET /nests/{id}/children` |
| `nestr_create_nest` | `POST /nests` |
| `nestr_update_nest` | `PATCH /nests/{id}` |
| `nestr_delete_nest` | `DELETE /nests/{id}` |
| `nestr_add_comment` | `POST /nests/{id}/posts` |
| `nestr_get_comments` | `GET /nests/{id}/posts` |
| `nestr_list_circles` | `GET /workspaces/{id}/circles` |
| `nestr_get_circle` | `GET /workspaces/{id}/circles/{cid}` |
| `nestr_get_circle_roles` | `GET /workspaces/{id}/circles/{cid}/roles` |
| `nestr_list_roles` | `GET /workspaces/{id}/roles` |
| `nestr_list_users` | `GET /workspaces/{id}/users` |
| `nestr_get_user` | `GET /workspaces/{id}/users/{uid}` |
| `nestr_list_labels` | `GET /workspaces/{id}/labels` |
| `nestr_get_label` | `GET /workspaces/{id}/labels/{lid}` |
| `nestr_get_projects` | `GET /workspaces/{id}/projects` |
| `nestr_get_insights` | `GET /workspaces/{id}/insights` |
| `nestr_get_insight_history` | `GET /workspaces/{id}/insights/{mid}/history` |
| `nestr_get_workspace_apps` | `GET /workspaces/{id}/apps` |
| `nestr_list_inbox` | `GET /users/me/inbox` (OAuth only) |
| `nestr_create_inbox_item` | `POST /users/me/inbox` (OAuth only) |
| `nestr_get_inbox_item` | `GET /users/me/inbox/{id}` (OAuth only) |
| `nestr_update_inbox_item` | `PATCH /users/me/inbox/{id}` (OAuth only) |
| `nestr_reorder_inbox` | `PATCH /users/me/inbox/reorder` (OAuth only) |
| `nestr_list_personal_labels` | `GET /users/me/labels` (OAuth only) |
| `nestr_create_personal_label` | `POST /users/me/labels` (OAuth only) |
| `nestr_get_daily_plan` | `GET /users/me/today` (OAuth only) |
| `nestr_reorder_nest` | `POST /nests/{id}/reorder/{position}/{relatedId}` |
| `nestr_bulk_reorder` | `PATCH /workspaces/{id}/reorder` |

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

## MCP Apps (Interactive UI)

The server includes MCP Apps - interactive UI components that can be embedded in MCP clients that support them (like Claude.ai).

### Completable List App

**Resource URI:** `ui://nestr/completable-list`

An interactive list for completing tasks and projects. Features:
- Projects show a box icon, todos show a checkbox
- Box icon becomes checkbox on hover
- Checked items are strikethrough
- Parent path shown below the title
- Editable titles (triggers PATCH on update)
- Drag-and-drop reordering (triggers reorder tool)
- Quick link to open nest in Nestr

**Source:** `src/apps/index.ts`

### Adding a New MCP App

1. Add the HTML content as a const in `src/apps/index.ts`
2. Export a getter function for the HTML
3. Add resource definition to `appResources`
4. Register the resource in `src/server.ts` (ListResourcesRequestSchema handler)
5. Add read handler in `src/server.ts` (ReadResourceRequestSchema handler)

## Deployment

### NPM Package
- Published as `@nestr/mcp`
- Users run via `npx @nestr/mcp`
- Requires `NESTR_API_KEY` or `NESTR_OAUTH_TOKEN` environment variable

### Hosted Service (mcp.nestr.io)
- Docker image published to `ghcr.io/nestr-dev/nestr-mcp`
- Deployed via nestr-flux
- Serves landing page at `/` and MCP endpoint at `/mcp`
- OAuth metadata at `/.well-known/oauth-protected-resource`
- Users authenticate via:
  - `X-Nestr-API-Key` header (API key)
  - `Authorization: Bearer <token>` header (OAuth token)

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
- **Inbox** - Collection point for quick capture (OAuth only)

## Resources

- [Nestr Help](https://help.nestr.io)
- [Nestr API Swagger](https://app.nestr.io/api/docs)
- [MCP Specification](https://modelcontextprotocol.io/specification/2025-11-25)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
