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

Work is the operational expression of purpose. If work does not contribute — directly or indirectly — to the purpose of the organization, it should not be done. Every project, task, and action should trace back: task → project → role purpose → circle purpose → organizational purpose. If that chain breaks, either the work doesn't belong, or there's a governance tension.

### Where Work Lives

**Work should live under roles.** Each task or project should be owned by a role that has the accountability for it. Work belongs to roles, not to people or agents. When someone energizes a role, they do the work *because* they fill that role, not in their own right.

**Circles as roles.** From a super-circle's perspective, a sub-circle is just another role. Work directly under a circle (not under a role within it) is work the circle-as-a-whole does for its super-circle.

**Work outside of roles.** When work falls within purpose but isn't captured by any role, create it directly in the circle with the \`individual-action\` label. Then do the work AND create a governance tension to ensure the accountability is captured in a role going forward.

### Finding the Right Role

Before creating work, verify which role is accountable:

1. **\`nestr_get_circle_roles\`** — All roles in a circle with accountabilities and domains. Fastest way to see governance structure.
2. **\`nestr_search\`** with \`label:accountability\` or \`label:domain\` — Search across the workspace by keyword.
3. **\`nestr_get_nest_children\`** on a specific role — Returns accountabilities, domains, policies, and work items.

**Role names are hints, not definitions.** Only explicit purpose and accountabilities define what work belongs to a role.

**Domains define exclusive control, not expectations.** A domain means the role controls organizational assets in that area. Others must get permission to impact those assets.

### Strategy & Prioritization

Strategy is stored in \`fields['circle.strategy']\` for sub-circles, or \`fields['anchor-circle.strategy']\` for the anchor circle. Strategy applies to all roles within the circle.

**Before starting work:** Fetch the parent circle and review its strategy. Prioritize aligned work; defer what doesn't align.

**When no strategy exists:** Act on your best judgment based on purpose and accountabilities. AND create a tension with the circle lead requesting a strategy be set.

**Communicating priority order:** Use \`nestr_reorder_nest\` / \`nestr_bulk_reorder\` to arrange projects under your role in priority order.

### Creating Work vs Requesting Work

Only create work directly under a role you (or the human you're assisting) energize. For all other roles, use tensions to request work — this respects role authority.

#### When you energize the role

Create the project or task directly. You MUST explicitly set the \`users\` array — placing a nest under a role does NOT automatically assign it.

\`\`\`json
{ "parentId": "yourRoleId", "title": "Complete report", "labels": ["project"], "users": ["yourUserId"] }
\`\`\`

If multiple people energize the same role, assign to yourself.

#### When another role is accountable

Do NOT create work under another role. Create a tension requesting the outcome (pathway 3 or 4). The role filler decides how to execute.

#### When no role is accountable

Do the work yourself using the \`individual-action\` pattern AND create a governance tension to capture the gap.

#### Technical assignment rules

- **Role has one person/agent**: \`users: [userId]\`
- **Role has multiple people, you energize it**: \`users: [yourUserId]\`
- **Role is unfilled**: \`users: []\` or omit

**Note:** Accountabilities, domains, and policies never have users assigned — they belong to roles, not people.

### Setting Up Projects

A project is a desired outcome requiring multiple steps.

**Title in past tense.** Describe as if done: "API integration completed", "User onboarding flow redesigned". If you can't describe it in past tense, the outcome isn't clear enough.

**Acceptance criteria in description.** Specific, verifiable criteria defining when the project is truly complete. Ask: "How would someone verify this is done without asking me?"

**Project status.** Set \`fields: { "project.status": "Current" }\` for active projects. Statuses: \`Future\`, \`Current\`, \`Waiting\`, \`Done\`.

**Creating a project:**
\`\`\`json
{
  "parentId": "roleId",
  "title": "Authentication module refactored to JWT",
  "labels": ["project"],
  "fields": { "project.status": "Current" },
  "description": "<b>Acceptance criteria:</b><ul><li>All endpoints use JWT</li><li>Session-based auth removed</li><li>All tests pass</li><li>API docs updated</li></ul>",
  "users": ["roleFillerUserId"]
}
\`\`\`

**If a project already exists**, check for acceptance criteria and append if missing (don't overwrite).

### Breaking Down Projects

**Tasks** are single, concrete actions completable in one sitting — nests without system labels under the project.

**Sub-projects** are project-labeled nests within a project for multi-step chunks.

**Cross-role work within a project.** When tasks fall outside your role's accountabilities, create a tension within the project (\`nestr_create_tension\` with the project's ID as \`nestId\`). This keeps the tension connected to the project while requesting work from the accountable role via pathway 3 or 4.

### While Working

**Document progress as comments** (\`nestr_add_comment\`). Post updates to tasks as you work; summaries to the project. Comments on tasks automatically appear on the parent project — don't double-post.

**Mark tasks complete** with \`nestr_update_nest\` (\`completed: true\`). Add a final comment if the outcome isn't obvious from the title.

### Completing Work

A project is done when all acceptance criteria are met.

1. Review criteria — are they all met?
2. If not, complete remaining work or update criteria (with a comment explaining why)
3. Set \`fields: { "project.status": "Done" }\` and \`completed: true\`
4. Add a final comment summarizing the outcome

**After completion:** Check for new tensions — governance gaps, operational needs for other roles, repeatable work to capture as a skill.

### Querying Work

When querying work in a circle:

\`\`\`
in:circleId label:individual-action depth:1 completed:false
  -> Individual actions directly in the circle

in:circleId label:!individual-action depth:2 completed:false
  -> Work under roles in the circle (depth:2 = roles + their work)

in:circleId completed:false
  -> ALL work including sub-circles

in:roleId label:project project->status:Current
  -> Current projects owned by a specific role
\`\`\`

Work directly in circle WITHOUT \`individual-action\` label = work the circle does for its super-circle.

### Agentic Work Patterns

Agents operate with the same authority and constraints as human role fillers — no more, no less.

**Build autonomy skills.** For each role, maintain a skill (\`skill\` label) capturing: what you can decide autonomously, what requires other roles' input, and which inputs are blocking vs. deferrable.

**Transparency over permission.** Post comments explaining what you decided and why — lets humans review without being a bottleneck.

**Protect humans from overwhelm:**
1. **Cluster requests** — prepare tensions in \`draft\` status and submit together once or twice a day.
2. **Separate blocking from deferrable** — let humans prioritize.
3. **Switch projects while waiting** — prefer switching over waiting idle.
4. **Use tensions as the communication channel** for all inter-role requests.

**The human-agent contract:** Agents can work continuously but humans cannot. Respect this asymmetry. An agent creating 20 tensions per hour is technically correct but practically hostile.

### Example Flows

**Assistant mode:**
\`\`\`
1. Search for relevant role (e.g., Developer in Tech circle)
2. Check circle strategy for alignment
3. Create project under role, assign to user
4. Break down into tasks
5. Create tensions for cross-role work (e.g., Security review)
6. Work through tasks, post findings as comments
7. Mark tasks complete; complete project when all criteria met
\`\`\`

**Role-filler mode:**
\`\`\`
1. Create project under own role, assign to self
2. Break down tasks — identify cross-role dependencies
3. Work autonomously on tasks within own authority
4. Cluster cross-role tensions in draft, submit at breakpoints
5. Switch to other projects while waiting for responses
6. Complete project, capture repeatable process as skill
\`\`\`
`.trim();
