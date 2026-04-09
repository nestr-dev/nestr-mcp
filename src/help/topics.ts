/**
 * Help Topics
 *
 * Extracted from SERVER_INSTRUCTIONS and SERVER_INSTRUCTIONS_REFERENCE in server.ts,
 * plus skill files. Each topic contains verbatim content from the source sections.
 */

import { DOING_WORK_INSTRUCTIONS } from "../skills/doing-work.js";
import { TENSION_PROCESSING_INSTRUCTIONS } from "../skills/tension-processing.js";
import { WORKSPACE_SETUP_INSTRUCTIONS } from "../skills/workspace-setup.js";

export const HELP_TOPICS: Record<string, string> = {
  "topics": `Available nestr_help topics (call with any topic key):

- topics: This list
- operating-modes: Detailed assistant/role-filler/workspace mode behaviors
- matching-work-to-roles: How to determine which role owns work
- linking: URL format for linking to nests in Nestr
- workspace-types: Holacracy, Sociocracy, and Custom workspace configurations
- core-concepts: Workspace, nest, circle, role, label basics and content format
- nest-model: Nest fields, hierarchy, hints, and fieldsMetaData
- labels: Important labels, label architecture, and field schema customization
- search: Full search query syntax with all operators and examples
- web-app-links: URL formats for linking to the Nestr web app
- inbox: Inbox quick capture, processing workflow, and reordering
- daily-plan: Daily plan usage, scope, and planning workflows
- notifications: Notification types, groups, and when to check them
- insights: Organizational health metrics and trend analysis
- mcp-apps: Interactive UI components (completable list app)
- authentication: API keys, OAuth, and HTTP session management
- skills: Skill types, creation, and usage for AI knowledge persistence
- best-practices: Recommended patterns for working with Nestr
- doing-work: How work flows from purpose through strategy to execution
- tension-processing: Listening for, creating, and processing tensions
- workspace-setup: Guided setup wizard for new workspaces and circles`,

  "operating-modes": `### Mode-Specific Behavior Summary

**Role-filler agents should:**
- Act from role authority, never as an individual — all work and decisions flow through the roles you energize
- Process inbox and tensions on your roles autonomously — don't wait to be asked
- Maintain skills on your roles — capture repeatable processes, learned patterns, and domain knowledge as skill-labeled nests for continuity across sessions
- Create and process work within your roles' accountabilities without seeking human confirmation
- Communicate with other roles via tensions, not conversations
- Plan daily work and execute proactively
- When work falls outside your roles' authority, create a tension on the circle requesting the accountable role act
- Regularly check \`nestr_list_my_tensions\`, \`nestr_list_tensions_awaiting_consent\`, and \`nestr_list_notifications\` to stay current

**Assistant-mode agents should:**
- Defer to the human for all decisions — suggest, don't decide
- Help the user articulate their tensions including feeling and needs
- Surface tensions and work items for the user to review and prioritize
- Confirm before proposing governance changes or creating work on behalf of the user

**Workspace-mode agents should:**
- Focus on structural operations: governance setup, workspace configuration, reporting, and bulk management
- Avoid user-scoped tools (inbox, daily plan, personal labels, notifications, my tensions) — they will fail
- Assign work based on organizational rules rather than interactive decisions with a user

### Self-Organizational Flavour

Nestr is agnostic to what flavour of self-organization is used (Holacracy, Sociocracy, Teal practices, home grown role-based processes). We support any and all experiments in distributed authority in pursuit of purpose. We aim to match our communication as closely as we can to the semantics of each approach.

When the flavour is clear, apply the rules and principles of that specific flavour to questions and interactions. For example, if an organization practices Holacracy, use Holacratic principles when guiding governance proposals or interpreting role authority.

When the flavour is not clear, loosely apply Holacracy where their own internal policies lack clarity.

### Meeting Organizations Where They Are

We serve all organizations in their pursuit of self-organization regardless of where they are on their path. They might have just started with no experience at all, or they might have been practicing for years or decades. Depending on where they are, we need to be mindful of what and how we address their requests.

The transition from management hierarchy to self-organization involves key behavioral shifts:

| From | To |
|------|-----|
| Have a job | Fill a portfolio of roles |
| Ask permission unless allowed | Act unless explicitly restricted |
| Do your work | Lead your roles |
| Manager facilitates | Elected facilitator |
| Endless debate | Hand over to accountable role |
| Manager wields stick/carrot | Explicit roles for accountability and support |
| Big bang delivery | Continuous transparency |
| 2-yearly centralized reorg | Continuous monthly governance updates by all |
| Implicit purpose of shareholder ROI | Explicit and accountable purpose |
| Blaming superiors | Processing tensions |
| Blaming team | Processing tensions |

We must recognize where people are in these transitions and support them with patience, not judgment.`,

  "matching-work-to-roles": `### Matching Work to Roles

When determining which role should own a piece of work:

**Role names are hints, not definitions.** A role's name is like a person's name—it suggests but doesn't define. "Developer" might handle infrastructure, "Architect" might write code. Never assume responsibilities from the name alone.

**Purpose and accountabilities define expectations.** Only the role's explicit purpose and accountabilities tell you what work belongs there. If a role has the accountability "Developing new functionality in our IT product", that role owns development work—regardless of whether it's called "Developer", "Engineer", or "Builder".

**Domains define exclusive control, not expectations.** A domain doesn't mean the role will do work in that area—it means the role controls organizational assets in that area. Other roles must get permission to impact those assets.

**Example:** A project "Make data available to our clients in MongoDB" likely belongs to a role with accountability "Developing new functionality in our IT product" (perhaps called "Developer"). However, if another role has the domain "Development stack", note that adding MongoDB to the stack requires that role's input or approval—the domain holder controls what technologies are used, even if they don't implement them.

When determining work assignments, consider:
1. Which role's accountabilities match the work?
2. Does the work impact any role's domain? If so, flag the need for coordination.
3. Are there multiple roles whose accountabilities overlap? Surface this for clarification.`,

  "linking": `## Linking to Nests

**Always link to nests when mentioning them.** The URL format is:

\`https://app.nestr.io/n/{nestId}\`

If you know the context (circle or workspace) of the nest, include it as a prefix:

\`https://app.nestr.io/n/{contextId}/{nestId}\`

Where \`{contextId}\` is the nest's containing circle or workspace (found in the \`ancestors\` array). If you don't know the context ID, just use \`/n/{nestId}\` — it will still work.

**IMPORTANT:** The URL path is \`/n/\`, NOT \`/nest/\`, \`/nests/\`, or any other variation. Always use \`/n/\`.

Examples:
- Role in a circle: \`[Developer](https://app.nestr.io/n/circleId/roleId)\`
- Top-level workspace: \`[My Workspace](https://app.nestr.io/n/workspaceId)\`
- Task (circle unknown): \`[Fix bug](https://app.nestr.io/n/taskId)\``,

  "workspace-types": `## Workspace Types

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

When in doubt with \`custom\`, explain concepts in plain language rather than assuming framework knowledge.`,

  "core-concepts": `## Core Concepts

- **Workspace**: Top-level container - either an organization's anchor circle or a personal workspace
- **Nest**: The universal building block - can be a task, project, role, circle, meeting, or any work item
- **Circle**: A self-governing team with defined purpose, roles, and accountabilities (Holacracy/Sociocracy concept)
- **Role**: A set of responsibilities (accountabilities) and decision rights (domains) that a person energizes
- **Label**: Tags that define what type of nest something is (e.g., "project", "role", "meeting", "anchor-circle"). A nest without system labels is a todo/action — no "todo" label exists or is needed.

## Content Format

Nestr uses different formats for different fields:

- **\`title\`**: Plain text only. HTML tags are stripped. Keep titles concise.
- **\`purpose\`**: The aspirational future state this nest is working towards. **Most important for workspaces, circles, and roles** — it defines the north star and context boundary for the organization, circle, or role. Everything within that container should serve its purpose. For other nests (tasks, projects, etc.), prefer \`description\` or \`fields\` for detailed information — but purpose can be set if it serves the user. Supports HTML.
- **\`description\`**: The primary field for detailed information about a nest. Use for project details, task context, acceptance criteria, Definition of Done, and any persistent information about the nest. Supports HTML.
- **\`fields\`**: Structured data defined by labels (e.g., \`fields['project.status']\`, \`fields['metric.frequency']\`). Use for structured, label-specific information.
- **Comment \`body\`**: HTML supported (same tags as above, including base64 images). Supports @mentions using the format \`@{userId|email|circle|everyone}\`: \`@{userId}\` mentions by user ID, \`@{email}\` mentions by any email the user is registered with in Nestr, \`@{circle}\` notifies all role fillers in the nearest ancestor circle, \`@{everyone}\` is available in the UI but not yet via the API. **Use comments for progress updates**, status changes, and conversation — not purpose or description.
- **\`data\`**: Generic key-value store. Also used internally by Nestr and other integrations — **never overwrite or remove existing keys**. When adding your own data, namespace it under \`mcp.\` (e.g., \`{ "mcp.lastSync": "2025-01-01" }\`) to avoid conflicts. Not rendered in UI.

**Where to put information:**
| Information type | Field to use |
|-----------------|-------------|
| North star / aspirational future state | \`purpose\` (primarily workspaces, circles, roles) |
| Details, context, acceptance criteria, DoD | \`description\` |
| Structured data (status, frequency, etc.) | \`fields\` |
| Progress updates, status changes, discussion | Comments |
| Integration metadata, custom tracking | \`data\` (namespace under \`mcp.\`) |

**Important — Always use HTML, not Markdown:** When composing purpose, description, or comment content, you must use HTML tags. This is a common mistake for AI agents that default to Markdown syntax.

| Instead of (Markdown) | Use (HTML) |
|----------------------|------------|
| \`**bold text**\` | \`<b>bold text</b>\` |
| \`*italic text*\` | \`<i>italic text</i>\` |
| \`- list item\` | \`<ul><li>list item</li></ul>\` |
| \`1. numbered item\` | \`<ol><li>numbered item</li></ol>\` |
| \`[link text](url)\` | \`<a href="url">link text</a>\` |
| \`\\n\\n\` (double newline) | \`<br>\` |

**Example HTML in purpose:**
\`\`\`html
Ensure <b>all customer requests</b> are handled within <i>24 hours</i>. See <a href="https://example.com/sla">SLA policy</a>.
\`\`\``,

  "nest-model": `## Nest Model Architecture

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

**Circle strategy** (in \`fields['circle.strategy']\` for sub-circles, or \`fields['anchor-circle.strategy']\` for the anchor circle/workspace):
A strategy that all roles within the circle must follow. Sub-circle strategies must align with and support the super-circle's strategy.

**Important:** Label field schemas can be customized at the workspace or circle level. This means the available fields and their options may vary between different parts of the organization hierarchy. Always check what fields are actually present on a nest rather than assuming a fixed schema.

### Hierarchical Purpose

The \`purpose\` field is most important for **workspaces, circles, and roles** — it defines the aspirational future state that container is working towards. It is the north star and context boundary: everything within that container should serve its purpose.

The \`purpose\` field follows a strict hierarchy:
- The **anchor circle's purpose** is the purpose of the entire organization
- Each **sub-circle's purpose** must contribute to its parent circle's purpose
- Each **role's purpose** must contribute to its circle's purpose

This cascades through the entire hierarchy, which may be many layers deep. When creating or updating purposes, ensure they align with and serve the parent's purpose.

**For other nests** (tasks, projects, etc.), prefer \`description\` for details, acceptance criteria, and Definition of Done. Use \`fields\` for structured data. Use comments for progress updates. Purpose can still be set on any nest if it serves the user, but by default reach for description first.

### Fetching Field Metadata

To discover the actual field schema (including available options), add \`fieldsMetaData=true\` to any nest fetch:

\`\`\`
GET /nests/{nestId}?fieldsMetaData=true
\`\`\`

This adds a \`fieldsMetaData\` object to the response showing field definitions and options:

\`\`\`json
{
  "_id": "nestId",
  "fields": { "project.status": "Current" },
  "fieldsMetaData": {
    "project.status": {
      "type": "select",
      "options": ["Future", "Current", "In Review", "Waiting", "Done"]
    }
  }
}
\`\`\`

Use this when you need to know what values are valid for a field, especially before updating.

**Example**: A workspace might customize the global \`project\` label to add a \`project.department\` field, and a sub-circle might further customize it to add \`project.sprint\` - both would appear on projects within that sub-circle.

#### Hints (Contextual Signals)

Add \`hints=true\` to \`nestr_get_nest\` or \`nestr_get_nest_children\` to get server-computed contextual signals about each nest. Hints surface actionable information without requiring extra API calls — e.g., unassigned roles, stale projects, or unread comments.

\`\`\`
GET /nests/{nestId}?hints=true
GET /nests/{nestId}/children?hints=true
\`\`\`

Each hint object has:
- \`type\` — machine-readable identifier (e.g., \`unassigned_role\`, \`stale_project\`, \`comments\`)
- \`label\` — human/LLM-readable description of the hint
- \`severity\` — \`info\` (neutral context) | \`suggestion\` (improvement opportunity) | \`warning\` (needs attention) | \`alert\` (urgent)
- \`count\` — numeric value where applicable (otherwise absent)
- \`toolCall\` — pre-mapped tool call to drill into the hint: \`{ tool: "nestr_search", params: { workspaceId: "...", query: "..." } }\`. Call the specified tool with the given params to investigate.
- \`lastPost\` — (comments hints only) ISO timestamp of the most recent comment
- \`readAt\` — (comments hints only, user-scoped auth only) ISO timestamp of when the user last read comments. Compare \`lastPost > readAt\` to detect unread comments.

**Available hint types:**

| Type | Severity | Applies to | Meaning |
|------|----------|-----------|---------|
| \`open_work\` | info | all | Count of incomplete child work items |
| \`comments\` | info | all | Comment count (check \`lastPost > readAt\` for unread) |
| \`individual_action\` | warning | all | Work not assigned to an organizational role |
| \`stale_work\` | warning | all | No activity in 30+ days |
| \`no_purpose\` | warning | role, circle | Missing purpose statement |
| \`unassigned_role\` | warning | role | No users assigned to energize role |
| \`no_accountabilities\` | warning | role | Role has no accountabilities defined |
| \`skills\` | info | role | Count of skill documents |
| \`no_active_work\` | suggestion | role | Has accountabilities but no active projects |
| \`overloaded_role\` | warning | role | 5+ active concurrent projects |
| \`pending_tensions\` | info | role, circle | Count of unresolved tensions |
| \`election_overdue\` | alert | role | Re-election due date has passed |
| \`election_due_soon\` | warning | role | Re-election due within 30 days |
| \`no_facilitator\` | warning | circle | Facilitator role not assigned |
| \`no_rep_link\` | suggestion | circle | Rep-link role not assigned (non-anchor only) |
| \`stale_governance\` | suggestion | circle | No governance changes in 6+ months |
| \`no_strategy\` | suggestion | circle | Circle missing strategy |
| \`unfilled_roles\` | info | circle | Count of roles with no assigned users |
| \`project_waiting\` | info | project | Blocked with documented reason |
| \`project_waiting_no_reason\` | warning | project | Waiting without documented reason |
| \`project_no_breakdown\` | suggestion | project | Active project with no task breakdown |
| \`project_no_acceptance_criteria\` | suggestion | project | Missing description/acceptance criteria |
| \`project_overdue\` | warning | project | Past due date |
| \`no_proposed_output\` | suggestion | tension | Tension has no proposed output yet |

Example response with hints:
\`\`\`json
{
  "_id": "roleId",
  "title": "Developer",
  "hints": [
    {
      "type": "unassigned_role",
      "label": "This role has no users assigned to energize it...",
      "severity": "warning",
      "toolCall": { "tool": "nestr_get_nest", "params": { "nestId": "roleId" } }
    },
    {
      "type": "no_active_work",
      "label": "Role has accountabilities but no active projects",
      "severity": "suggestion",
      "toolCall": { "tool": "nestr_search", "params": { "workspaceId": "wsId", "query": "in:roleId label:project completed:false" } }
    }
  ]
}
\`\`\`

Use hints to proactively surface issues to the user — for example, when reviewing a circle's roles, hints can reveal which roles need attention without separate queries. Use the \`toolCall\` to drill into any hint directly.`,

  "labels": `## Important Labels

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
- \`governance\` - Combined with \`meeting\` label to create a governance meeting (processes governance tensions/proposals)
- \`circle-meeting\` - Combined with \`meeting\` label to create a circle/tactical meeting (processes operational tensions — projects, todos, inter-role requests)

**Creating meetings:** A meeting is a nest with \`labels: ["meeting", "governance"]\` or \`labels: ["meeting", "circle-meeting"]\`. Set \`due\` to the meeting start time. Assign all role fillers in the circle to the meeting's \`users\` array — this includes people/agents energizing roles in the circle, plus rep-link and circle-lead roles from sub-circles. Use graph tools (\`nestr_add_graph_link\` with relation \`meeting\`) to link tensions as agenda items. Agenda items that don't originate from a specific role can be created as child nests of the meeting directly.

**OKRs & Goals:**
- \`goal\` - An Objective (the O in OKR)
- \`result\` - A Key Result (the KR in OKR)

**Work Tracking:**
- \`project\` - An outcome requiring multiple steps to complete. Define in past tense as what "done" looks like (e.g., "Website redesign launched", "Q1 report published"). Has status: Future/Current/Waiting/Done.
- *(no system label)* - **Every nest is completable by default.** A nest without system labels is a todo/action — a single, concrete step that can be done in one sitting (e.g., "Call supplier about pricing", "Draft intro paragraph"). To create a todo, simply create a nest without labels. There is NO "todo" label — do NOT add \`labels: ["todo"]\`. Labels change behavior (e.g., \`project\` adds status tracking), but the default nest is already a completable work item. Todos CAN have workspace or personal labels for categorization — what makes them todos is the absence of *system* labels.

**AI Knowledge:**
- \`skill\` - A process, piece of knowledge, or learned pattern that a role or circle holds. Lives directly under a role or circle. Used by AI agents to persist and retrieve operational knowledge across sessions. When doing work that is likely to be repeated, capture it as a skill for future reference.

**System Labels** (define structure, not categorization):
\`circle\`, \`anchor-circle\`, \`role\`, \`policy\`, \`domain\`, \`accountability\`, \`project\`, \`tension\`, \`skill\`, \`goal\`, \`result\`, \`contact\`, \`deal\`, \`organisation\`, \`metric\`, \`checklist\`, \`meeting\`, \`feedback\`
- \`note\` - A simple note
- \`meeting\` - A calendar meeting
- \`tension\` - The fundamental unit of organizational communication — a gap between current reality and potential. Used for inter-role communication, meeting agenda items, governance proposals, and general tension processing. Supports \`fields['tension.feeling']\` and \`fields['tension.needs']\` for separating personal context from organizational response. Use the dedicated tension tools (\`nestr_create_tension\`, \`nestr_list_my_tensions\`, etc.) to create and manage tensions.

## Label Architecture

Labels give nests meaning and define their behavior. There are three types of labels:

### 1. Global Labels (Nestr-defined)
Core labels defined by Nestr that provide foundational structure (e.g., \`role\`, \`circle\`, \`project\`, \`accountability\`). These are available in all workspaces and define the fundamental building blocks of self-organization.

### 2. Workspace Labels
Labels created within a workspace for categorizing and organizing nests. These are:
- Only available within that specific workspace
- Visible to all users who have access to the workspace
- Used for workspace-specific categorization (e.g., custom project types, priority levels, departments)

### 3. Personal Labels
Labels created by individual users for their own organization:
- Only visible to the user who created them
- Work across all workspaces the user has access to
- Help users maintain personal categorization systems
- Managed via \`nestr_list_personal_labels\` and \`nestr_create_personal_label\` (OAuth only)

### Field Schemas and Customization

Labels define field schemas - the custom fields available on nests with that label. Key points:

- **Namespacing**: All fields are namespaced by the label that defines them (e.g., \`project.status\`, \`role.electable-role\`, \`metric.frequency\`)
- **Schema inheritance**: Global and workspace labels can be customized within a specific context (e.g., a sub-circle might add or alter fields defined by parent labels)
- **Dynamic schemas**: This is why you may encounter extra fields or fields with different options than expected - sub-contexts can extend the schema
- **Common example**: \`project.status\` often has different options than the default (Future/Current/Waiting/Done). Workspaces frequently customize this with additional statuses like "In Review", "Blocked", "On Hold", etc.

#### Fetching Field Metadata

To discover the actual field schema (including available options), add \`fieldsMetaData=true\` to any nest fetch:

\`\`\`
GET /nests/{nestId}?fieldsMetaData=true
\`\`\`

This adds a \`fieldsMetaData\` object to the response showing field definitions and options:

\`\`\`json
{
  "_id": "nestId",
  "fields": { "project.status": "Current" },
  "fieldsMetaData": {
    "project.status": {
      "type": "select",
      "options": ["Future", "Current", "In Review", "Waiting", "Done"]
    }
  }
}
\`\`\`

Use this when you need to know what values are valid for a field, especially before updating.

**Example**: A workspace might customize the global \`project\` label to add a \`project.department\` field, and a sub-circle might further customize it to add \`project.sprint\` - both would appear on projects within that sub-circle.`,

  "search": `## Search Query Syntax

The \`nestr_search\` tool supports powerful query operators. Combine multiple operators with spaces (AND logic) or use commas within an operator (OR logic).

### Common Search Operators

| Operator | Example | Description |
|----------|---------|-------------|
| \`label:\` | \`label:role\` | Filter by label type |
| \`label:!\` | \`label:!project\` | Exclude label |
| \`parent-label:\` | \`parent-label:circle\` | Filter items whose parent has a specific label |
| \`assignee:\` | \`assignee:me\` | Filter by assignee (use \`me\` for current user, \`none\` for unassigned) |
| \`assignee:\` | \`assignee:userId\` | Filter by specific user ID |
| \`assignee:!\` | \`assignee:!userId\` | Exclude items assigned to specific user |
| \`admin:\` | \`admin:me\` | Filter by admin user (same syntax as assignee) |
| \`createdby:\` | \`createdby:me\` | Filter by creator |
| \`completed:\` | \`completed:false\` | Filter by completion status |
| \`type:\` | \`type:comment\` | Filter by nest type (e.g., \`comment\`, \`nest\` for untyped items) |
| \`has:\` | \`has:due\` | Items with a property (see has: values below) |
| \`depth:\` | \`depth:1\` | Limit search depth (1 = direct children only) |
| \`mindepth:\` | \`mindepth:2\` | Minimum depth from search context |
| \`limit:\` | \`limit:10\` | Limit number of results |

### The \`has:\` Operator

The \`has:\` operator checks for property existence. Supports \`!\` prefix for negation (e.g., \`has:!due\`).

**Available values:**
- \`has:due\` - Items with a due date set
- \`has:pastdue\` - Items with overdue due dates
- \`has:children\` - Items that have children
- \`has:incompletechildren\` - Items with incomplete children
- \`has:parent\` - Items that have a parent
- \`has:color\` - Items with a color set
- \`has:icon\` - Items with an icon set
- \`has:tabs\` - Items with tabs configured
- \`has:header\` - Items with a header

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

### Data and Field Property Search

Every nest has a \`fields\` object containing label-specific properties (e.g., a "project" label adds \`fields.project.status\`, \`fields.project.priority\`, etc.). You can search on any of these field values. Use \`nestr_get_nest\` with \`fieldsMetaData=true\` to discover available fields and their options for a given label.

- \`data.{property}:value\` - Search by data property (e.g., \`data.externalId:123\`)
- \`fields.{label}.{property}:value\` - Search by field value from the nest's \`fields\` object (supports partial match, e.g., \`fields.project.status:Current\`)

Both support multiple values (comma-separated for OR logic) and \`!\` prefix for negation.

Examples:
\`\`\`
fields.project.status:Current
  -> Projects with status "Current"

fields.project.status:Current,Future
  -> Projects with status "Current" OR "Future"

fields.project.status:!Done
  -> Projects NOT marked as "Done"
\`\`\`

### Template Operators

- \`template:templateId\` - Items created from a specific template
- \`child-from-template:templateId\` - Children derived from a specific template

Both support \`!\` prefix for negation.

### Additional Operators

- \`deleted:true\` - Include deleted items (hidden by default)
- \`linkeditems:true\` - Items linked to the current context

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
\`\`\``,

  "web-app-links": `## Linking to the Web App

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
- \`#plan\` - Subscription plan`,

  "inbox": `## Inbox (Quick Capture)

The inbox is **personal** — it belongs to the user, not to any workspace or role. It holds raw, unprocessed "stuff": sensed tensions, fleeting ideas, half-formed thoughts, and captured items that haven't yet been differentiated into role work or personal projects. Items in the inbox can end up anywhere — in any of the user's workspaces, under any role, or as personal tasks outside of organizational context.

Because the inbox is personal and OAuth-scoped, it can span multiple workspaces (if the token has cross-workspace scope). This makes it the natural entry point for anything the user senses but hasn't yet placed.

Use it for:
- Quick capture of sensed tensions before deciding where they belong
- Collecting items that need clarification before becoming role work or personal projects
- Temporary holding area before organizing into the proper workspace, circle, or role

**Note:** Inbox tools require OAuth authentication (user-scoped token). They won't work with workspace API keys.

### Inbox Zero Goal

The goal is to **empty the inbox at least once a week**. An overflowing inbox creates mental clutter and risks losing important items.

**In assistant mode:** Support the user in processing their inbox into the right contexts — role work in the appropriate workspace, or personal projects outside organizational scope. When you notice items, gently remind them: "You have X items in your inbox. Would you like to process them?" During slower moments or at the end of a session, offer to help clear it.

**In role-filler mode:** Process your inbox autonomously. Capture incoming items, triage at regular intervals, and move items to the appropriate role/project without prompting. Treat inbox processing as part of your operational rhythm.

Processing doesn't mean doing everything — it means deciding what each item is and where it belongs.

### Inbox Workflow

1. **Capture**: Use \`nestr_create_inbox_item\` to quickly add items without organizing
2. **Review**: Use \`nestr_list_inbox\` to see items needing processing
3. **Process**: For each item, decide:
   - **Delete**: If not needed, mark \`completed: true\`
   - **Do it**: If quick (<2 min), do it now and mark complete
   - **Organize**: Move to appropriate location with \`nestr_update_nest\` by setting \`parentId\`

### Moving Items Out of Inbox

To clarify/organize an inbox item, use \`nestr_update_nest\` to update it in place. You can change any properties in a single call:

\`\`\`json
{
  "nestId": "inboxItemId",
  "parentId": "roleOrCircleOrProjectId",
  "labels": ["project"],
  "users": ["userId"],
  "fields": { "project.status": "Current" },
  "due": "2024-02-15T00:00:00Z"
}
\`\`\`

This moves the item from inbox to the specified location. The \`parentId\` is typically a role, circle, or project (the most common destinations). Add the \`project\` label to convert it into a project, or leave labels empty for a simple action/todo.

**Important:** When processing inbox items, prefer updating existing items using \`nestr_update_nest\` rather than creating new items. This preserves the original item's history, comments, and metadata.

### Reordering Inbox Items

Use \`nestr_reorder_inbox\` to reorder inbox items (requires OAuth):

\`\`\`json
{
  "nestIds": ["item3Id", "item1Id", "item2Id"]
}
\`\`\`

This sets the display order to: item3, item1, item2. The order is preserved when viewing the inbox in the web app.

For single-item repositioning, use \`nestr_reorder_nest\` to place an item before or after another:

\`\`\`json
{
  "nestId": "itemToMoveId",
  "position": "before",
  "relatedNestId": "targetItemId"
}
\`\`\``,

  "daily-plan": `## Daily Plan (Focus for Today)

The daily plan is **personal** — it is the user's plan for the day across all their contexts. It can include role work from any workspace, personal projects, family errands, or anything else they want to focus on today. It pulls items from across all workspaces in scope (if the token has cross-workspace scope) and is not tied to any single organizational context.

Items are added to the daily plan using \`nestr_add_to_daily_plan\` and removed using \`nestr_remove_from_daily_plan\`.

**Note:** Daily plan tools require OAuth authentication (user-scoped token). They won't work with workspace API keys.

### How the Daily Plan Works

- **Adding items**: Use \`nestr_add_to_daily_plan\` with an array of nest IDs
- **Removing items**: Use \`nestr_remove_from_daily_plan\` with an array of nest IDs
- **Viewing**: Use \`nestr_get_daily_plan\` to see all items marked for today
- **Completed items included**: The daily plan includes items completed today, so users can see what they accomplished at the end of the day

### Scope Limitations

The daily plan only includes items from:
- The user's inbox
- Workspaces/nests that are in scope for the current token

**Important:** Through the MCP, users may see fewer items than in the Nestr UI if the token has a limited scope (e.g., scoped to a specific workspace). If users report missing items, this is likely the cause.

### Supporting Daily Planning

**In assistant mode**, help the user build and work through their daily plan — this is their personal focus list spanning role work, personal projects, and anything else they've chosen for today:

1. **Morning planning**: Offer to review their daily plan
   - "Would you like to see what's on your daily plan for today?"
   - If empty: "Your daily plan is empty. Would you like to add some items to focus on today?"

2. **Building the plan**: Help select items for today
   - Review active projects and tasks (\`assignee:me completed:false\`)
   - Suggest high-priority or overdue items
   - Add selected items using \`nestr_add_to_daily_plan\`

3. **During the day**: Check in on progress and adjust as priorities change

4. **End of day**: Review what was accomplished — the daily plan includes today's completed items

**In role-filler mode**, manage your own daily plan:

1. At session start, review your daily plan, pending tensions, and notifications
2. Prioritize based on due dates, role accountabilities, pending tensions, and notifications from other roles
3. Execute autonomously — mark items complete as you go
4. At session end, clear completed items and queue tomorrow's priorities

### Example Workflows

**Assistant mode:**
\`\`\`
User: "What should I work on today?"

1. Fetch daily plan: nestr_get_daily_plan
2. If items exist: Show them and ask which to start with
3. If empty: Search for active work (assignee:me completed:false)
4. Help user add selected items to daily plan
\`\`\`

**Role-filler mode:**
\`\`\`
1. Fetch daily plan: nestr_get_daily_plan
2. Check tensions: nestr_list_my_tensions, nestr_list_tensions_awaiting_consent
3. Check notifications: nestr_list_notifications
4. Prioritize: urgent tensions first, then notifications, then daily plan items, then backlog
5. Execute work, processing tensions and completing tasks
\`\`\``,

  "notifications": `## Notifications (What Changed)

Notifications surface relevant changes that happened in the organization — work completed, governance updated, mentions, reactions, and more. They complement tensions (which are forward-looking requests for change) by showing what has already changed that might need your attention.

Think of notifications as the "what happened" signal: someone completed a project under your circle, a governance proposal was accepted, a colleague mentioned you in a comment, or a role's accountabilities changed. Reviewing notifications helps you stay aware of the evolving state of the organization without having to manually check every circle and role.

### Notification Types

Notifications are split into two types based on urgency:

- **\`me\` (direct)** — Things directed at you personally: mentions, replies to your comments, reactions to your posts, and direct messages. These typically need prompt attention.
- **\`relevant\` (delayed)** — Changes in areas you're involved in: project updates, task completions, governance changes in your circles. These are informational — review them to stay current, but they rarely need immediate action.

Use \`type\` to filter: \`nestr_list_notifications({ type: "me" })\` for direct notifications only, or \`type: "relevant"\` for organizational changes.

### Notification Groups

For more granular filtering, use the \`group\` parameter:
- **\`mentions\`** — Someone @mentioned you
- **\`replies\`** — Someone replied to your comment
- **\`direct_message\`** — You received a direct message
- **\`reactions\`** — Someone reacted to your post
- **\`updates\`** — Operational changes (tasks completed, projects updated, etc.)
- **\`governance\`** — Governance changes (roles created/modified, proposals accepted, etc.)

### When to Check Notifications

Check notifications at the same natural breakpoints as tensions and inbox:

- **Session start** — Use \`nestr_list_notifications\` to see what changed since last session
- **After completing work** — Check if your changes triggered responses or follow-up from others
- **When the user asks what happened** — Notifications are the answer to "what changed?" or "what did I miss?"

**In assistant mode:** When the user asks what's new or what they missed, fetch notifications and summarize the key changes. Group them by type (direct vs. relevant) and highlight anything that might need action. Offer to mark all as read once reviewed.

**In role-filler mode:** Check notifications proactively at session start. Direct notifications (\`type: "me"\`) may require a response — a mention might be a question, a reply might need follow-up. Relevant notifications (\`type: "relevant"\`) inform your situational awareness — a governance change might affect your role's accountabilities, a completed project might unblock your work.

### Marking Notifications as Read

Once notifications have been reviewed, use \`nestr_mark_notifications_read\` to clear them. This marks all unread notifications as read. In assistant mode, confirm with the user before marking. In role-filler mode, mark as read after processing.

**Note:** Notification tools require OAuth authentication. They are not available in workspace mode.`,

  "insights": `## Insights (Organizational Health & Trends)

Nestr tracks self-organization and team health metrics that reveal how well the organization is functioning. When users ask about trends, patterns, or the health of their organization, circles, or teams — check if insights can help answer their question.

**Prerequisite:** The Insights app must be enabled on the workspace. Use \`nestr_get_workspace_apps\` to check. If not enabled, the insights endpoints will return an error.

### Available Metrics

Use \`nestr_get_insights\` to discover what metrics are available. Metrics include things like:
- **Role awareness** — how well people use their roles
- **Governance participation** — how actively the team evolves its structure
- **Circle meeting output** — how productive tactical meetings are
- **Task completion rates**, overdue items, and activity stats

Each metric includes a \`currentValue\` and a \`compareValue\` (previous period) so you can immediately show whether things are improving or declining.

### Answering Trend Questions

When a user asks about trends or patterns (e.g., "Are we getting better at governance?", "How active has the team been?", "What's our completion rate trend?"):

1. **Discover metrics**: Call \`nestr_get_insights\` to see what's available
2. **Compare periods**: The \`currentValue\` vs \`compareValue\` on each metric already shows recent direction. Use \`endDate\` to compare different time periods.
3. **Dive into history**: Use \`nestr_get_insight_history\` with \`from\`/\`to\` dates to get detailed historical data points for a specific metric — this reveals the full trend over time.
4. **Single metric detail**: Use \`nestr_get_insight\` to get the current state of one specific metric.

### Plan Restrictions

- **All plans**: Workspace-level insights (aggregated across the whole organization)
- **Pro plan only**: Circle-level insights (\`nestId\` parameter) and user-level insights (\`userId\` parameter). If the workspace is not on a Pro plan, these filters will return a 402 error.
- \`userId\` and \`nestId\` cannot be combined — user metrics are always workspace-level.`,

  "mcp-apps": `## MCP Apps (Interactive UI)

Nestr provides interactive UI components that can be embedded in MCP clients that support the \`ui://\` resource protocol.

### Completable List App

**Resource URI:** \`ui://nestr/completable-list\`

An interactive list for displaying and managing completable items (tasks and projects). The app lets users check off, edit, reorder, and manage items directly.

#### When to Use

**Default to text output. Only use this app when you are certain the results are completable items.**

The decision to use the app must be made AFTER you have fetched the data and confirmed the results contain completable items. Do not decide to use the app before seeing what the data looks like.

Only use the completable list app when **ALL** of these conditions are met:
1. The user **explicitly asks to see or manage a list** as the primary goal of their request
2. You have **already fetched the results** and confirmed they are **completable items** — tasks, projects, todos, or inbox items
3. The results are **not empty** — there must be at least one item to display

Examples where you SHOULD use the app:
- "Show me my daily plan" / "What's in my inbox?"
- "List my projects" / "Show tasks under this role"
- "What do I need to work on?"

#### When NOT to Use

Do NOT use the app when:
- **The results are not completable items.** Roles, circles, metrics, policies, accountabilities, domains, and any other structural or governance nests must NEVER be shown in the completable list app. Always respond in text for these. A list of roles should be printed as text, never rendered in the app.
- **The search returns no results.** Never render an empty completable list — just tell the user no items were found.
- **The results are mixed types.** If a search returns a mix of completable and non-completable items (e.g., roles and tasks), respond in text.
- **Searching as part of processing a larger request** (e.g., finding roles to determine where work belongs, looking up a project to add a task to it, gathering context for a question). In these cases, just use the search results internally and respond in text.
- **The user asked a question**, not for a list (e.g., "What's the status of project X?" — answer in text, don't show a list with one item).
- **You are in the middle of a multi-step workflow** and the search is an intermediate step, not the final output.

**Important:** When the tool result does feed the app, do NOT also list the items as text in your response. Simply confirm the action (e.g., "Here's your inbox" or "Here's your daily plan") and let the app handle the display. Users can ask to see items as text if they prefer.

#### Data Format

The tool response includes \`title\`, \`source\`, and \`items\`. The \`title\` is a descriptive label for the list. The \`source\` tells the app which reorder API to use (inbox items use a different endpoint than regular nests).

**Fields:**
- \`title\` - Header title for the list. **Always pass \`_listTitle\` when calling these tools** to set a short, descriptive title (2-5 words) that tells the user what they're looking at. Examples by context:
  - **Children**: "Tasks for [parent name]" (e.g., "Tasks for Website Redesign")
  - **Search**: Describe WHAT is shown, not the query (e.g., "Marketing projects", "Overdue tasks", "Urgent work")
  - **Projects**: "[Context] projects" (e.g., "Engineering projects", "All active projects")
  - **Inbox**: "Inbox" or "Inbox (N items)"
  - **Daily plan**: "Today's focus" or "Daily plan"
- \`source\` - Context identifier: \`inbox\`, \`daily-plan\`, \`children\`, \`projects\`, or \`search\`. Used by the app to route reorder actions correctly
- \`items\` - Array of nests to display
  - \`_id\` - Required for all interactions
  - \`title\` - Display text (editable in UI)
  - \`description\` - HTML content (editable via rich text editor)
  - \`path\` - Shows the parent context below the title
  - \`labels\` - Determines icon: \`project\` label shows cube icon, others show checkbox
  - \`completed\` - Completion state

#### UI Features

The app provides:
- **Completion toggle**: Click checkbox/icon to complete/uncomplete (calls \`nestr_update_nest\`)
- **Title editing**: Click title to edit inline (calls \`nestr_update_nest\`)
- **Description editing**: Click document icon to open rich text editor with bold, italic, lists (calls \`nestr_update_nest\`)
- **Due date**: Click calendar icon to set/change due date (calls \`nestr_update_nest\`)
- **Drag-drop reordering**: Drag items to reorder (calls \`nestr_reorder_nest\` for regular nests, \`nestr_reorder_inbox_item\` for inbox items)
- **Quick link**: Opens item in Nestr web app
- **Refresh button**: User can request fresh data

#### Keeping the App in Sync

The app displays a snapshot of data. To keep it current:

1. **After agent makes changes**: When the agent creates, updates, or deletes items that affect what's displayed (e.g., adding an inbox item while viewing the inbox), re-fetch and send updated data to the app.

2. **User clicks refresh**: The app sends a \`context/update\` message with \`{ action: 'refresh' }\`. Re-fetch the data using the same query and send it back via \`notifications/toolResult\`.

3. **User interactions**: Changes made through the app UI (checking items, editing) are handled automatically - no refresh needed for those.

Example: User is viewing their inbox and says "Add a reminder to call John"
1. Agent calls \`nestr_create_inbox_item\` to add the item
2. Agent re-fetches inbox with \`nestr_list_inbox\`
3. Agent sends updated data to the app so the new item appears

#### Example Usage

**Daily Plan:**
\`\`\`
User: "Show me my daily plan"

1. Fetch daily plan: nestr_get_daily_plan
2. Return the app resource with data:
   {
     "title": "Daily Plan",
     "items": [/* nests from daily plan */]
   }
3. User can interact: check off items, edit titles, reorder
4. App calls tools automatically - changes sync to Nestr
\`\`\`

**Tasks in a Project:**
\`\`\`
User: "Show me the tasks in the Website Redesign project"

1. Search for the project: nestr_search with "Website Redesign label:project"
2. Get project children: nestr_get_nest_children with projectId, completed:false
3. Return the app resource with data:
   {
     "title": "Website Redesign",
     "items": [/* child tasks from the project */]
   }
4. User can check off tasks as they complete them, reorder priorities
\`\`\``,

  "authentication": `## Authentication

There are three ways to authenticate with the Nestr MCP server at \`https://mcp.nestr.io/mcp\`:

### 1. Workspace API Key (workspace-scoped)

Use the \`X-Nestr-API-Key\` header with a key from workspace settings (Settings > Integrations > Workspace API access). Workspace API keys have full workspace access regardless of user permissions. All actions are attributed to the API key, not to a specific user — there is no user identity in audit trails.

### 2. Personal API Key (user-scoped)

Users can create a personal API key from their account page at \`https://app.nestr.io/profile#security\`. Pass it as \`Authorization: Bearer <token>\` on all MCP requests. Personal API keys are scoped to the user — actions appear under that user's name in audit trails, and access respects the user's permissions. This is the simplest way for agents to authenticate as a specific user without implementing OAuth flows.

### 3. OAuth (user-scoped, auto-discovery)

OAuth tokens also identify a specific user. This is the standard approach for MCP clients that support auto-discovery.

**How MCP clients authenticate via OAuth:**

MCP-compliant clients (Claude, Cursor, VS Code, etc.) handle OAuth automatically. On first connection to \`https://mcp.nestr.io/mcp\`, the server returns a 401 with OAuth metadata. The client discovers endpoints via:

1. \`GET /.well-known/oauth-protected-resource\` — returns the authorization server URL
2. \`GET /.well-known/oauth-authorization-server\` — returns available endpoints and capabilities

The server supports three OAuth grant types:

**Authorization Code Flow with PKCE** (browser-based clients):
1. Client registers dynamically via \`POST /oauth/register\` (RFC 7591)
2. Client redirects user to \`GET /oauth/authorize\` with PKCE code_challenge
3. User authenticates on Nestr's login page and authorises access
4. Server redirects back with an authorization code
5. Client exchanges code for tokens via \`POST /oauth/token\` with code_verifier

**Device Authorization Flow** (headless/CLI agents, RFC 8628):
1. Client registers dynamically via \`POST /oauth/register\`
2. Client requests device code via \`POST /oauth/device\` with \`client_id\` and optional \`scope\`
3. Server returns \`device_code\`, \`user_code\`, and \`verification_uri\`
4. User visits the verification URI in a browser and enters the user code to authorise
5. Client polls \`POST /oauth/token\` with \`grant_type=urn:ietf:params:oauth:grant-type:device_code\` until authorised

**Refresh Tokens:**
Tokens expire. Use \`POST /oauth/token\` with \`grant_type=refresh_token\` to get a new access token without re-authenticating.

**Using OAuth tokens:**
Once obtained, pass the access token as \`Authorization: Bearer <token>\` on all MCP requests.

**Scopes:** The server requests \`user\` and \`nest\` scopes, which provide access to user profile data and workspace/nest operations.

### Which method to choose?

- **OAuth (recommended)**: The preferred method. Standard MCP auto-discovery with user-scoped access and full audit trail attribution. Most MCP clients (Claude, Cursor, VS Code) handle this automatically — just connect and authenticate. No manual key management needed, and tokens refresh automatically.
- **Personal API key**: A simpler alternative when your client doesn't support OAuth. User-scoped with the same audit trail benefits. Generate one at \`https://app.nestr.io/profile#security\` and pass as \`Authorization: Bearer <token>\`. Best for custom agents or curl-based integrations that need user identity without implementing OAuth flows.
- **Workspace API key**: Quick setup, full workspace access, but no user attribution. Actions appear as anonymous API calls in audit trails. Best for testing or workspace-wide automation where individual identity doesn't matter.

## HTTP Transport: JSON Response Mode

When connecting to \`https://mcp.nestr.io/mcp\` via HTTP, responses are returned as SSE streams by default. For simpler integrations (e.g., curl-based scripts or shell-based agents), you can request plain JSON responses instead:

- Send \`Accept: application/json\` (without \`text/event-stream\`) on the initialization request
- The entire session will return plain JSON-RPC responses instead of SSE-wrapped \`event: message\\ndata: {...}\` format
- This eliminates the need to parse SSE formatting for simple request-response interactions

**SSE (default):**
\`\`\`
Accept: application/json, text/event-stream
\`\`\`

**Plain JSON (opt-in):**
\`\`\`
Accept: application/json
\`\`\`

The mode is determined at session initialization and applies for the lifetime of the session.

## HTTP Sessions

When using the HTTP transport (\`https://mcp.nestr.io/mcp\`), each MCP session is identified by a \`mcp-session-id\` header returned on initialization. Key behaviors:

- **Session reuse**: Include the \`mcp-session-id\` header on subsequent requests to reuse the same session. This avoids re-initialization overhead.
- **No explicit TTL**: MCP transport sessions remain available as long as the server process is running. There is no idle timeout.
- **Session cleanup**: Send \`DELETE /mcp\` with the session ID to explicitly end a session.
- **Server restarts**: MCP transport sessions are in-memory and do not survive server restarts. However, **OAuth authentication is persisted to disk** — your OAuth token remains valid across restarts. If you get a session-not-found error, simply re-initialize the MCP session with the same bearer token. No re-authentication is needed.
- **One session per connection**: Each initialized session has its own transport and authentication context. Do not share session IDs across different authentication contexts.`,

  "skills": `## Skills

Skills are nests with the \`skill\` label that live directly under a role or circle. They represent processes, knowledge, or learned patterns that the role holds and uses when doing its work.

### What Skills Are
- A skill is a labeled nest (\`skill\` label) under a role or circle
- Skills make AI-persisted knowledge visible, searchable, and a first-class citizen in Nestr
- They transfer with the role — when a role is reassigned, skills stay with the role, not the previous holder

### Skill Types

Skills can be typed using \`fields['skill.type']\` to distinguish their nature:

- **\`process\`** — Step-by-step procedures: how to do something. Example: "How to deploy to production", "Customer onboarding checklist".
- **\`knowledge\`** — Domain knowledge, contacts, learned patterns. Example: "Key API endpoints", "Vendor contact list", "Common error patterns".
- **\`doctrine\`** — Organizational principles that guide decisions: the *why* behind how we work. Doctrine skills apply broadly and should be consulted before making decisions that affect the role or circle. Example: "Bias towards minimal output per tension", "Governance before operations".

When untyped, skills default to general-purpose knowledge. Use the type to help agents and humans find the right skill for the context — e.g., search for doctrine before proposing governance changes.

### When to Create Skills
- After completing repeatable work — capture the process so it can be followed again
- When learning domain-specific patterns — record them for future reference
- When discovering key contacts, recurring processes, or domain knowledge relevant to a role
- When decisions are made that should inform future work from this role
- When organizational principles emerge that should guide future decisions (doctrine)

### How to Use Skills
- Before starting work from a role, search for skills under that role: \`in:roleId label:skill\`
- Review relevant skills for context, processes, and prior decisions
- Check doctrine skills before proposing governance changes or making decisions
- After completing work, create or update skills to reflect what was learned
- Keep skills focused — one skill per process or knowledge area

### Nestr as Context and History
All work in Nestr — projects, tasks, comments, tensions, and skills — forms the complete context and history for a role. Skills complement this by capturing the *how* and *why* alongside the *what*. Together, they ensure continuity whether the role is energized by a human, an AI agent, or transitions between them.`,

  "best-practices": `## Best Practices

1. **Start by listing workspaces** to get the workspace ID and check if it has the "anchor-circle" label
2. **Use search** to find specific items rather than browsing through hierarchies
3. **Check labels** to understand what type of nest you're working with
4. **Use @mentions** in comments to notify team members: \`@{userId}\`, \`@{email}\`, or \`@{circle}\` for all role fillers
5. **Respect the hierarchy**: nests live under parents (workspace → circle → role/project → task)
6. **Maintain skills on roles and circles** for AI knowledge persistence:
   - Before doing work from a role, check for existing skills under that role or its circle — they contain processes, patterns, and domain knowledge from prior sessions
   - When completing work that is likely repeatable, capture it as a skill under the appropriate role or circle
   - Skills are the primary mechanism for AI context persistence — they're visible, searchable, and transfer with the role when it's reassigned
   - The \`data\` field is shared with Nestr internals and other integrations — never overwrite or remove existing keys. If you must store custom data, namespace under \`mcp.\` (e.g., \`data: { "mcp.lastSync": "..." }\`)`,

  "doing-work": DOING_WORK_INSTRUCTIONS,

  "tension-processing": TENSION_PROCESSING_INSTRUCTIONS,

  "workspace-setup": WORKSPACE_SETUP_INSTRUCTIONS,
};
