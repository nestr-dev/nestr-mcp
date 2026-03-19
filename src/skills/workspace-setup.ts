/**
 * Workspace & Circle Setup Skill
 *
 * Provides guided setup instructions for new workspaces and circles.
 * This will be extracted into a standalone MCP skill definition once the
 * protocol supports it. For now, it's appended to server instructions.
 */

export const WORKSPACE_SETUP_INSTRUCTIONS = `
## Workspace & Circle Setup Mode

Setup mode is a guided wizard for establishing the governance structure of a new workspace or circle. It applies to **collaborative workspaces** (\`data.self_organisation: true\`) only.

### When Setup Mode Applies

**Workspace-level setup mode** is active when ALL of the following are true:
- The workspace is collaborative (\`data.self_organisation: true\`)
- The current user is a workspace admin
- AND one or more of:
  - There is only one user in the workspace (the admin themselves)
  - There are fewer than 3 roles that do NOT have the \`facilitator\`, \`secretary\`, \`circle-lead\`, or \`rep-link\` label
  - There is no work captured besides nests with the \`onboarding_project\` label

**Circle-level setup mode** is active when:
- The current user is the circle lead of that circle
- The circle has fewer than 3 non-core roles (excluding \`facilitator\`, \`secretary\`, \`circle-lead\`, \`rep-link\`)

**Re-entry:** An admin or circle lead can always explicitly request to re-enter setup mode.

### Setup Mode Behavior

In setup mode, create governance structure **directly** using \`nestr_create_nest\` — do NOT use the tension/proposal flow. During initial setup, the admin or circle lead has full authority to define structure directly.

### Primary Use: Agentic vs Self-Organization

Early in setup, determine the user's primary reason for using Nestr.

Ask: **"What's your main reason for using Nestr — managing agentic work (AI agents doing work), or role-based self-organization for your team?"** Mention that most setups end up being hybrid.

Store on workspace: \`data: { "mcp.primary_use": "agentic" | "self-org" }\`. If already set, don't ask again.

#### Framing by Primary Use

**Agentic work** (\`mcp.primary_use: "agentic"\`):
- Frame circles and roles as structure giving AI agents clear boundaries — what they can do, control, and are accountable for.
- Use approachable language: "Roles define what each agent is responsible for. Circles group related roles. Accountabilities are what a role does. Domains are what it exclusively controls."
- Gently introduce self-org concepts as the user encounters them in operational mode.

**Self-organization** (\`mcp.primary_use: "self-org"\`):
- Use standard self-organization framing adapted to the workspace's \`self_organisation_type\`.
- Lean into purpose-driven language and distributed authority.

**Both modes converge:** The underlying structure is identical. Only the narrative wrapper changes.

#### Educate or Get Started

After determining primary use, ask: **"Would you like me to share some basic concepts, or just get started?"**

If they want to learn, give a concise overview (~2-3 minutes of reading) adapted to their primary use, then proceed with setup.

### The Setup Wizard

Guide the user through these steps conversationally. Adapt based on answers — skip irrelevant steps.

#### Step 0: Workspace Creation (if no workspace exists)

Guide through \`nestr_create_workspace\`:

1. **Organization name** → workspace title
2. **Personal or collaborative?** Personal = free forever, solo. Collaborative = free trial, team.
3. **Self-organization type** (collaborative only): Holacracy, Sociocracy, or generic role-based (\`roles_circles\`). Default to \`roles_circles\` if unsure.
4. **Organizational purpose**: Probe for why this workspace exists. They can change it later.
5. **Plan and apps**: Default to \`pro\` plan (17-day trial). Ask about optional apps (OKRs, feedback, insights).

After creation, continue to Primary Use question, then Step 1.

If one workspace exists, check if setup mode applies. If multiple, ask which to set up.

#### Step 1: Understand the Organization

1. **New or existing?** Setting up from scratch, capturing existing structure, or migrating from another tool.

2. **If migrating:** Direct to help docs:
   - Holaspirit: \`https://help.nestr.io/en/integrations/importing-data-from-holaspirit\`
   - Glassfrog: \`https://help.nestr.io/en/integrations/importing-data-from-glassfrog\`
   - General: \`https://help.nestr.io/en/integrations/importing-and-exporting-your-data-with-nestr\`
   - CSV: Ask for file content. Expected columns: circle, role, purpose, accountabilities. Parse and create programmatically. After import, skip to Step 5.

3. **Research:** Ask about website, what the org does, who it serves. Present understanding back and refine.

4. **Purpose:** Check if set; suggest one if not. Update via \`nestr_update_nest\` if needed.

5. **Size and scope:** How many people/agents? Main functional areas of work?

#### Step 2: Define Functional Areas

Suggest circles based on your research. Be specific to their organization:
- Software company: Product Development, Customer Success, Marketing & Growth, Operations
- Manufacturing: Production, Quality, Sales, Supply Chain, R&D
- Nonprofit: Programs, Fundraising, Communications, Operations

Present, refine until confirmed.

#### Step 3: Create Structure

1. **Ask preference:** "Create a starting structure for me" (batch create, review after) or "Let's go circle by circle" (discuss before creating).

2. **Creating circles:** \`nestr_create_nest\` with \`labels: ["circle"]\` under workspace. Core roles (Circle Lead, Facilitator, Secretary, Rep Link) are created automatically — do NOT create manually.

3. **Creating roles:** \`nestr_create_nest\` with \`labels: ["role"]\` including \`accountabilities\` and \`domains\` arrays.

4. **Role design principles:**
   - Prefer more smaller roles over fewer large ones
   - Accountabilities should be concrete ongoing activities ("Developing features" not "Managing development")
   - Domains represent areas of exclusive control
   - Name roles by function, not by person

#### Step 4: Create Setup Project

1. **Find parent:** Check if workspace creator is assigned to the \`circle-lead\` role. If yes, create under that role. If no, create directly under workspace with \`individual-action\` label.

2. **Create project:** Title: "Workspace governance setup completed", labels: \`["project"]\`, fields: \`{ "project.status": "Current" }\`, assign to current user.

3. **Store reference:** \`nestr_update_nest\` on workspace with \`data: { "mcp.setup_project": "<project_id>" }\`.

4. **Create tasks:** Review/refine circle purposes, review/refine role accountabilities, invite team members, assign roles, set up recurring meetings. Mark completed steps done.

#### Step 5: Review and Refine

Present full structure summary (workspace purpose, circles with purposes, roles with accountabilities and domains). Offer adjustments. Remind that governance is living — evolves through tensions and proposals.

#### Step 6: Next Steps

1. Point to setup project for remaining tasks.
2. Explain governance evolution: once team joins, changes go through tension/proposal process. For agentic users, emphasize tensions as the mechanism for agent-human communication.
3. Link to workspace: \`https://app.nestr.io/n/<workspaceId>\`

### Circle-Level Setup

Same wizard but scoped to the circle:
- Skip Steps 0 and 1
- Inherit \`mcp.primary_use\` from workspace
- Start at Step 2 for the circle's functional areas
- Create setup project under circle lead's role
- Store reference as \`data: { "mcp.setup_project": "<project_id>" }\` on the circle

### Resuming Setup

If workspace/circle has \`data['mcp.setup_project']\`, check the project's status. If incomplete tasks remain, offer to continue where they left off.
`.trim();
