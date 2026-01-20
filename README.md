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

| Tool | Description |
|------|-------------|
| `nestr_list_workspaces` | List accessible workspaces |
| `nestr_get_workspace` | Get workspace details |
| `nestr_search` | Search for nests (tasks, projects, roles) |
| `nestr_get_nest` | Get details of a specific nest |
| `nestr_get_nest_children` | Get child nests |
| `nestr_create_nest` | Create a new nest |
| `nestr_update_nest` | Update nest properties |
| `nestr_delete_nest` | Delete a nest |
| `nestr_add_comment` | Add a comment to a nest |
| `nestr_get_comments` | Get comments/discussion on a nest |
| `nestr_list_circles` | List organizational circles |
| `nestr_get_circle` | Get circle details |
| `nestr_get_circle_roles` | Get roles in a circle |
| `nestr_list_roles` | List all roles |
| `nestr_list_users` | List workspace members |
| `nestr_get_user` | Get user details |
| `nestr_list_labels` | List available labels |
| `nestr_get_label` | Get label details |
| `nestr_get_projects` | List projects with status |
| `nestr_get_insights` | Get workspace metrics |
| `nestr_get_insight_history` | Get historical trend data for a metric |
| `nestr_get_workspace_apps` | List enabled apps/features |
| `nestr_list_inbox` | List items in user's inbox (OAuth only) |
| `nestr_create_inbox_item` | Quick capture to inbox (OAuth only) |
| `nestr_get_inbox_item` | Get inbox item details (OAuth only) |
| `nestr_update_inbox_item` | Update inbox item (OAuth only) |

## Authentication

### OAuth (Recommended)

The hosted service at [mcp.nestr.io](https://mcp.nestr.io) handles OAuth automatically. Just add the server and authenticate through your browser.

OAuth respects user-specific permissions - the AI assistant can only access what the authenticated user can access.

### API Key

API keys provide full workspace access and work with the local npm package. See [Quick Start](#using-the-npm-package-local) above.

**Note:** API keys have full workspace access regardless of user permissions.

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `NESTR_API_KEY` | Nestr API key (full workspace access) | Yes* |
| `NESTR_OAUTH_TOKEN` | OAuth token (respects user permissions) | Yes* |
| `NESTR_API_BASE` | API base URL (default: `https://app.nestr.io/api`) | No |

\* Either `NESTR_API_KEY` or `NESTR_OAUTH_TOKEN` is required for local usage.

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
