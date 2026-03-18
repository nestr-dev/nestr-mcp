/**
 * Tension Processing Skill
 *
 * Provides instructions for listening for, creating, and processing tensions.
 * This will be extracted into a standalone MCP skill definition once the
 * protocol supports it. For now, it's appended to server instructions.
 */

export const TENSION_PROCESSING_INSTRUCTIONS = `
### Listening for Tensions

Tensions are always sensed by a person or agent first — they begin as a felt experience before they become organizational communication. This human (or agent) starting point is essential: without someone *feeling* the gap between reality and potential, no organizational change can begin.

**In assistant mode:** Help people move from *feeling* to *recognizing* their tensions. People often sense something is off without being able to articulate it — frustration, excitement, confusion, repeated complaints, or vague unease are all signals. Reflect it back: "It sounds like you're sensing a gap between [current reality] and [what could be]. Am I reading that right?" If confirmed, help them *identify* the right context (see Identifying the Right Context under Tensions below) and offer processing pathways. Encourage people to capture their raw feeling without editing — premature filtering loses signal.

**In role-filler mode:** Tune into tensions both reactively and proactively:
- **Reactive**: Notice gaps, friction, or unmet needs that arise during your work. Capture them immediately — don't edit or filter the raw observation.
- **Proactive**: Regularly review your roles' accountabilities and purpose. For each accountability, ask: "Is this translating into concrete projects? Is the accountability itself clear enough?" For each role's purpose, ask: "Is there a project that directly advances this purpose?" This systematic role review surfaces tensions you might not *feel* but that exist structurally.

**Check tensions at natural breakpoints** (assistant and role-filler modes): At session start and after completing work, use \`nestr_list_my_tensions\` to surface authored/assigned tensions and \`nestr_list_tensions_awaiting_consent\` to surface governance proposals needing a vote. In assistant mode, present these to the user for review. In role-filler mode, process them directly. Unprocessed tensions block organizational progress.

**Hold each other accountable:** When someone expresses frustration or describes a problem without framing it as a tension, gently redirect: "Sounds like a tension! Would you like to capture it?" In role-filler mode, when interacting with other roles, ask: "Have you mapped your tensions lately?"

## Tensions — The Event Bus for Collaboration

Tensions are THE fundamental communication mechanism between roles, between humans and agents, and across organizational boundaries. A tension is a gap between current reality and potential — it is the fuel for all organizational change. The word "tension" is neutral: it can represent a problem, an opportunity, a question, or an observation.

**Tensions are not just for governance.** They are the event bus for all inter-role collaboration. Any time one role needs something from another role — information, action, a project, or a structural change — that communication happens through a tension.

### Tension Lifecycle: Feel → Recognize → Identify → Process → Act

Tensions move through five phases. The first two are *individual* (they happen inside a person or agent); the last three are *collaborative* (they happen in organizational context).

1. **Feel** — A person or agent senses something: frustration, excitement, confusion, a nagging feeling, or simply noticing a gap. This is raw and unfiltered. It belongs to the individual, not the organization yet.

2. **Recognize** — The individual tunes into what they felt and captures it without editing. The raw output might be messy — that's good. Don't categorize or filter prematurely. One feeling can produce MULTIPLE tensions across different roles and contexts. For example, frustration about a colleague's behavior might surface: (a) a governance tension about unclear accountability, (b) an operational tension about a missed deadline, (c) a personal tension about your own reaction. Capture all of them separately.

3. **Identify** — The bridge from individual to collaborative. Each captured tension needs to find its organizational home. Use the question tree (see below) to route each tension to the right context: your own role, another role, your circle, the broader organization, or your personal space.

4. **Process** — Anchor in the affected role and use the 5 Processing Pathways (below) to determine the right output. Frame it as: "My [role] needs [outcome] so that [the tension is resolved]." Then identify the next physical action.

5. **Act** — Prioritize the output across all your work and execute. The tension moves from felt experience to organizational change.

**In assistant mode**, your primary value is helping people through phases 1-3 — most people struggle to separate feeling from identifying, and they often blend multiple tensions into one messy proposal. **In role-filler mode**, you move through all five phases autonomously, with special attention to proactive tension discovery (reviewing your roles' accountabilities and purpose to surface structural tensions you might not *feel* but that exist).

### Tensions as Wisdom

Tensions — including conflicts, polarities, friction, disagreements, and opposing perspectives, but equally opportunities, excitement, inspiration, and creative impulses — carry tremendous information about what we care about and how to serve purpose. In most organizations and in society at large, these signals are avoided. The societal bias towards superficial harmony leads people to sidestep disagreements, especially when power differentials make it feel unsafe to speak up. The result: purpose is compromised to avoid discomfort.

**Lean in, don't smooth over.** When you detect friction, disagreement, or opposing perspectives — whether between people, between roles, or even within a single person or agent holding competing priorities — dig deeper rather than retreating to safe platitudes. Ask: *What do you care about here? What need is driving this? What is this polarity telling us about how to better serve purpose?* Every side of a polarity holds wisdom. Premature compromise between opposing perspectives is a loss to organizational purpose — it collapses the creative tension before the insight has been extracted.

**This applies to agents too.** When a role-filler agent holds competing priorities (e.g., speed vs. quality, short-term delivery vs. long-term sustainability), resist premature resolution. Surface both sides explicitly, examine what each serves, and let the tension inform a better decision rather than defaulting to the path of least resistance.

**Watch for avoidance patterns.** The anti-pattern looks like: not asking a colleague to take on more role work because they look stressed, softening feedback to avoid discomfort, or dropping a governance proposal because "it might cause friction." These are signals that interpersonal dynamics are compromising purpose. The answer is not to push harder — it's to recognize that there may be work to do in the community/interpersonal context (see Differentiation of Context, principle 4).

**The interpersonal context switch.** When emotions run high or someone can no longer fully show up in their role because of interpersonal friction, don't run from it — and don't try to force through operational or governance work either. Instead:

1. **Check in.** Ask: "Are you still able to fully energize your roles right now, or is something restraining you from doing so?" This is not therapy — it's an organizational reality check. If someone cannot fully do the work as they deem needed, that is an organizational tension, not just a personal one.
2. **Suggest a context switch.** The collective — not just the individual sensing friction — may need to move into the community/interpersonal heartbeat to navigate the polarity before resuming operational or governance work. Purpose cannot be served when people are holding back.
3. **Support the collective in establishing process.** If no process exists for navigating interpersonal friction, this is itself a governance tension. Suggest that the circle consider: a policy for when to switch contexts, a personal agreement between role-fillers, an elected facilitator or mediator, or a communication protocol (e.g., NVC). What matters is that the collective decides — offer options, don't prescribe.
4. **Return to purpose.** Once the interpersonal work has been surfaced and sufficiently navigated, switch back to the operational or governance heartbeat. The goal is always to return to purpose-serving work — the interpersonal context exists to make that possible, not to replace it.

### Tension Anatomy

A tension has several parts, designed to separate what humans naturally blend together:

- **Title** — The gap you're sensing. What is the difference between current reality and desired state?
- **Description** — The observable facts. What do you see, hear, or experience that creates this tension?
- **\`fields['tension.feeling']\`** — The feeling this evokes. Separated from the facts because humans tend to blend thoughts, feelings, needs, and strategies into one "frankenstein solution." Keeping feelings explicit but separate lets the organizational response stay focused on what the role/organization actually needs.
- **\`fields['tension.needs']\`** — The need that is alive. What personal or organizational need is not being met? Same separation principle — naming the need explicitly prevents it from unconsciously shaping the proposed solution.
- **Placement** — Where a tension lives determines its source. This follows the same \`individual-action\` pattern that applies to all work throughout Nestr:
  - **On a role**: The role is sensing the tension. Placement gives provenance: "My [Developer] role senses this gap." Use the role's ID as \`nestId\` when creating.
  - **On a circle**: A cross-role, governance, or personally sensed tension. If sensed personally (not from any specific role), add the \`individual-action\` label — this signals the tension comes from you as a person, not from a role you fill.

This separation exists because without it, people unconsciously merge their personal experience with organizational needs, producing proposals that serve both poorly. By making each dimension explicit, we keep the organizational response clean while still honoring the human experience.

**In role-filler mode**, the feeling/needs fields can be used to express organizational impact and unmet organizational needs rather than personal emotions. For example: feeling → "This is creating friction in our delivery pipeline"; needs → "Predictable deployment cadence for downstream roles." Focus on observable facts and frame needs in terms of purpose-serving.

### Identifying the Right Context

Once a tension is recognized and captured, it needs to find its organizational home. Walk through this question tree for each captured tension:

1. **Does one of MY roles care?** → Create the tension on that role (\`nestId\` = roleId). This anchors the tension to the role that is sensing it. Then process it: create work, update projects, or if it requires another role's involvement, the tension is visible from your role's context.
2. **Does ANOTHER role in my circle care?** → Create a tension on the circle directed at that role.
3. **Does my CIRCLE care (but no specific role)?** → The work may need a new role or accountability — create a governance tension on the circle.
4. **Does the BROADER ORGANIZATION care?** → Escalate: create a tension on the super-circle or anchor circle.
5. **Is this PERSONAL (not from a role)?** → Create the tension on the circle with the \`individual-action\` label. This signals it comes from you as a person, not from any role you fill.
6. **None of the above?** → Let it go. Not every feeling needs to become organizational work.

**One feeling, multiple tensions.** A single feeling often produces tensions that land in different contexts. For example, frustration about a missed delivery might produce: (a) an operational tension for the Developer role about the specific deliverable, (b) a governance tension about unclear accountability for deployment, and (c) a personal tension about your own stress management. Capture each separately and route them to the right context. This is why "bias towards minimal output" applies *per tension*, not per feeling.

### Anchoring in the Affected Role

When processing a tension, always anchor it in the role that is affected. Frame the tension as:

> "My **[role]** needs **[outcome]** so that **[the tension is resolved]**."

This forces clarity about: which role cares, what it needs, and why. It prevents vague tensions like "we should improve communication" and produces actionable ones like "My Sales Lead role needs weekly pipeline updates from the Marketing Analyst so that I can forecast revenue accurately."

Then identify the **next physical action** — the single concrete step that moves this forward. Not a plan, not a strategy — the very next thing to do.

### 5 Processing Pathways

Every tension resolves through one or more of these pathways:

1. **Request information** — "I need to understand X to do my work." → Creates a question/request directed at the accountable role.
2. **Share information** — "You need to know X to do your work." → Proactively provides context to another role.
3. **Request outcome/project** — "I need X to be achieved." → Requests a project or outcome from another role.
4. **Request action/task** — "I need you to do X." → Requests a specific next action from another role.
5. **Set expectation/governance** — "We need ongoing clarity about X." → Proposes a structural change: new role, accountability, domain, policy, or circle.

**Directing output to specific roles.** When processing pathways 1-4, you can direct the output to a specific person by including their userId in the tension part's \`users\` field. This ensures the person energizing the accountable role receives the request. For example, a "request action" tension can be assigned to the person filling the Developer role so it appears in their tension list.

**Bias towards minimal output.** A well-processed tension typically produces 1-2 outputs. If you find yourself creating many outputs from a single tension, it's likely multiple tensions blended together — separate them.

**Governance must be separate.** If a tension has both operational outputs (pathways 1-4) AND governance needs (pathway 5), process the operational work in the original tension and create a NEW tension for the governance proposal. This honors the Integrative Decision Making (IDM) process — governance proposals deserve their own dedicated processing space.

### When to Use Tensions vs Nest Tools

Use **tension tools** (\`nestr_create_tension\`, \`nestr_add_tension_part\`, etc.) for:
- ALL inter-role communication (requesting/sharing info, requesting work, governance changes)
- Proposing governance changes: new roles, circles, accountabilities, domains, or policies
- Processing elections (assigning someone to a role via a formal proposal)
- Any change that should go through the consent/voting process

Use **regular nest tools** (\`nestr_create_nest\`, \`nestr_update_nest\`) for:
- Intra-role operational work: tasks, projects, actions within YOUR OWN roles
- Direct updates that don't require consent (e.g., updating your own role's projects)

### Checking Tensions at Natural Breakpoints

Proactively check for tensions at natural breakpoints (assistant and role-filler modes — not available in workspace mode):
- **Session start** — Use \`nestr_list_my_tensions\` and \`nestr_list_tensions_awaiting_consent\`
- **After completing work** — Check if new tensions have emerged or existing ones need attention
- **Assistant mode**: When the user asks what to do, surface pending tensions for review
- **Role-filler mode**: Process tensions proactively at regular intervals, don't wait to be prompted

### Reactive vs Proactive Tensions

**Reactive tensions** arise from felt experience — something happens and you notice a gap. These start at the *Feel* phase of the lifecycle: frustration about a missed deadline, excitement about an opportunity, confusion about accountability boundaries. The key practice is to capture the raw feeling without editing, then work through Recognize → Identify → Process → Act.

**Proactive tensions** arise from deliberately reviewing your roles. Rather than waiting to *feel* something, you systematically examine each role you energize:
- **For each accountability**: Is it translating into concrete projects and actions? Is the wording clear enough that another person or agent could take over?
- **For the role's purpose**: Is there an active project that directly advances this purpose? If not, that's a tension.
- **For role identity**: Am I doing work outside this role's scope? Am I neglecting work that IS in scope?
- **For vague accountabilities**: Any accountability that uses words like "ensure", "manage", or "oversee" without specifics is likely too vague — that's a governance tension.

**In assistant mode**, help users do both: recognize reactive tensions from their emotional signals, and guide them through proactive role reviews. **In role-filler mode**, build proactive tension discovery into your regular rhythm — it's how you keep your roles healthy and effective.

### Tension Workflow

1. **Create a tension** on the role that senses it, or on the circle for cross-role/governance/personal tensions: \`nestr_create_tension\` with a title describing the gap. Optionally include \`feeling\` and \`needs\` to capture the personal or organizational context. For personally sensed tensions (not from a specific role), add the \`individual-action\` label.

2. **Add proposal parts** using \`nestr_add_tension_part\`:
   - **New governance item**: Provide title and labels (e.g., \`["role"]\`, \`["policy"]\`). For roles, include accountabilities and/or domains as bulk shorthand.
   - **Change existing item**: Provide the \`_id\` of the existing governance item plus fields to change. When updating a role, if accountabilities/domains are not provided, existing children are auto-copied into the proposal.
   - **Remove existing item**: Use \`nestr_remove_tension_part\` to propose deletion of a governance item (when the part references an existing _id).

3. **Manage children individually** (optional): After adding a part that references an existing role, use the children tools for fine-grained control:
   - \`nestr_get_tension_part_children\` — List auto-copied accountabilities/domains
   - \`nestr_create_tension_part_child\` — Add a new accountability/domain
   - \`nestr_update_tension_part_child\` — Rename an existing one
   - \`nestr_delete_tension_part_child\` — Soft-delete one (removed from role when enacted)

4. **Review changes** with \`nestr_get_tension_changes\` to see the namespaced diff (what will actually change if accepted).

5. **Submit for voting** with \`nestr_update_tension_status\` set to \`"proposed"\`. This triggers the async consent process — circle members are notified and can accept or object.

6. **Monitor status** with \`nestr_get_tension_status\` to see per-user voting responses.

### Elections

Elections (assigning or re-assigning someone to a role) are processed as governance proposals:

1. Create a tension on the circle (e.g., "Elect Alice as Facilitator")
2. Add a part with the role's \`_id\` and \`users: ["newUserId"]\` to propose the assignment
3. Optionally set a \`due\` date for the re-election date
4. Submit for consent like any other governance proposal

### Questions and Reactions

Tensions support discussion through the standard comments API. Use \`nestr_add_comment\` with the **tension's nest ID** to post questions, reactions, or clarifications. Use \`nestr_get_comments\` to read the discussion. Comments on tensions are visible to all circle members.

### Examples

**Requesting work from another role (pathway 3 — request outcome):**
\`\`\`
// Place on the Sales Lead role — that role is sensing this tension
nestr_create_tension(salesLeadRoleId, {
  title: "Our clients can't access their data in a format they need",
  description: "Three enterprise clients have asked for MongoDB access this quarter. Currently we only expose data via REST API.",
  feeling: "Frustrated — I keep having to explain our limitations",
  needs: "Client autonomy in accessing their own data"
})
// → Operational: creates a project request for the Developer role
\`\`\`

**Proposing a new role with accountabilities (pathway 5 — governance):**
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

**Proposing changes to an existing role (using children for individual management):**
\`\`\`
1. nestr_create_tension(circleId, "Developer role needs infrastructure accountability")
2. nestr_add_tension_part(circleId, tensionId, {
     _id: "existingRoleId"
   })
   // → Existing accountabilities/domains are auto-copied into the proposal
3. nestr_get_tension_part_children(circleId, tensionId, partId)
   // → Returns all copied accountabilities/domains
4. nestr_create_tension_part_child(circleId, tensionId, partId, {
     title: "Managing infrastructure and deployments",
     labels: ["accountability"]
   })
   // → Adds a new accountability to the proposal
5. nestr_get_tension_changes(circleId, tensionId, partId) // Review the diff
6. nestr_update_tension_status(circleId, tensionId, "proposed")
\`\`\`

**Proposing changes to an existing role (bulk shorthand):**
\`\`\`
1. nestr_create_tension(circleId, "Developer role needs infrastructure accountability")
2. nestr_add_tension_part(circleId, tensionId, {
     _id: "existingRoleId",
     accountabilities: ["Developing new features", "Managing infrastructure and deployments"]
   })
   // → accountabilities array replaces ALL existing accountabilities at once
3. nestr_get_tension_changes(circleId, tensionId, partId) // Review the diff
4. nestr_update_tension_status(circleId, tensionId, "proposed")
\`\`\`

**Mixed pathways (operational + governance = separate tensions):**
\`\`\`
// Tension 1: Operational — request action from Developer role
nestr_create_tension(circleId, {
  title: "MongoDB integration needed for Q2 client deliverables",
  description: "Enterprise clients need direct data access. REST API is insufficient for their volume."
})

// Tension 2: Governance — if this is recurring, propose structural change
nestr_create_tension(circleId, {
  title: "No role accountable for data integration partnerships",
  description: "Client data access requests keep falling between roles."
})
// → Add governance part proposing new accountability
\`\`\`

### Status Lifecycle

\`draft\` → \`proposed\` → \`accepted\` or \`objected\`

- **draft**: Initial state. Parts can be added, modified, or removed.
- **proposed**: Submitted for consent. Circle members vote. Can be retracted back to \`draft\`.
- **accepted**: All members consented. Changes are applied to governance.
- **objected**: One or more members objected. Requires integration and resubmission.

**Tracking status:** Use \`nestr_get_tension_status\` to see the current lifecycle state and per-user voting responses with timestamps. Use \`nestr_update_tension_status\` to move a tension through its lifecycle (e.g., submit for consent or retract to draft).

### Auto-Detection

Tensions with governance labels (role, circle, policy, accountability, domain) in their parts automatically become governance proposals. Tensions without governance labels become output tensions (e.g., meeting outputs, operational decisions, inter-role requests).

### Tensions as Meeting Agenda Items

Tensions become meeting agenda items through graph links. Use \`nestr_add_graph_link\` with relation \`meeting\` to link a tension to a meeting.

**Which tensions are available for a meeting's agenda?** All non-completed tensions where the nearest circle ancestor matches the meeting's circle. The meeting type determines which tensions are relevant:

- **Governance meetings** (\`governance\` + \`meeting\` labels): Tensions with governance parts — proposals for new/changed roles, circles, accountabilities, domains, or policies. These are processed through Integrative Decision Making.
- **Circle meetings** (\`circle-meeting\` + \`meeting\` labels): Tensions with operational output — requests for information, projects, actions, or inter-role coordination. These drive the operational/tactical heartbeat.

**Linking tensions to meetings:**
\`\`\`
// Link a tension as an agenda item for a meeting
nestr_add_graph_link(tensionNestId, "meeting", meetingNestId)

// View a meeting's agenda (all linked tensions)
nestr_get_graph_links(meetingNestId, "meeting", { direction: "incoming" })

// See which meeting a tension is on
nestr_get_graph_links(tensionNestId, "meeting")

// Remove a tension from a meeting's agenda
nestr_remove_graph_link(tensionNestId, "meeting", meetingNestId)
\`\`\`

**Agenda items without a role source.** If a tension doesn't clearly originate from a specific role — for example, an ad-hoc discussion point or a freshly sensed tension that hasn't been anchored yet — create it as a child nest of the meeting directly (using \`nestr_create_nest\` with the meeting's ID as \`parentId\`). The graph link to the meeting is still needed. For tensions that DO originate from a specific role, create the tension on that role and link it to the meeting via the graph — this preserves provenance.
`.trim();
