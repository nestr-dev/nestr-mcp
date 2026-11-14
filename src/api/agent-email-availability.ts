/**
 * Whether this session may list nestr_send_email.
 *
 * The tool only works for a live agent run of a workspace that has "Agents may
 * email members" switched on: Nestr's POST /agents/runs/email refuses any other
 * bearer. An outside client (an OAuth user in Claude Code or claude.ai, an API
 * key) and an agent in a workspace with the setting off would only ever see a
 * refusal, so the tool is not listed for them.
 *
 * Nestr answers the question itself (GET /agents/runs/email, same check as the
 * send), because the MCP cannot tell a run's dispatch token from any other
 * bearer. Fails closed: if the answer is anything but a plain yes, the tool is
 * hidden. The send stays gated server-side either way, so hiding is a nicety and
 * never the security boundary.
 */
export const AGENT_EMAIL_TOOL = "nestr_send_email";

export function withoutAgentEmail<T extends { name: string }>(tools: T[]): T[] {
  return tools.filter((t) => t.name !== AGENT_EMAIL_TOOL);
}

/**
 * One answer per session, asked on the first tools/list. A run is short and its
 * workspace setting rarely changes mid-run, so no list_changed notification is
 * sent; a session that started while the setting was off sees the tool from its
 * next session on. A failed lookup is not remembered, so a transient error only
 * hides the tool for that one listing.
 */
export function agentEmailGate(client: { isAgentEmailAvailable: () => Promise<boolean> }) {
  let answer: boolean | undefined;
  return async (): Promise<boolean> => {
    if (answer !== undefined) return answer;
    try {
      answer = (await client.isAgentEmailAvailable()) === true;
      return answer;
    } catch {
      return false;
    }
  };
}
