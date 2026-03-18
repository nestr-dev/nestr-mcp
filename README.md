# @nestr/mcp

MCP (Model Context Protocol) server for [Nestr](https://nestr.io) - connect AI assistants like Claude to your workspace.

## What is this?

This MCP server allows AI assistants to interact with your Nestr workspace:

- Search for tasks, projects, and roles
- Create and update nests
- View organizational structure (circles, roles, accountabilities)
- Get workspace insights and metrics
- Add comments and collaborate

## Quick Start

**Visit [mcp.nestr.io](https://mcp.nestr.io)** for the easiest setup with step-by-step instructions for Claude Desktop, Claude Code, and Cursor.

### Claude Desktop

1. Go to **Settings → Connectors → Add custom connector**
2. Set **Name** to `Nestr` and **Remote MCP URL** to `https://mcp.nestr.io/mcp`
3. Click "Add" then "Authenticate" to log in with Nestr

### Claude Code

```bash
claude mcp add nestr --transport http https://mcp.nestr.io/mcp
```

Then run `/mcp` in Claude Code and click "Authenticate" to log in.

### Using the npm Package (Local)

If you prefer to run the MCP server locally:

```bash
npx @nestr/mcp
```

Configure your AI client with:

```json
{
  "mcpServers": {
    "nestr": {
      "command": "npx",
      "args": ["-y", "@nestr/mcp"],
      "env": {
        "NESTR_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

To get an API key:
1. Go to your [Nestr workspace](https://app.nestr.io)
2. Click **Settings** → **Integrations** → **Workspace API access** → **Configure**
3. Click **"New API key"** and copy it

## Start Using It

Ask your AI assistant things like:

- "What workspaces do I have access to?"
- "Search for tasks related to marketing"
- "Create a new project called 'Q1 Planning'"
- "What are my current projects and their status?"
- "Who is responsible for customer support?"

## Available Tools

### Workspace & Search

| Tool | Description |
|------|-------------|
| `nestr_list_workspaces` | List accessible workspaces |
| `nestr_get_workspace` | Get workspace details |
| `nestr_create_workspace` | Create a new workspace (OAuth only) |
| `nestr_search` | Search for nests (tasks, projects, roles) |
| `nestr_get_me` | Get current user identity and workspace list |

### Nests (Tasks, Projects, Roles)

| Tool | Description |
|------|-------------|
| `nestr_get_nest` | Get details of a specific nest (supports batch fetch with comma-separated IDs) |
| `nestr_get_nest_children` | Get child nests |
| `nestr_create_nest` | Create a new nest |
| `nestr_update_nest` | Update nest properties |
| `nestr_delete_nest` | Delete a nest |
| `nestr_reorder_nest` | Reorder a nest relative to another |
| `nestr_bulk_reorder` | Bulk reorder multiple nests |
| `nestr_add_label` | Add a label to a nest |
| `nestr_remove_label` | Remove a label from a nest |

### Comments & Discussion

| Tool | Description |
|------|-------------|
| `nestr_add_comment` | Add a comment to a nest |
| `nestr_get_comments` | Get comments/discussion on a nest |
| `nestr_update_comment` | Update a comment |
| `nestr_delete_comment` | Delete a comment |

### Organization Structure

| Tool | Description |
|------|-------------|
| `nestr_list_circles` | List organizational circles |
| `nestr_get_circle` | Get circle details |
| `nestr_get_circle_roles` | Get roles in a circle with accountabilities and domains |
| `nestr_list_roles` | List all roles |
| `nestr_list_users` | List workspace members |
| `nestr_get_user` | Get user details |
| `nestr_add_workspace_user` | Add a user to the workspace |

### Tensions

| Tool | Description |
|------|-------------|
| `nestr_create_tension` | Create a tension on a circle or role |
| `nestr_get_tension` | Get tension details |
| `nestr_list_tensions` | List tensions on a circle or role |
| `nestr_update_tension` | Update a tension |
| `nestr_delete_tension` | Delete a tension |
| `nestr_get_tension_parts` | Get proposal parts of a tension |
| `nestr_add_tension_part` | Add a proposal part (new/changed governance item) |
| `nestr_modify_tension_part` | Modify a proposal part |
| `nestr_remove_tension_part` | Remove a proposal part |
| `nestr_get_tension_part_children` | Get children (accountabilities/domains) of a proposal part |
| `nestr_create_tension_part_child` | Add a child to a proposal part |
| `nestr_update_tension_part_child` | Update a proposal part child |
| `nestr_delete_tension_part_child` | Delete a proposal part child |
| `nestr_get_tension_changes` | Preview the diff a proposal part would apply |
| `nestr_get_tension_status` | Get voting status for a tension |
| `nestr_update_tension_status` | Submit for voting or retract to draft |

### Graph Links

| Tool | Description |
|------|-------------|
| `nestr_get_graph_links` | Get nests linked via a named relation (e.g., meeting agenda items) |
| `nestr_add_graph_link` | Create a bidirectional link between two nests |
| `nestr_remove_graph_link` | Remove a link between two nests |

### Labels & Projects

| Tool | Description |
|------|-------------|
| `nestr_list_labels` | List workspace labels |
| `nestr_get_label` | Get label details |
| `nestr_get_projects` | List projects with status |

### Insights & Apps

| Tool | Description |
|------|-------------|
| `nestr_get_insights` | Get workspace metrics |
| `nestr_get_insight_history` | Get historical trend data for a metric |
| `nestr_get_workspace_apps` | List enabled apps/features |

### Personal (OAuth only)

| Tool | Description |
|------|-------------|
| `nestr_get_me` | Get current user identity and workspaces |
| `nestr_list_inbox` | List items in user's inbox |
| `nestr_create_inbox_item` | Quick capture to inbox |
| `nestr_get_inbox_item` | Get inbox item details |
| `nestr_update_inbox_item` | Update inbox item |
| `nestr_reorder_inbox` | Reorder inbox items |
| `nestr_list_personal_labels` | List user's personal labels |
| `nestr_create_personal_label` | Create a personal label |
| `nestr_get_daily_plan` | Get items marked for today |
| `nestr_add_to_daily_plan` | Add items to today's focus |
| `nestr_remove_from_daily_plan` | Remove items from today's focus |
| `nestr_list_my_tensions` | List tensions authored by or assigned to you |
| `nestr_list_tensions_awaiting_consent` | List governance proposals needing your vote |

## MCP Apps (Interactive UI)

MCP Apps are interactive UI components that can be embedded in MCP clients that support them (like Claude.ai). They provide rich, visual interfaces for working with Nestr data.

### Completable List

**Resource URI:** `ui://nestr/completable-list`

An interactive list for viewing and completing tasks and projects.

**Features:**
- Projects show a box icon, todos show a checkbox
- Check items to mark them complete (strikethrough)
- Inline editing of titles (auto-saves)
- Drag-and-drop reordering
- Shows parent path for context
- Quick link to open item in Nestr

**Usage:** When an AI assistant returns task or project results, supporting clients can render this interactive UI instead of plain text, allowing you to complete items, edit titles, and reorder directly in the chat.

## Authentication

### OAuth (Recommended)

The hosted service at [mcp.nestr.io](https://mcp.nestr.io) handles OAuth automatically. Just add the server and authenticate through your browser.

OAuth respects user-specific permissions - the AI assistant can only access what the authenticated user can access.

### API Key

API keys provide full workspace access and work with the local npm package. See [Quick Start](#using-the-npm-package-local) above.

**Note:** API keys have full workspace access regardless of user permissions.

## Environment Variables

### Authentication (Required)

| Variable | Description |
|----------|-------------|
| `NESTR_API_KEY` | Nestr API key (full workspace access) |
| `NESTR_OAUTH_TOKEN` | OAuth token (respects user permissions) |

\* Either `NESTR_API_KEY` or `NESTR_OAUTH_TOKEN` is required for local usage.

### Configuration (Optional)

| Variable | Description | Default |
|----------|-------------|---------|
| `NESTR_API_BASE` | API base URL | `https://app.nestr.io/api` |

### Hosting/Server (HTTP transport only)

These are used when running the HTTP server for hosted deployments:

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | HTTP server port | `3000` |
| `NESTR_OAUTH_CLIENT_ID` | OAuth client ID for hosted OAuth flow | - |
| `NESTR_OAUTH_CLIENT_SECRET` | OAuth client secret | - |
| `OAUTH_ENCRYPTION_KEY` | 32-byte base64 key for encrypting OAuth sessions at rest | - |
| `GTM_ID` | Google Tag Manager container ID for landing page | - |

### Analytics (Optional)

Server-side analytics options:

**GA4 Measurement Protocol:**

| Variable | Description |
|----------|-------------|
| `GA4_MEASUREMENT_ID` | GA4 Measurement ID (e.g., `G-XXXXXXXXXX`) |
| `GA4_API_SECRET` | Measurement Protocol API secret |
| `GA4_DEBUG` | Set to `true` to validate events without recording |

**Note:** Both `GA4_MEASUREMENT_ID` and `GA4_API_SECRET` are required for GA4 tracking. If only the measurement ID is set, a warning is logged and tracking is disabled.

**MCPcat (MCP-specific analytics):**

| Variable | Description |
|----------|-------------|
| `MCPCAT_PROJECT_ID` | MCPcat project ID (from [mcpcat.io](https://mcpcat.io)) |
| `MCPCAT_ENABLE_REPLAY` | Enable session replay (default: `false`) |

## Development

```bash
# Clone the repository
git clone https://github.com/nestr-dev/nestr-mcp.git
cd nestr-mcp

# Install dependencies
npm install

# Set your API key
export NESTR_API_KEY=your-api-key

# Run in development mode (stdio)
npm run dev

# Run HTTP server for local testing
npm run dev:http

# Build for production
npm run build

# Test with MCP Inspector
npm run inspect
```

## Security

- Never commit your API key or OAuth token to version control
- OAuth tokens respect user permissions and are recommended
- API keys provide full workspace access - use OAuth for granular permissions
- Rotate credentials if you suspect they've been compromised

## Resources

- [Setup Guide](https://mcp.nestr.io) - Step-by-step setup instructions
- [Nestr Help Center](https://help.nestr.io)
- [Nestr API Documentation](https://app.nestr.io/api/docs)
- [Model Context Protocol](https://modelcontextprotocol.io)

## License

MIT - see [LICENSE](LICENSE)

## Support

- [GitHub Issues](https://github.com/nestr-dev/nestr-mcp/issues)
- [Nestr Support](https://help.nestr.io)
