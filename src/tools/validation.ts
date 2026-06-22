/**
 * Validation helpers for nest mutations.
 *
 * Prime labels define the core identity of a nest (e.g. `project`, `tension`,
 * `role`). Combining two of them on a single nest is technically possible via
 * the API but never semantically meaningful — a nest is either a project or a
 * tension, not both. We block these combinations at the MCP layer to coach the
 * model rather than enforcing it in the data layer.
 */

export const PRIME_LABELS: ReadonlySet<string> = new Set([
  "project",
  "tension",
  "role",
  "circle",
  "anchor-circle",
  "meeting",
  "metric",
  "goal",
  "result",
  "checklist",
  "feedback",
  // Scrum app labels — a nest is a story OR a sprint OR an epic OR a
  // milestone, never several at once. Stories relate to the containers via
  // graph links (userstory_sprint / userstory_epic / userstory_milestone),
  // not by sharing labels.
  "userstory",
  "sprint",
  "epic",
  "milestone",
]);

/**
 * Prime labels that imply another prime label in Nestr's data model.
 * `userstory` carries `implies: ['project']` server-side — every story IS a
 * project — so that pair may coexist on one nest. Sprint, epic and milestone
 * carry no such implication and must not be combined with `project`.
 */
export const PRIME_IMPLICATIONS: ReadonlyMap<string, string> = new Map([
  ["userstory", "project"],
]);

export class PrimeLabelConflictError extends Error {
  readonly conflicts: string[];

  constructor(conflicts: string[]) {
    const list = conflicts.map(l => `'${l}'`).join(", ");
    super(
      `Cannot combine prime labels [${list}] on a single nest. ` +
        `Prime labels define a nest's core identity — pick one, or create separate nests.`
    );
    this.name = "PrimeLabelConflictError";
    this.conflicts = conflicts;
  }
}

/** Returns the unique prime labels present in the given list. */
export function findPrimeLabels(labels: string[] | undefined): string[] {
  if (!labels?.length) return [];
  const seen = new Set<string>();
  for (const l of labels) {
    if (PRIME_LABELS.has(l)) seen.add(l);
  }
  return [...seen];
}

/**
 * Throws PrimeLabelConflictError if more than one prime label is present.
 * Prime labels implied by another present prime label don't count as
 * conflicts (e.g. `project` alongside `userstory`).
 */
export function validatePrimeLabels(labels: string[] | undefined): void {
  const prime = findPrimeLabels(labels);
  if (prime.length <= 1) return;
  const implied = new Set(prime.flatMap(l => PRIME_IMPLICATIONS.get(l) ?? []));
  const effective = prime.filter(l => !implied.has(l));
  if (effective.length > 1) {
    throw new PrimeLabelConflictError(prime);
  }
}

/**
 * Modifier labels that give a `meeting` nest a concrete type. A bare `meeting`
 * has no type and the web UI does not render it, so every meeting needs one.
 */
export const MEETING_MODIFIERS: ReadonlySet<string> = new Set([
  "circle-meeting",
  "governance",
]);

/**
 * Ensure a `meeting` nest carries a modifier the UI can render. When `meeting`
 * is present without `circle-meeting` or `governance`, default to
 * `circle-meeting` (a tactical/operational meeting). Returns the labels
 * unchanged when there is no `meeting` label or a modifier is already present.
 */
export function ensureMeetingModifier(labels: string[] | undefined): string[] | undefined {
  if (!labels?.includes("meeting")) return labels;
  if (labels.some(l => MEETING_MODIFIERS.has(l))) return labels;
  return [...labels, "circle-meeting"];
}
