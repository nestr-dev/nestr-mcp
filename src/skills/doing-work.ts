/**
 * Doing Work Skill
 *
 * Provides instructions for how work flows from purpose through strategy
 * to execution, completion, and cross-role coordination.
 * This will be extracted into a standalone MCP skill definition once the
 * protocol supports it. For now, it's appended to server instructions.
 */

export const DOING_WORK_INSTRUCTIONS = `
## Doing Work

Work is the operational expression of purpose. If work does not contribute — directly or indirectly — to the purpose of the organization, it should not be done. Every project, task, and action should trace back through the hierarchy: task → project → role purpose → circle purpose → organizational purpose. If that chain breaks, either the work doesn't belong, or there's a governance tension (a missing role, accountability, or circle).

### Where Work Lives

In role-based self-organization, understanding where work lives is crucial:

**Work should live under roles.** The goal is to do all work from a role. Each task or project should be owned by a role that has the accountability for it. Work belongs to roles, not to people or agents. A person or agent has no authority to impact organizational work — only roles can. When someone energizes a role, they do the work *because* they fill that role, not in their own right.

**Circles as roles.** From a super-circle's perspective, a sub-circle is just another role. Work directly under a circle (not under a role within it) is work the circle-as-a-whole does for its super-circle. How that work is internally organized is irrelevant to the super-circle.

**Work outside of roles.** Sometimes work needs to be done that falls within the organization's purpose but isn't yet captured by any role. This work is captured directly in a circle with the \`individual-action\` label:
- **Context**: The work is for this circle's purpose (not the super-circle)
- **Meaning**: Work needed for the circle but not yet assigned to a role
- **Next step**: Do the work, AND create a governance tension to ensure the accountability is captured in a role going forward. The governance tension is essential — without it, the gap stays invisible.

### Finding the Right Role

Before creating work, verify which role is accountable for it:

1. **\`nestr_get_circle_roles\`** — Returns all roles in a circle with their accountabilities and domains. The fastest way to see the full governance structure.
2. **\`nestr_search\`** with \`label:accountability\` or \`label:domain\` — Search across the workspace for specific accountabilities or domains by keyword.
3. **\`nestr_get_nest_children\`** on a specific role — Returns the role's accountabilities, domains, policies, and work items.

**Role names are hints, not definitions.** Only the role's explicit purpose and accountabilities tell you what work belongs there. "Developer" might handle infrastructure; "Architect" might write code.

**Domains define exclusive control, not expectations.** A domain doesn't mean the role will do work in that area — it means the role controls organizational assets in that area. Other roles must get permission to impact those assets.

When assigning work to a role, verify the role actually has accountability for it:
\`\`\`
1. nestr_get_circle_roles(workspaceId, circleId)
   → Review accountabilities of each role
2. Find the role whose accountability matches the work
3. Create the project/task under that role
\`\`\`

When the work impacts a domain held by another role, coordinate with the domain holder before proceeding.

### Strategy & Prioritization

Work should be prioritized by the circle's strategy. Strategy is stored in \`fields['circle.strategy']\` for sub-circles, or \`fields['anchor-circle.strategy']\` for the anchor circle (workspace). Strategy applies to all roles within the circle — it defines what to focus on now and what to defer.

**Before starting work, check the circle strategy:**
1. Fetch the parent circle and review its strategy field (\`circle.strategy\` or \`anchor-circle.strategy\` depending on the circle type)
2. Prioritize work that directly serves the strategy
3. Defer or deprioritize work that doesn't align

**When no strategy exists:**
- As a role filler (human or agent), you are free to interpret the circle's purpose and accountabilities to determine your own best-guess prioritization. Don't wait — act on your best judgment.
- AND create a tension with the circle lead requesting that a strategy be set. Without a strategy, role fillers lack the guidance they need to make consistent prioritization decisions across the circle.

**Communicating priority order:** Use the reorder tools (\`nestr_reorder_nest\`, \`nestr_bulk_reorder\`) to arrange projects under your role in priority order. This makes your prioritization visible and transparent to the organization.

### Creating Work vs Requesting Work

Only create work directly under a role you (or the human you're assisting) energize. For all other roles, use tensions to request work — this respects role authority and lets the role filler decide how to execute.

#### When you energize the role

Create the project or task directly under your role. You MUST explicitly set the \`users\` array — placing a nest under a role does NOT automatically assign it.

\`\`\`json
{ "parentId": "yourRoleId", "title": "Complete report", "labels": ["project"], "users": ["yourUserId"] }
\`\`\`

If multiple people energize the same role, assign to yourself — not to others who share the role.

#### When another role is accountable

Do NOT create work under another role. Instead, create a tension requesting the outcome (processing pathway 3 — request outcome, or pathway 4 — request action). The role filler decides whether and how to take on the work.

- **Assistant mode**: Help the user draft the tension requesting work from the accountable role. If the user insists on creating work directly, inform them which role is accountable and who energizes it.
- **Role-filler mode**: Create a tension on the circle or within the project (see Cross-role work) requesting the accountable role take on this work.
- **Workspace mode**: Create a tension directed at the accountable role, or if operating in setup mode, assign based on organizational rules.

#### When no role is accountable

If the work falls within the organization's purpose but no role has the accountability, do the work yourself using the \`individual-action\` pattern (see Where Work Lives above) — don't let the organization be harmed by inaction while governance catches up. AND create a governance tension to capture the gap so a role becomes accountable going forward.

#### Technical assignment rules

When you ARE creating work under a role you energize:
- **Role has one person/agent**: \`users: [userId]\`
- **Role has multiple people, you energize it**: \`users: [yourUserId]\`
- **Role is unfilled**: \`users: []\` or omit — the work belongs to the role until someone energizes it

**Note:** Accountabilities, domains, and policies never have users assigned — they belong to roles, not people.

### Setting Up Projects

A project is a desired outcome that requires multiple steps to achieve. It is the container for all the work needed to reach that outcome.

**Title in past tense.** Describe the project as if it's already done — this makes it immediately clear what "done" looks like. Examples: "API integration completed", "User onboarding flow redesigned", "Q1 report published". If you can't describe it in past tense, the outcome isn't clear enough yet.

**Acceptance criteria in description.** The \`description\` field should contain specific, verifiable criteria that define when the project is truly complete. Ask: "How would someone verify this is done without asking me?" Good acceptance criteria are observable and binary — they're either met or they're not.

**Project status.** Set \`fields: { "project.status": "Current" }\` for actively worked projects. Statuses: \`Future\` (planned), \`Current\` (active), \`Waiting\` (blocked), \`Done\` (complete).

**Creating a project:**
\`\`\`json
{
  "parentId": "roleId",
  "title": "Authentication module refactored to JWT",
  "labels": ["project"],
  "fields": { "project.status": "Current" },
  "description": "<b>Acceptance criteria:</b><ul><li>All endpoints use JWT for authentication</li><li>Session-based auth removed</li><li>All tests pass</li><li>API documentation updated</li></ul>",
  "users": ["roleFillerUserId"]
}
\`\`\`

**If a project already exists**, review and enhance it:
- Check if the description has clear acceptance criteria
- If not, **append** to the description (don't overwrite) with suggested criteria
- In assistant mode, suggest criteria to the user. In role-filler mode, define them yourself.

### Breaking Down Projects

Break projects into tasks and, where needed, sub-projects:

**Tasks** are single, concrete actions that can be completed in one sitting. They are nests without system labels — just create a nest under the project. Examples: "Call supplier about pricing", "Draft intro paragraph", "Write migration script for user table".

**Sub-projects** are project-labeled nests within a project. Use them when a chunk of work is itself a multi-step outcome. They follow the same rules as projects (past-tense title, acceptance criteria).

**Cross-role work within a project.** When breaking down a project, some tasks or sub-projects may fall outside your role's accountabilities or purpose. For these:
1. **Create a tension within the project** using \`nestr_create_tension\` with the project's ID as \`nestId\`. This keeps the tension visibly connected to the project outcome.
2. The tension requests work from the accountable role (using processing pathway 3 or 4 from the tension skill).
3. The resulting work lives under the other role but the tension within the project maintains the relationship and traceability.

This pattern ensures the project remains the single container for the complete outcome, even when multiple roles contribute to it.

### While Working

**Document progress as comments** (\`nestr_add_comment\`):
- Post updates to individual tasks as you work on them
- Post summaries or milestone updates to the project itself
- In assistant mode, capture relevant questions you asked the user and their answers
- Note: Comments on a task automatically appear on the parent project, so don't double-post

**Mark tasks complete** as you finish them:
- Use \`nestr_update_nest\` with \`completed: true\`
- Add a final comment summarizing what was done if the outcome isn't obvious from the title

### Completing Work

A project is done when all its acceptance criteria are met. Completion is not just "I finished working on it" — it's "someone can verify the outcome matches what was described."

**To complete a project:**
1. Review the acceptance criteria in the description — are they all met?
2. If any criteria aren't met, either complete the remaining work or update the criteria (with a comment explaining why)
3. Set \`fields: { "project.status": "Done" }\` and \`completed: true\`
4. Add a final comment summarizing the outcome

**After completion, check for new tensions:**
- Did the work surface gaps in governance (missing roles, unclear accountabilities)?
- Did the work reveal operational needs for other roles?
- Is the work repeatable? If so, capture it as a skill under the role.
- Capture any emerging tensions — completed work often reveals the next thing that needs to change.

### Querying Work

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

in:roleId label:project project->status:Current
  -> Current projects owned by a specific role
\`\`\`

### Agentic Work Patterns

When an agent fills roles, it operates with the same authority and constraints as a human role filler — no more, no less. The key difference is how agents interact with humans across role boundaries.

**Build autonomy skills.** For each role you energize, maintain a skill (labeled \`skill\`) that captures:
- What decisions you can make autonomously within this role's accountabilities
- What requires input or authorization from other roles (and which ones)
- Which of those inputs are blocking (can't proceed without) vs. deferrable (can proceed and circle back)
This skill evolves over time as you learn the boundaries. When in doubt, ask — then record the answer.

**Transparency over permission.** When making autonomous decisions within your role's authority, you don't need permission — but you do need transparency. Post a comment on the project or task explaining what you decided and why. This lets humans review and course-correct without being a bottleneck.

**Protect humans from overwhelm.** When your work requires input from human-filled roles:
1. **Cluster requests.** Rather than creating tensions one at a time throughout the day, prepare multiple tensions in \`draft\` status and submit them together once or twice a day. Single requests throughout the day fragment human attention.
2. **Separate blocking from deferrable.** Clearly distinguish which requests block your progress and which can wait. If a request is deferrable, say so — it lets the human prioritize.
3. **Switch projects while waiting.** If you're blocked on a request from a human-filled role, check if you can make meaningful progress on another project without significant harm to organizational purpose or strategy. Prefer switching over waiting idle — but don't context-switch so aggressively that transparency suffers.
4. **Use tensions as the communication channel.** All inter-role requests — whether for information, authorization, actions, or outcomes — flow through tensions. This keeps the communication visible, traceable, and processable within the organizational structure.

**The human-agent contract:** Agents serve the same purpose as humans in self-organization — they energize roles and process tensions. The difference is operational rhythm: agents can work continuously but humans cannot. Respect this asymmetry. An agent creating 20 tensions per hour is technically correct but practically hostile. Match the cadence of the humans you interact with.

### Example Flows

**Assistant mode:**
\`\`\`
User: "Can you refactor our authentication module to use JWT?"

1. Search for relevant role (e.g., Developer role in Tech circle)
2. Check circle strategy — does this align?
3. Create project: "Authentication module refactored to JWT"
   - Description: acceptance criteria (all endpoints use JWT, tests pass, docs updated)
   - Parent: Developer role
   - Assign to user
4. Break down into tasks
5. If any tasks require another role (e.g., Security review), create a tension
   within the project requesting that role's input
6. Work through tasks, post findings as comments
7. Mark each task complete as finished
8. When all criteria met, complete the project
\`\`\`

**Role-filler mode (agent):**
\`\`\`
Agent reviews role accountabilities and finds a gap: session-based auth
doesn't meet the security accountability. Circle strategy says "harden
infrastructure for enterprise clients."

1. Create project under own role: "Authentication module refactored to JWT"
   - Description: acceptance criteria
   - Assign to self
2. Break down into tasks — identify that Security Review requires
   the Security Lead role (human-filled)
3. Work on tasks within own authority autonomously
4. Prepare a tension within the project requesting Security Lead review
   (draft status — cluster with other pending requests)
5. At a natural breakpoint, submit clustered tensions
6. While waiting for Security Lead, switch to next priority project
7. When review comes back, complete remaining tasks
8. Post decision comments for transparency
9. Complete project, capture repeatable process as a skill
\`\`\`
`.trim();
