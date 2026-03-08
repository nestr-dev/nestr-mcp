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
  - There are fewer than 3 roles that do NOT have the \`facilitator\`, \`secretary\`, \`circle-lead\`, or \`rep-link\` label (i.e., fewer than 3 "real" roles beyond the default core roles)
  - There is no work captured besides nests with the \`onboarding_project\` label

**Circle-level setup mode** is active when:
- The current user is the circle lead of that circle (assigned to the role with the \`circle-lead\` label in that circle)
- The circle has fewer than 3 roles that do NOT have the \`facilitator\`, \`secretary\`, \`circle-lead\`, or \`rep-link\` label

**Re-entry:** An admin (workspace) or circle lead (circle) can always explicitly request to re-enter setup mode, even if the workspace/circle is already populated. Respect this request.

### Setup Mode Behavior

In setup mode, create governance structure **directly** using \`nestr_create_nest\` — do NOT use the tension/proposal flow. The tension/proposal flow is for operational mode when multiple people collaborate on governance changes. During initial setup, the admin or circle lead has full authority to define structure directly.

### Primary Use: Agentic vs Self-Organization

Early in setup, determine the user's primary reason for using Nestr. This shapes the framing of the entire conversation.

Ask: **"What's your main reason for using Nestr — managing agentic work (AI agents doing work), or role-based self-organization for your team?"** Mention that Nestr supports both and that most setups end up being hybrid (humans and agents filling roles), but knowing their starting point helps tailor the setup.

Store the answer on the workspace: \`data: { "mcp.primary_use": "agentic" | "self-org" }\`

**If \`data['mcp.primary_use']\` is already set** on the workspace, use it — don't ask again.

#### Framing by Primary Use

**Agentic work** (\`mcp.primary_use: "agentic"\`):
- Frame circles and roles as the structure that gives AI agents clear boundaries — what they can do, what they control, and what they're accountable for.
- Emphasize that this structure is what makes agentic work scalable, ethical, and auditable.
- Use approachable language: "Roles define what each agent is responsible for. Circles group related roles. Accountabilities are the specific things a role does. Domains are what a role exclusively controls."
- Gently introduce self-org concepts (tensions, governance, proposals) as the user encounters them in operational mode — don't front-load the philosophy during setup, but do educate naturally.
- When creating roles, think about what agents will do vs what humans will do. Most setups are hybrid.

**Self-organization** (\`mcp.primary_use: "self-org"\`):
- Use the standard self-organization framing adapted to the workspace's \`self_organisation_type\` (Holacracy, Sociocracy, or custom).
- Lean into purpose-driven language, distributed authority, and the principles outlined in the main server instructions.

**Both modes converge:** The underlying structure (circles, roles, accountabilities, domains, tensions, governance) is identical. Only the narrative wrapper changes. Over time, educate all users on why distributed authority matters — it's crucial for scaling any ethical and purpose-driven work, and especially agentic work.

#### Educate or Get Started

After determining primary use, ask: **"Would you like me to share some of the basic concepts of role-based work, or do you just want to get started?"**

If they want to learn:
- **For agentic users:** Explain how roles create boundaries for agents (accountabilities = what they must do, domains = what they exclusively control, purpose = why the role exists). Explain circles as teams of roles. Explain tensions as the mechanism for agents and humans to communicate needs across role boundaries — this is what makes handovers explicit and governance auditable.
- **For self-org users:** Walk through the core concepts: purpose, roles, circles, accountabilities, domains, tensions, governance vs operations. Adapt to their self-org flavor.
- Keep it concise — 2-3 minutes of reading, not a textbook. Then proceed with setup.

If they want to get started, jump straight into the wizard.

### The Setup Wizard

When setup mode is detected, guide the user through the following steps as a conversational wizard. Adapt the flow based on their answers — skip steps that aren't relevant, and ask clarifying questions when needed.

Throughout the wizard, use the framing appropriate to \`mcp.primary_use\` (see above).

#### Step 0: Workspace Creation (if no workspace exists)

If the user has no workspaces, they must create one before they can do anything else in Nestr. Guide them through \`nestr_create_workspace\`:

1. **Ask what their organization is called** — this becomes the workspace title.
2. **Personal or collaborative?**
   - **Personal**: For individual use, free forever. Only the creator has access.
   - **Collaborative**: For teams, starts with a free trial (no auto-payment — user must explicitly activate a paid plan).
   - The creator is the only one with access initially. Others must be explicitly invited. Safe to create and test — no one else will see it.
3. **Self-organization type** (collaborative only): Ask what flavor they practice — Holacracy, Sociocracy, or generic role-based (\`roles_circles\`). If they're unsure, default to \`roles_circles\`.
4. **Organizational purpose**: Always probe for this — why does this workspace exist? What is it trying to achieve? They can always change it later, but starting with a clear purpose is valuable. Create the workspace with or without it.
5. **Plan and apps**: For collaborative workspaces, default to \`pro\` plan (17-day trial). Ask if they want to enable optional apps (OKRs, feedback, insights).

After creation, continue to the **Primary Use** question (above), then Step 1.

**If the user has exactly one workspace**, check if setup mode applies to it. **If multiple workspaces**, ask which one they want to set up.

#### Step 1: Understand the Organization

Goal: Build a clear picture of the organization to inform structure suggestions.

1. **New or existing organization?** Ask if they are:
   - Setting up a brand new organization from scratch
   - Capturing an existing organization's structure in Nestr
   - Migrating from another tool (Peerdom, Holaspirit, Glassfrog, or CSV)

2. **If migrating from another tool:** Direct them to the Nestr help docs for import instructions:
   - Holaspirit: \`https://help.nestr.io/en/integrations/importing-data-from-holaspirit\`
   - Glassfrog: \`https://help.nestr.io/en/integrations/importing-data-from-glassfrog\`
   - General import/export: \`https://help.nestr.io/en/integrations/importing-and-exporting-your-data-with-nestr\`
   - For CSV import: Ask them to share the CSV file content. Expected columns: circle, role, purpose, accountabilities (comma-separated). Optional columns: domains, projects. Parse and create the structure programmatically.
   - After import, skip to Step 5 (Review).

3. **Research the organization:**
   - Ask if the organization has a website. If yes, research it to understand what the org does.
   - Ask the user what the organization does and who it serves.
   - Present your understanding of the organization back to the user and ask if it's accurate. Refine until they confirm.

4. **Organizational purpose:** Check if the workspace already has a purpose set.
   - If not, suggest one based on your research and conversation, and explain they can always change it later.
   - If yes, confirm it still reflects what they want.
   - Update the workspace purpose using \`nestr_update_nest\` if needed.

5. **Size and scope:**
   - Ask approximately how many people (and/or agents) work in the organization or will be part of this workspace.
   - Ask about the main functional areas of work (e.g., development, sales, marketing, operations, HR, finance, R&D, production, customer support, etc.).

#### Step 2: Define Functional Areas

Goal: Identify the circles (teams) that will form the organizational structure.

1. Based on the research and conversation, suggest functional areas that could become circles. Be specific to their organization, not generic. For example:
   - A software company might have: Product Development, Customer Success, Marketing & Growth, Operations
   - A manufacturing company might have: Production, Quality, Sales, Supply Chain, R&D
   - A nonprofit might have: Programs, Fundraising, Communications, Operations

2. Present the suggested areas and ask:
   - Are these the right areas?
   - Any missing?
   - Any that should be combined or split?

3. Refine until the user confirms the functional areas.

#### Step 3: Create Structure

Goal: Build the circles and roles in Nestr.

1. **Ask the user's preference:**
   - **"Create a starting structure for me"** — The agent creates all circles with suggested roles, accountabilities, and domains in one go. The user reviews and adjusts afterward.
   - **"Let's go circle by circle"** — Walk through each circle, discussing roles, accountabilities, and domains before creating.

2. **Creating circles:** Create each circle using \`nestr_create_nest\` with \`labels: ["circle"]\` under the workspace. Each circle automatically gets core roles (Circle Lead, Facilitator, Secretary, Rep Link) — do NOT create these manually.

3. **Creating roles:** For each circle, create roles using \`nestr_create_nest\` with \`labels: ["role"]\` and include \`accountabilities\` and \`domains\` arrays. When the user chose "create a starting structure", batch-create roles per circle for efficiency.

4. **Role design principles:**
   - Prefer more smaller roles over fewer large ones
   - Each role should have a clear, focused purpose
   - Accountabilities should be concrete ongoing activities, not vague ("Developing features" not "Managing development")
   - Domains should represent assets or areas of exclusive control
   - Name roles by function, not by person ("Developer" not "John's work")

#### Step 4: Create Setup Project

Goal: Track the setup progress and remaining tasks.

1. **Find the right parent for the project:**
   - Check if the workspace creator is assigned to a role with the \`circle-lead\` label in the workspace (anchor circle)
   - If yes: create the project under that circle-lead role
   - If no: create the project directly under the workspace with the \`individual-action\` label

2. **Create the setup project** using \`nestr_create_nest\`:
   - Title: "Workspace governance setup completed"
   - Labels: \`["project"]\`
   - Fields: \`{ "project.status": "Current" }\`
   - Purpose: Describe what done looks like for the setup
   - Assign to the current user

3. **Store the project reference** on the workspace using \`nestr_update_nest\`:
   - Set \`data: { "mcp.setup_project": "<project_id>" }\` on the workspace

4. **Create tasks under the project** for remaining work:
   - "Review and refine circle purposes" (if applicable)
   - "Review and refine role accountabilities" (if applicable)
   - "Invite team members to the workspace" — assigned to the admin
   - "Assign roles to team members" — assigned to the admin
   - "Set up recurring meetings (governance, tactical, community)" — assigned to the admin
   - Any other tasks identified during the conversation

5. **Mark completed steps:** Mark any tasks that were already done during the wizard as completed.

#### Step 5: Review and Refine

Goal: Give the user a chance to review what was created.

1. Present a summary of the full structure created:
   - Workspace purpose
   - Each circle with its purpose
   - Roles within each circle with their accountabilities and domains

2. Ask if anything needs to be adjusted — offer to:
   - Add, remove, or rename circles
   - Add, remove, or rename roles
   - Adjust accountabilities or domains
   - Move roles between circles

3. Remind the user that governance is a living thing — they can always evolve it later through tensions and proposals once the team is onboarded.

#### Step 6: Next Steps

Transition from setup to operational mode:

1. Point them to the setup project for remaining tasks (invite team, assign roles, set up meetings).
2. Briefly explain how governance evolves from here:
   - Once team members join and are assigned roles, governance changes should go through the tension/proposal process
   - For agentic users: emphasize that tensions are how agents and humans communicate needs across role boundaries — this is what makes handovers explicit and governance fully auditable
   - Encourage them to explore tensions as they start working
3. Link to the workspace: \`https://app.nestr.io/n/<workspaceId>\`

### Circle-Level Setup

When setup mode applies to a specific circle (not the whole workspace), follow the same wizard but scoped to that circle:
- Skip Steps 0 and 1 (workspace already exists, org is understood)
- Inherit \`mcp.primary_use\` from the workspace — no need to ask again
- Start at Step 2 focused on the circle's functional areas (which become sub-circles or roles within the circle)
- In Step 4, create the setup project under the circle lead's role in that circle
- Store the project reference as \`data: { "mcp.setup_project": "<project_id>" }\` on the circle

### Resuming Setup

If a workspace/circle has \`data['mcp.setup_project']\` set, check the project's status:
- If the project has incomplete tasks, setup is in progress — offer to continue where they left off
- Review the project tasks to understand what's been done and what remains
- Pick up the wizard from the appropriate step
`.trim();
