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
| `nestr_list_circles` | List organizational circles |
| `nestr_get_circle_roles` | Get roles in a circle |
| `nestr_list_roles` | List all roles |
| `nestr_get_insights` | Get workspace metrics |
| `nestr_list_users` | List workspace members |
| `nestr_list_labels` | List available labels |
| `nestr_get_projects` | List projects with status |

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `NESTR_API_KEY` | Your Nestr API key | Yes |
| `NESTR_API_BASE` | API base URL (default: `https://app.nestr.io/api`) | No |

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

- Never commit your API key to version control
- Your API key provides full access to your workspace
- Store it securely (e.g., in a password manager)
- Rotate keys if you suspect they've been compromised

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
