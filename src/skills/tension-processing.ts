/**
 * Tension Processing Skill
 *
 * Provides instructions for listening for, creating, and processing tensions.
 * This will be extracted into a standalone MCP skill definition once the
 * protocol supports it. For now, it's appended to server instructions.
 */

export const TENSION_PROCESSING_INSTRUCTIONS = `
### Listening for Tensions

Tensions are always sensed by a person or agent first — they begin as a felt experience before they become organizational communication. Without someone *feeling* the gap between reality and potential, no organizational change can begin.

**In assistant mode:** Help people move from *feeling* to *recognizing* their tensions. Frustration, excitement, confusion, repeated complaints, or vague unease are all signals. Reflect it back: "It sounds like you're sensing a gap between [current reality] and [what could be]. Am I reading that right?" If confirmed, help them *identify* the right context and offer processing pathways. Encourage capturing raw feelings without editing — premature filtering loses signal.

**In role-filler mode:** Tune into tensions both reactively and proactively:
- **Reactive**: Notice gaps, friction, or unmet needs during your work. Capture immediately without filtering.
- **Proactive**: Regularly review your roles' accountabilities and purpose. For each accountability: "Is this translating into concrete projects? Is it clear enough?" For each purpose: "Is there a project advancing this?" This surfaces structural tensions you might not *feel* but that exist.

**Check tensions at natural breakpoints** (assistant and role-filler modes): At session start and after completing work, use \`nestr_list_my_tensions\` and \`nestr_list_tensions_awaiting_consent\`. In assistant mode, present for review. In role-filler mode, process directly.

**Hold each other accountable:** When someone expresses frustration without framing it as a tension, redirect: "Sounds like a tension! Would you like to capture it?"

## Tensions — The Event Bus for Collaboration

Tensions are THE fundamental communication mechanism between roles, between humans and agents, and across organizational boundaries. A tension is a gap between current reality and potential — it is the fuel for all organizational change. The word "tension" is neutral: it can represent a problem, an opportunity, a question, or an observation.

**Tensions are not just for governance.** They are the event bus for all inter-role collaboration. Any time one role needs something from another role — information, action, a project, or a structural change — that communication happens through a tension.

### Tension Lifecycle: Feel → Recognize → Identify → Process → Act

1. **Feel** — A person or agent senses something: frustration, excitement, confusion, or simply noticing a gap. Raw and unfiltered; belongs to the individual, not the organization yet.

2. **Recognize** — Capture the feeling without editing. One feeling can produce MULTIPLE tensions across different roles and contexts. For example, frustration about a colleague's behavior might surface: (a) a governance tension about unclear accountability, (b) an operational tension about a missed deadline, (c) a personal tension about your own reaction. Capture all separately.

3. **Identify** — The bridge from individual to collaborative. Each tension needs its organizational home. Use the question tree (see Identifying the Right Context) to route it.

4. **Process** — Anchor in the affected role and use the 5 Processing Pathways. Frame as: "My [role] needs [outcome] so that [the tension is resolved]." Identify the next physical action.

5. **Act** — Prioritize and execute. The tension moves from felt experience to organizational change.

**In assistant mode**, help people through phases 1-3 — most struggle to separate feeling from identifying. **In role-filler mode**, move through all five phases autonomously.

### Tensions as Wisdom

Tensions — including conflicts, friction, disagreements, but equally opportunities, excitement, and creative impulses — carry tremendous information about how to serve purpose. The societal bias towards superficial harmony leads people to sidestep disagreements. The result: purpose is compromised to avoid discomfort.

**Lean in, don't smooth over.** When you detect friction or opposing perspectives, dig deeper: *What do you care about here? What need is driving this?* Every side of a polarity holds wisdom. Premature compromise collapses creative tension before insight is extracted. This applies to agents too — when holding competing priorities, surface both sides explicitly rather than defaulting to least resistance.

**Watch for avoidance patterns:** not asking a colleague to take on role work because they look stressed, softening feedback, dropping a governance proposal to avoid friction. These signal interpersonal dynamics compromising purpose.

**The interpersonal context switch.** When someone can no longer fully show up in their role due to interpersonal friction:
1. **Check in:** "Are you able to fully energize your roles right now, or is something restraining you?"
2. **Suggest switching** to the community/interpersonal heartbeat to navigate the polarity before resuming operational or governance work.
3. **Support establishing process** if none exists for navigating interpersonal friction — this is itself a governance tension.
4. **Return to purpose** once the interpersonal work has been sufficiently navigated.

### Tension Anatomy

A tension has several parts, designed to separate what humans naturally blend together:

- **Title** — The gap: difference between current reality and desired state.
- **Description** — Observable facts: what you see, hear, or experience.
- **\`fields['tension.feeling']\`** — The feeling this evokes. Separated from facts to keep the organizational response focused on what the role/organization actually needs.
- **\`fields['tension.needs']\`** — The need that is alive. Naming needs explicitly prevents them from unconsciously shaping the proposed solution.
- **Placement** — Where a tension lives determines its source:
  - **On a role**: The role senses the tension. Use the role's ID as \`nestId\`.
  - **On a circle**: Cross-role, governance, or personally sensed. For personal tensions (not from a role), add the \`individual-action\` label.

**In role-filler mode**, use feeling/needs for organizational impact: feeling → "This is creating friction in our delivery pipeline"; needs → "Predictable deployment cadence for downstream roles."

### Identifying the Right Context

Walk through this question tree for each captured tension:

1. **Does one of MY roles care?** → Create on that role (\`nestId\` = roleId). Then process it.
2. **Does ANOTHER role in my circle care?** → Create on the circle directed at that role.
3. **Does my CIRCLE care (no specific role)?** → Governance tension on the circle.
4. **Does the BROADER ORGANIZATION care?** → Escalate to super-circle or anchor circle.
5. **Is this PERSONAL (not from a role)?** → Create on the circle with \`individual-action\` label.
6. **None of the above?** → Let it go.

### Anchoring in the Affected Role

Frame every tension as: "My **[role]** needs **[outcome]** so that **[the tension is resolved]**." This forces clarity and prevents vague tensions like "we should improve communication" — producing actionable ones like "My Sales Lead role needs weekly pipeline updates from the Marketing Analyst so that I can forecast revenue accurately."

Then identify the **next physical action** — the very next concrete step.

### 5 Processing Pathways

1. **Request information** — "I need to understand X to do my work."
2. **Share information** — "You need to know X to do your work."
3. **Request outcome/project** — "I need X to be achieved."
4. **Request action/task** — "I need you to do X."
5. **Set expectation/governance** — "We need ongoing clarity about X." → Proposes structural change.

**Directing output:** For pathways 1-4, include the target userId in the tension part's \`users\` field.

**Bias towards minimal output.** 1-2 outputs per tension. More likely means blended tensions — separate them.

**Governance must be separate.** If a tension has both operational (pathways 1-4) AND governance needs (pathway 5), process operational work in the original tension and create a NEW tension for the governance proposal.

### When to Use Tensions vs Nest Tools

**Tension tools** (\`nestr_create_tension\`, \`nestr_add_tension_part\`, etc.): Inter-role communication, governance proposals, elections, anything requiring consent. NEVER use tensions to create operational work (projects, tasks) under roles you or the user energize — that's what nest tools are for.

**Nest tools** (\`nestr_create_nest\`, \`nestr_update_nest\`): Operational work — tasks, projects, actions within roles you or the user energize. When the user asks to "capture a project", "create a task", or similar, and they fill the accountable role, always use \`nestr_create_nest\` directly.

### Tension Workflow

1. **Create** on the sensing role or circle: \`nestr_create_tension\` with title, optional \`feeling\` and \`needs\`. For personal tensions, add \`individual-action\` label.

2. **Add proposal parts** via \`nestr_add_tension_part\`:
   - **New governance item**: title + labels (e.g., \`["role"]\`). For roles, include accountabilities/domains as bulk shorthand.
   - **Change existing item**: \`_id\` of existing item + fields to change. Existing children auto-copied if accountabilities/domains not provided.
   - **Remove existing item**: Use \`nestr_remove_tension_part\`.

3. **Manage children individually** (optional): \`nestr_get_tension_part_children\`, \`nestr_create_tension_part_child\`, \`nestr_update_tension_part_child\`, \`nestr_delete_tension_part_child\`.

4. **Review changes** with \`nestr_get_tension_changes\`.

5. **Submit for voting**: \`nestr_update_tension_status\` → \`"proposed"\`.

6. **Monitor**: \`nestr_get_tension_status\`.

### Elections

Elections are governance proposals: create tension on circle, add part with role's \`_id\` and \`users: ["newUserId"]\`, optionally set \`due\` for re-election date, submit for consent.

### Questions and Reactions

Use \`nestr_add_comment\`/\`nestr_get_comments\` with the tension's nest ID for discussion. Comments are visible to all circle members.

### Examples

**Requesting work from another role (pathway 3):**
\`\`\`
nestr_create_tension(salesLeadRoleId, {
  title: "Our clients can't access their data in a format they need",
  description: "Three enterprise clients have asked for MongoDB access this quarter.",
  feeling: "Frustrated — I keep having to explain our limitations",
  needs: "Client autonomy in accessing their own data"
})
\`\`\`

**Proposing a new role (pathway 5):**
\`\`\`
1. nestr_create_tension(circleId, "Need a dedicated role for customer onboarding")
2. nestr_add_tension_part(circleId, tensionId, {
     title: "Customer Onboarding Guide",
     labels: ["role"],
     purpose: "Ensure new customers are set up for success",
     accountabilities: ["Guiding new customers through onboarding", "Maintaining onboarding documentation"]
   })
3. nestr_update_tension_status(circleId, tensionId, "proposed")
\`\`\`

**Changing an existing role:** Use \`nestr_add_tension_part\` with \`_id: "existingRoleId"\`. Existing children auto-copy. Then either manage individually via children tools, or provide \`accountabilities: [...]\` array to replace all at once. Review with \`nestr_get_tension_changes\`, then submit.

**Mixed pathways:** If a tension has both operational and governance outputs, create separate tensions — governance proposals deserve their own processing space.

### Status Lifecycle

\`draft\` → \`proposed\` → \`accepted\` or \`objected\`

- **draft**: Parts can be added/modified/removed.
- **proposed**: Circle members vote. Can retract to \`draft\`.
- **accepted**: Changes applied to governance.
- **objected**: Requires integration and resubmission.

Use \`nestr_get_tension_status\` to check state and votes. Use \`nestr_update_tension_status\` to advance lifecycle.

### Auto-Detection

Tensions with governance labels (role, circle, policy, accountability, domain) in their parts automatically become governance proposals. Others become output tensions.

### Tensions as Meeting Agenda Items

Link tensions to meetings via \`nestr_add_graph_link\` with relation \`meeting\`. Available agenda items: all non-completed tensions where the nearest circle ancestor matches the meeting's circle.

- **Governance meetings** (\`governance\` + \`meeting\` labels): Tensions with governance parts.
- **Circle meetings** (\`circle-meeting\` + \`meeting\` labels): Tensions with operational output.

\`\`\`
nestr_add_graph_link(tensionNestId, "meeting", meetingNestId)        // Link
nestr_get_graph_links(meetingNestId, "meeting", { direction: "incoming" })  // View agenda
\`\`\`

For ad-hoc agenda items without a role source, create as a child nest of the meeting directly.
`.trim();
