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

### 1. Get Your API Key

1. Go to your [Nestr workspace](https://app.nestr.io)
2. Click **Settings** (gear icon) in the top right
3. Go to the **Integrations** tab
4. Find **"Workspace API access"** and click **Configure**
5. Click **"New API key"** and copy it

### 2. Configure Your AI Client

#### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

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

Restart Claude Desktop after saving.

#### Claude Code

Add to your Claude Code MCP settings:

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

#### Cursor

Add to your Cursor MCP configuration with the same format as above.

### 3. Start Using It

Ask your AI assistant things like:

- "What workspaces do I have access to?"
- "Search for tasks related to marketing"
- "Create a new project called 'Q1 Planning'"
- "What are my current projects and their status?"
- "Who is responsible for customer support?"
- "Show me the structure of the Product circle"

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
| `nestr_get_insights` | Get self-organization and team health metrics |
| `nestr_get_insight_history` | Get historical trend data for a metric |
| `nestr_get_workspace_apps` | List enabled apps/features in workspace |
| `nestr_list_inbox` | List items in user's inbox (OAuth only) |
| `nestr_create_inbox_item` | Quick capture to inbox (OAuth only) |
| `nestr_get_inbox_item` | Get inbox item details (OAuth only) |
| `nestr_update_inbox_item` | Update inbox item (OAuth only) |

## Authentication

There are two ways to authenticate with the Nestr MCP server:

### Option 1: API Key (Simple)

API keys provide full workspace access and are the easiest way to get started. See [Quick Start](#quick-start) above.

**Note:** API keys have full workspace access regardless of user permissions.

### Option 2: OAuth (Recommended for Hosted Service)

OAuth authentication respects user-specific permissions - the AI assistant can only access what the authenticated user can access.

#### Using the Hosted Service (mcp.nestr.io)

The hosted service at [mcp.nestr.io](https://mcp.nestr.io) supports OAuth out of the box:

1. Visit [mcp.nestr.io/oauth/authorize](https://mcp.nestr.io/oauth/authorize)
2. Log in with your Nestr account and authorize access
3. Copy the access token from the success page
4. Use the token in your MCP client configuration:

```json
{
  "mcpServers": {
    "nestr": {
      "command": "npx",
      "args": ["-y", "@nestr/mcp"],
      "env": {
        "NESTR_OAUTH_TOKEN": "your-oauth-token-here"
      }
    }
  }
}
```

#### Self-Hosted OAuth Setup

If you're running your own instance of the MCP server and want to enable OAuth:

1. **Contact Nestr** at [dev@nestr.io](mailto:dev@nestr.io) to register an OAuth client
2. Provide your callback URL (e.g., `https://your-domain.com/oauth/callback`)
3. Nestr will provide you with a `client_id` and `client_secret`
4. Set the following environment variables:

```bash
NESTR_OAUTH_CLIENT_ID=your-client-id
NESTR_OAUTH_CLIENT_SECRET=your-client-secret
```

Once configured, users can authenticate via `/oauth/authorize` on your server.

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `NESTR_API_KEY` | Nestr API key (full workspace access) | Yes* |
| `NESTR_OAUTH_TOKEN` | OAuth token (respects user permissions) | Yes* |
| `NESTR_API_BASE` | API base URL (default: `https://app.nestr.io/api`) | No |
| `NESTR_OAUTH_CLIENT_ID` | OAuth client ID (for self-hosted OAuth) | No |
| `NESTR_OAUTH_CLIENT_SECRET` | OAuth client secret (for self-hosted OAuth) | No |

\* Either `NESTR_API_KEY` or `NESTR_OAUTH_TOKEN` is required.

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

## Hosted Service

A hosted version is available at [mcp.nestr.io](https://mcp.nestr.io) for users who prefer not to run the server locally.

## Security

- Never commit your API key or OAuth token to version control
- API keys provide full workspace access - consider using OAuth for more granular permissions
- OAuth tokens respect user permissions and are the recommended approach for shared environments
- Store credentials securely (e.g., in a password manager or secrets manager)
- Rotate keys/tokens if you suspect they've been compromised

## Resources

- [Nestr Help Center](https://help.nestr.io)
- [Nestr API Documentation](https://app.nestr.io/api/docs)
- [Model Context Protocol](https://modelcontextprotocol.io)
- [MCP Specification](https://modelcontextprotocol.io/specification/2025-11-25)

## License

MIT - see [LICENSE](LICENSE)

## Support

- [GitHub Issues](https://github.com/nestr-dev/nestr-mcp/issues)
- [Nestr Support](https://help.nestr.io)
