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

The specific self-organization methodology is stored in \`workspace.data['self_organisation_type']\` (e.g., "holacracy", "sociocracy", "custom").

## Core Concepts

- **Workspace**: Top-level container - either an organization's anchor circle or a personal workspace
- **Nest**: The universal building block - can be a task, project, role, circle, meeting, or any work item
- **Circle**: A self-governing team with defined purpose, roles, and accountabilities (Holacracy/Sociocracy concept)
- **Role**: A set of responsibilities (accountabilities) and decision rights (domains) that a person energizes
- **Label**: Tags that define what type of nest something is (e.g., "project", "todo", "meeting", "anchor-circle")

## Nest Model Architecture

Every nest has these **standard fields**:
- \`_id\` - Unique identifier
- \`title\` - Display name
- \`purpose\` - Why this nest exists (especially important for roles/circles)
- \`description\` - Detailed description (may contain rich text)
- \`parentId\` - ID of parent nest
- \`ancestors\` - Array of ancestor IDs (for hierarchy traversal)
- \`labels\` - Array of label IDs that define what type this nest is
- \`fields\` - Label-specific custom fields (see below)
- \`data\` - Miscellaneous data storage for non-field data (e.g., third-party IDs, integration metadata, custom tracking data)
- \`due\` - Context-dependent date field:
  - **Project/Task**: Due date
  - **Role**: Re-election date (when the role assignment should be reviewed)
  - **Meeting**: Start date/time
- \`completed\` - Whether this item is completed (for tasks/projects/meetings etc.)
- \`createdAt\`, \`updatedAt\` - Timestamps

### The \`fields\` Property

The \`fields\` object holds custom data defined by labels. Fields are **namespaced by the label that defines them**:

\`\`\`json
{
  "fields": {
    "project.status": "Current",
    "role.electable-role": true,
    "metric.frequency": "Weekly"
  }
}
\`\`\`

**Key project statuses** (in \`fields['project.status']\`):
- \`Future\` - Planned but not started
- \`Current\` - Actively being worked on
- \`Waiting\` - Blocked or on hold
- \`Done\` - Completed

**Important:** Label field schemas can be customized at the workspace or circle level. This means the available fields and their options may vary between different parts of the organization hierarchy. Always check what fields are actually present on a nest rather than assuming a fixed schema.

## Best Practices

1. **Start by listing workspaces** to get the workspace ID and check if it has the "anchor-circle" label
2. **Use search** to find specific items rather than browsing through hierarchies
3. **Check labels** to understand what type of nest you're working with
4. **Use @mentions** in comments to notify team members
5. **Respect the hierarchy**: nests live under parents (workspace → circle → role/project → task)

## Important Labels

Labels define what type a nest is. The API strips the "circleplus-" prefix, so use labels without it.

**Governance Structure:**
- \`anchor-circle\` - The workspace itself when it's an organization
- \`circle\` - A sub-circle/team within the organization
- \`role\` - A role with accountabilities and domains
- \`accountability\` - An ongoing activity the role is responsible for performing (Holacracy: "an ongoing activity that the Role will enact")
- \`domain\` - An area the role has exclusive control over; others must get permission to impact it (Holacracy: "something the Role may exclusively control on behalf of the Organization")
- \`policy\` - A grant or restriction of authority affecting how others interact with a domain or process. Can live on a domain, role, or circle directly.

**Note:** Accountabilities, domains, and policies are child-nests of roles/circles. Use \`nestr_get_circle_roles\` or \`nestr_get_nest_children\` to retrieve them. The generic \`nestr_search\` won't return them by default.

**Meetings & Operations:**
- \`metric\` - A metric tracked by a role/circle
- \`checklist\` - A recurring checklist item
- \`governance\` - A governance meeting
- \`tactical\` - A tactical/operational meeting

**OKRs & Goals:**
- \`goal\` - An Objective (the O in OKR)
- \`result\` - A Key Result (the KR in OKR)

**General:**
- \`project\` - A project with status tracking (Current/Waiting/Done/Future)
- \`note\` - A simple note
- \`meeting\` - A calendar meeting
- \`prepared-tension\` - A tension (gap between current and desired state). Used for meeting agenda items, async governance proposals, and general tension processing. Central to Holacracy practice.

## Search Query Syntax

The \`nestr_search\` tool supports powerful query operators. Combine multiple operators with spaces (AND logic) or use commas within an operator (OR logic).

### Common Search Operators

| Operator | Example | Description |
|----------|---------|-------------|
| \`label:\` | \`label:role\` | Filter by label type |
| \`label:!\` | \`label:!project\` | Exclude label |
| \`assignee:\` | \`assignee:me\` | Filter by assignee (use \`me\` for current user) |
| \`completed:\` | \`completed:false\` | Filter by completion status |
| \`has:\` | \`has:due\` | Items with a property (due, children, etc.) |
| \`depth:\` | \`depth:1\` | Limit search depth (1 = direct children only) |
| \`createdby:\` | \`createdby:me\` | Filter by creator |

### Field Value Search

Search by label-specific field values using \`label->field:value\`:
- \`project->status:Current\` - Projects with status "Current"
- \`project->status:Current,Future\` - Status is Current OR Future
- \`project->status:!Done\` - Status is NOT Done

### Search Examples

\`\`\`
label:role
  -> Find all roles

label:project assignee:me completed:false
  -> My incomplete projects

label:project project->status:Current
  -> Projects with status "Current"

label:circle depth:1
  -> Direct sub-circles only

has:due completed:false
  -> Incomplete items with due dates

label:meeting has:!completed
  -> Meetings not yet completed

label:policy spending
  -> Policies mentioning spending

label:policy budget cost expense
  -> Policies about budgets, costs, or expenses

label:accountability customer
  -> Accountabilities related to customers
\`\`\`

### Additional Operators

- \`parent-label:circle\` - Items under a circle
- \`in:nestId\` - Search within specific nest
- \`updated-date:past_7_days\` - Recently updated (also: past_30_days, this_month, etc.)
- \`type:comment\` - Search comments/posts
- \`deleted:true\` - Include deleted items

## Common Workflows

- **Task Management**: Create nests with "todo" label, update status fields, add comments for updates
- **Project Tracking**: List projects, get children to see tasks, check insights for metrics
- **Team Structure**: List circles to see teams, get roles to understand accountabilities and domains
- **Finding Accountabilities/Domains**: Use \`nestr_get_circle_roles\` for a circle's roles with their accountabilities, or \`nestr_get_nest_children\` on a specific role
- **Search & Discovery**: Use search with operators like \`label:role\` or \`assignee:me completed:false\`
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
