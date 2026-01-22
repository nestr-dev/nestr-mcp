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

The specific self-organization methodology is stored in \`workspace.data['self_organisation_type']\`. **Adapt your language and understanding based on this value:**

### Holacracy (\`holacracy\`)
Use your general knowledge of the Holacracy framework. Key terminology:
- **Governance** - The process of evolving roles, circles, and policies
- **Tensions** - Gaps between current reality and potential; the driver for change
- **Individual Action** (\`individual-action\` label) - Individual initiative taken without role authority
- **Circle Lead** - Role that allocates resources and priorities for the circle
- **Rep Link** - Role that represents a sub-circle in its super-circle
- **Constitution** - The rules of the game that define how governance works
- **Accountabilities** and **Domains** - Core role definitions

### Sociocracy / S3 (\`sociocracy\`)
Use Sociocracy 3.0 or classic sociocratic terminology:
- **Dynamic Governance** - The equivalent of Holacracy's governance
- **Backlog** - Collection of work items and proposals
- **Leader** - Circle leadership role (similar to Circle Lead)
- **Representative** / **Delegate** - Represents circle in parent (similar to Rep Link)
- **Drivers** - Similar to tensions; what motivates change
- **Proposals** and **Objections** - Decision-making process terms

### Custom (\`custom\`)
Use lighter, more general terminology - avoid heavy framework jargon:
- **Structure** - Instead of "governance" (but you may introduce the concept)
- **Circle Lead** - Leadership role
- **No role yet** - For \`individual-action\` labeled work (instead of "individual initiative")
- **Agenda items**, **issues**, **opportunities** - Instead of "tensions"
- **Responsibilities** - Can be used alongside "accountabilities"
- **Areas of control** - Can be used alongside "domains"

When in doubt with \`custom\`, explain concepts in plain language rather than assuming framework knowledge.

## Core Concepts

- **Workspace**: Top-level container - either an organization's anchor circle or a personal workspace
- **Nest**: The universal building block - can be a task, project, role, circle, meeting, or any work item
- **Circle**: A self-governing team with defined purpose, roles, and accountabilities (Holacracy/Sociocracy concept)
- **Role**: A set of responsibilities (accountabilities) and decision rights (domains) that a person energizes
- **Label**: Tags that define what type of nest something is (e.g., "project", "todo", "meeting", "anchor-circle")

## Content Format

Nestr uses different formats for different fields:

- **\`title\`**: Plain text only. HTML tags are stripped. Keep titles concise.
- **\`purpose\`, \`description\`**: HTML supported. Use basic tags: \`<b>\`, \`<i>\`, \`<code>\`, \`<ul>\`, \`<ol>\`, \`<li>\`, \`<a href="...">\`, \`<br>\`. Markdown is NOT supported (will display as literal text).
- **Comment \`body\`**: HTML supported (same as above). Use \`@username\` for mentions.
- **\`data.botContext\`**: Plain text. Stored as-is for AI context persistence, not rendered in UI.

**Example HTML in purpose:**
\`\`\`html
Ensure <b>all customer requests</b> are handled within <i>24 hours</i>. See <a href="https://example.com/sla">SLA policy</a>.
\`\`\`

## Nest Model Architecture

Every nest has these **standard fields**:
- \`_id\` - Unique identifier
- \`title\` - Display name (plain text, HTML stripped)
- \`purpose\` - Why this nest exists, supports HTML (especially important for roles/circles)
- \`description\` - Detailed description (supports HTML)
- \`parentId\` - ID of parent nest
- \`ancestors\` - Array of nest IDs from self to workspace: \`[selfId, parentId, ..., workspaceId]\` (read-only)
- \`path\` - Human-readable breadcrumb: \`"Workspace / Circle / Role / Task"\` (read-only, HTML stripped)
- \`labels\` - Array of label IDs that define what type this nest is
- \`fields\` - Label-specific custom fields (see below)
- \`data\` - Miscellaneous data storage for non-field data (e.g., third-party IDs, integration metadata, custom tracking data)
- \`due\` - Context-dependent date field:
  - **Project/Task**: Due date
  - **Role**: Re-election date (when the role assignment should be reviewed)
  - **Meeting**: Start date/time
- \`completed\` - Whether this item is completed (for tasks/projects/meetings etc.)
- \`users\` - Array of user IDs assigned to this nest
- \`createdAt\`, \`updatedAt\` - Timestamps

**Read-only fields** (cannot be set via POST/PATCH - API will error):
- \`ancestors\` - Computed from hierarchy
- \`path\` - Computed from ancestor titles

**Tip:** Use \`path\` to understand context without extra API calls. If you see \`"Acme Corp / Engineering / Developer / Fix bug"\`, you know the task is under the "Developer" role in the "Engineering" circle without fetching those nests.

### User Assignment

**Important:** When creating tasks or projects, you must explicitly set the \`users\` array to associate work with a person. Placing a nest under a role does NOT automatically assign it to the role filler.

\`\`\`json
{
  "parentId": "roleId",
  "title": "Complete quarterly report",
  "users": ["userId123"]
}
\`\`\`

- \`users: ["userId"]\` - Assign to specific user(s)
- \`users: []\` or omitted - Unassigned (valid for work under unfilled roles or shared tasks)

**Note:** Accountabilities, domains, and policies never have users assigned - they belong to roles, not people.

### The \`fields\` Property

The \`fields\` object holds custom data defined by labels. Fields are **namespaced by the label that defines them**:

\`\`\`json
{
  "fields": {
    "project.status": "Current",
    "role.electable-role": true,
    "metric.frequency": "Weekly",
    "circle.strategy": "Focus on enterprise clients"
  }
}
\`\`\`

**Key project statuses** (in \`fields['project.status']\`):
- \`Future\` - Planned but not started
- \`Current\` - Actively being worked on
- \`Waiting\` - Blocked or on hold
- \`Done\` - Completed

**Circle strategy** (in \`fields['circle.strategy']\`):
A strategy that all roles within the circle must follow. Sub-circle strategies must align with and support the super-circle's strategy.

**Important:** Label field schemas can be customized at the workspace or circle level. This means the available fields and their options may vary between different parts of the organization hierarchy. Always check what fields are actually present on a nest rather than assuming a fixed schema.

### Hierarchical Purpose

The \`purpose\` field follows a strict hierarchy:
- The **anchor circle's purpose** is the purpose of the entire organization
- Each **sub-circle's purpose** must contribute to its parent circle's purpose
- Each **role's purpose** must contribute to its circle's purpose

This cascades through the entire hierarchy, which may be many layers deep. When creating or updating purposes, ensure they align with and serve the parent's purpose.

## Work Assignment & Context in Self-Organization

In role-based self-organization, understanding where work lives is crucial:

### Work Should Live Under Roles
The goal is to do all work from a role. Each task or project should be owned by a role that has the accountability for it.

### Circles as Roles
From a super-circle's perspective, a sub-circle is just another role. Work directly under a circle (not under a role within it) is work the circle-as-a-whole does for its super-circle. How that work is internally organized is irrelevant to the super-circle.

### The \`individual-action\` Label
Sometimes work needs to be done before a role exists for it. This work is captured directly in a circle with the \`individual-action\` label:
- **Context**: The work is for this circle's purpose (not the super-circle)
- **Meaning**: Work needed for the circle but not yet assigned to a role
- **Next step**: When this work becomes structural, create a role for it

### Querying Work "In a Circle"
When someone asks for "all work in circle X", be aware of context:

**Include:**
- Work under roles within the circle: \`in:circleId label:!individual-action depth:2 completed:false\`
- Individual actions for the circle: \`in:circleId label:individual-action depth:1 completed:false\`

**Handle separately:**
- Work directly in circle WITHOUT \`individual-action\` label = work the circle does for its super-circle
- You may include this but explicitly note: "This work lives at the super-circle level"

**Example queries:**
\`\`\`
in:circleId label:individual-action depth:1 completed:false
  -> Individual actions directly in the circle (circle's own work without a role)

in:circleId label:!individual-action depth:2 completed:false
  -> Work under direct roles in the circle (depth:2 = roles + their work)

in:circleId completed:false
  -> ALL work in circle including sub-circles (may include super-circle context work)
\`\`\`

## Best Practices

1. **Start by listing workspaces** to get the workspace ID and check if it has the "anchor-circle" label
2. **Use search** to find specific items rather than browsing through hierarchies
3. **Check labels** to understand what type of nest you're working with
4. **Use @mentions** in comments to notify team members
5. **Respect the hierarchy**: nests live under parents (workspace → circle → role/project → task)
6. **Check circle strategy and purpose** before creating work or governance:
   - Fetch the parent circle to review its \`purpose\` and \`fields['circle.strategy']\`
   - Ensure new projects and tasks align with and serve the circle's strategy
   - Use strategy and purpose to prioritize work and define clear outcomes
   - When proposing governance changes, consider how they support the circle's purpose
7. **Use \`data.botContext\` to maintain AI memory** across sessions:
   - Any nest can store AI context in \`data.botContext\` (plain text) to persist learned information
   - Update via \`nestr_update_nest\` with \`{ data: { botContext: "Context: key info here..." } }\`
   - Check for existing \`data.botContext\` when working on a nest to pick up prior context
   - **Especially valuable for roles and circles**: Store information relevant to the *role*, not the person filling it (e.g., key contacts, recurring processes, domain knowledge). This context transfers automatically when the role is assigned to a different user.
   - Enables future agentic work: AI agents can autonomously energize roles, maintaining continuity as they learn preferences, make decisions, and accumulate role-specific knowledge over time

## Autonomous Work

When asked to do work autonomously, follow these practices to ensure work is properly captured, tracked, and documented in Nestr:

### Setting Up Work

1. **Find the appropriate role** for the work:
   - Identify which role has accountability for this type of work
   - Check who fills that role (the \`users\` array on the role)
   - **If the current user fills the role**: Proceed with creating the project under that role
   - **If the current user does NOT fill the role**:
     - Inform the user who fills the role
     - Ask if they still want to create the project under that role
     - If yes, create the project and add a comment (post) asking the role filler if they accept this project in their role
     - Example comment: "@rolefiller - [Username] is proposing this project for your role. Do you accept this work?"

2. **Create a project** under the role:
   - Title in past tense describing what "done" looks like (e.g., "API integration completed", "User onboarding flow redesigned")
   - Set \`labels: ["project"]\` and \`fields: { "project.status": "Current" }\`
   - Use \`purpose\` to describe the Definition of Done (DoD) with clear acceptance criteria
   - Assign to the role filler (not necessarily the requesting user)

3. **If a project is already provided**, review and enhance it:
   - Check if the description has clear DoD criteria
   - If not, **append** to the description (don't overwrite) with suggested criteria
   - Suggest a clearer DoD to the user if needed

4. **Break down into tasks** under the project:
   - Create individual tasks (nests without labels) for discrete pieces of work
   - Use \`description\` for additional context, acceptance criteria, or notes
   - Keep tasks small enough to complete in one sitting

### While Working

5. **Document progress as comments** (\`nestr_add_comment\`):
   - Post updates to individual tasks as you work on them
   - Post summaries or milestone updates to the project itself
   - Capture relevant questions you asked the user and their answers
   - Note: Comments on a task automatically appear on the parent project, so don't double-post

6. **Mark tasks complete** as you finish them:
   - Use \`nestr_update_nest\` with \`completed: true\`
   - Add a final comment summarizing what was done if helpful

### Example Flow

\`\`\`
User: "Can you refactor our authentication module to use JWT?"

1. Search for relevant role (e.g., Developer role in Tech circle)
2. Create project: "Authentication module refactored to JWT"
   - Purpose: "Replace session-based auth with JWT tokens. DoD: All endpoints use JWT, tests pass, documentation updated."
   - Parent: Developer role
   - Assign to user
3. Create tasks:
   - "Research JWT library options"
   - "Update auth middleware"
   - "Migrate existing sessions"
   - "Update API documentation"
   - "Add/update tests"
4. Work through tasks, posting findings as comments
5. Mark each task complete as finished
6. Post final summary to project when all done
\`\`\`

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

**Work Tracking:**
- \`project\` - An outcome requiring multiple steps to complete. Define in past tense as what "done" looks like (e.g., "Website redesign launched", "Q1 report published"). Has status: Future/Current/Waiting/Done.
- *(no label)* - A nest without labels is a todo/action: a single, concrete action that can be done in one sitting (e.g., "Call supplier about pricing", "Draft intro paragraph"). The next physical step to move something forward.
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
- \`type:comment\` - Search comments/posts
- \`deleted:true\` - Include deleted items

### Sorting Results

Use \`sort:\` to specify the sort field and \`sort-order:\` to set direction.

**Sort fields:**
- \`sort:searchOrder\` - Manual/custom ordering (default for work items like tasks, projects)
- \`sort:title\` - Alphabetical by title (default for roles, circles)
- \`sort:createdAt\` - By creation date
- \`sort:updatedAt\` - By last update date
- \`sort:due\` - By due date
- \`sort:completedAt\` - By completion date

**Sort order:**
- \`sort-order:asc\` - Ascending (default)
- \`sort-order:desc\` - Descending

**Defaults:**
- Roles and circles: \`sort:title\` (alphabetical)
- Work items (tasks, projects): \`sort:searchOrder\` (manual ordering set by users)

**Examples:**
\`\`\`
label:project sort:due sort-order:asc
  -> Projects ordered by due date (soonest first)

label:role sort:title
  -> Roles alphabetically (this is the default)

assignee:me completed:false sort:updatedAt sort-order:desc
  -> My active work, most recently touched first

label:project completed:this_month sort:completedAt sort-order:desc
  -> Recently completed projects
\`\`\`

### Scoping Search to a Specific Nest

Use \`in:nestId\` to limit search results to only items within a specific nest (its descendants at any depth).

**Combine with \`depth:\` to control how deep to search:**
- \`depth:1\` - Direct children only
- \`depth:2\` - Children and grandchildren
- \`depth:N\` - Up to N levels deep

**Examples:**
\`\`\`
in:circleId label:role depth:1
  -> Roles directly in a circle (excludes roles in sub-circles)

in:circleId label:project depth:2
  -> Projects in circle + under direct roles + under direct sub-circles

in:circleId label:role
  -> ALL roles in circle including those in nested sub-circles

in:projectId completed:false
  -> Incomplete tasks within a specific project

in:roleId label:project project->status:Current
  -> Current projects owned by a specific role
\`\`\`

**Common patterns:**
- Roles in a circle only (not sub-circles): \`in:circleId label:role depth:1\`
- All work in a circle: \`in:circleId completed:false\` (includes all nested items)
- Direct tasks under a project: \`in:projectId depth:1 completed:false\`

### Filtering by Completion Status

**Important:** When fetching work items (tasks, projects), always use \`completed:false\` unless you specifically need completed items. This avoids cluttering results with old completed work.

The \`completed:\` operator accepts:
- \`completed:false\` - Only uncompleted items (recommended default for work queries)
- \`completed:true\` - Only completed items
- Presets: \`completed:past_7_days\`, \`completed:this_month\`, \`completed:last_quarter\`, etc.
- Custom date range: \`completed:2024-01-01_2024-03-31\` (format: \`YYYY-MM-DD_YYYY-MM-DD\`)

**Examples:**
\`\`\`
assignee:me completed:false
  -> My active/uncompleted work (recommended)

label:project completed:false project->status:Current
  -> Active projects that are in progress

completed:past_7_days
  -> Items completed in the last week (for reviews/reports)

label:project completed:this_quarter
  -> Projects completed this quarter
\`\`\`

### Finding Recently Updated Items

Use \`updated-date:\` to find items modified within a time period. Useful for finding recent activity or stale items.

**Important:** This uses \`treeUpdatedAt\`, which updates when the nest itself OR any of its descendants (children, grandchildren, etc.) are modified. For example, a project will match \`updated-date:past_7_days\` if any task under it was updated, even if the project itself wasn't touched.

**Preset values:**
- \`updated-date:past_7_days\` - Last 7 days
- \`updated-date:past_30_days\` - Last 30 days
- \`updated-date:past_12_months\` - Last 12 months
- \`updated-date:this_month\` - This calendar month
- \`updated-date:last_month\` - Last calendar month
- \`updated-date:this_quarter\` - This quarter
- \`updated-date:last_quarter\` - Last quarter
- \`updated-date:this_year\` - This calendar year
- \`updated-date:last_year\` - Last calendar year

**Custom date range:** \`updated-date:2024-01-01_2024-03-31\` (format: \`YYYY-MM-DD_YYYY-MM-DD\`)

**Invert with \`!\`:** \`updated-date:!past_30_days\` finds items NOT updated recently (stale items)

**Examples:**
\`\`\`
label:project updated-date:past_7_days
  -> Projects updated this week

assignee:me updated-date:!past_30_days
  -> My stale tasks (no activity in 30+ days)

label:role updated-date:this_quarter
  -> Roles with governance changes this quarter
\`\`\`

## Linking to the Web App

When sharing results with users, provide clickable links to the Nestr web app.

**Base URL:** \`https://app.nestr.io\`

### Link Formats

| Format | Example | Use Case |
|--------|---------|----------|
| \`/n/{nestId}\` | \`/n/abc123\` | Direct link to any nest |
| \`/n/{nestId}/{childId}\` | \`/n/circleId/roleId\` | Show child in context (opens detail pane on desktop) |
| \`/n/{workspaceId}?s=1#hash\` | \`/n/wsId?s=1#users\` | Workspace admin settings |

### Context Links (Detail Pane)

Use the two-ID format to show items in context:
- \`/n/{circleId}/{roleId}\` - Role within its circle
- \`/n/{roleId}/{projectId}\` - Project owned by a role
- \`/n/{projectId}/{taskId}\` - Task within its project

### Cross-Workspace Views

These pages show items across all workspaces for the current user:
- \`/roles\` - All roles this user fills
- \`/projects\` - All projects assigned to this user

### User Profile

View a user's roles within a specific workspace:
- \`/profile/{userId}?cId={workspaceId}\` - User's roles in that workspace

This works for viewing colleagues too - replace userId to see what roles they fill in the same workspace.

### Admin Settings Hashes

For workspace admins, link to settings with \`/n/{workspaceId}?s=1\` plus:
- \`#users\` - Team members
- \`#labels\` - Label configuration
- \`#workspace-apps\` - Enabled apps/features
- \`#plan\` - Subscription plan

## Inbox (Quick Capture)

The inbox is a collection point for capturing "stuff" that still needs processing. Use it for:
- Quick capture of thoughts, ideas, or tasks without deciding where they belong
- Collecting items that need clarification before becoming projects or actions
- Temporary holding area before organizing into the proper location

**Note:** Inbox tools require OAuth authentication (user-scoped token). They won't work with workspace API keys.

### Inbox Workflow

1. **Capture**: Use \`nestr_create_inbox_item\` to quickly add items without organizing
2. **Review**: Use \`nestr_list_inbox\` to see items needing processing
3. **Process**: For each item, decide:
   - **Delete**: If not needed, mark \`completed: true\`
   - **Do it**: If quick (<2 min), do it now and mark complete
   - **Organize**: Move to appropriate location with \`nestr_update_nest\` by setting \`parentId\`

### Moving Items Out of Inbox

To clarify/organize an inbox item, use \`nestr_update_nest\` to change its \`parentId\`:

\`\`\`json
{
  "nestId": "inboxItemId",
  "parentId": "projectOrRoleId"
}
\`\`\`

This moves the item from inbox to the specified project, role, or other location. A nest without any labels is the basic building block - it's completable and acts as a todo/action item.

## Common Workflows

- **Task Management**: Create nests (no label needed for basic todos), update completed status, add comments for updates
- **Project Tracking**: List projects, get children to see tasks, check insights for metrics
- **Team Structure**: List circles to see teams, get roles to understand accountabilities and domains
- **Finding Accountabilities/Domains**: Use \`nestr_get_circle_roles\` for a circle's roles with their accountabilities, or \`nestr_get_nest_children\` on a specific role
- **Search & Discovery**: Use search with operators like \`label:role\` or \`assignee:me completed:false\`
- **Quick Capture**: Use inbox tools to capture thoughts without organizing, then process later
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
