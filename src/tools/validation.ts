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

/** Throws PrimeLabelConflictError if more than one prime label is present. */
export function validatePrimeLabels(labels: string[] | undefined): void {
  const prime = findPrimeLabels(labels);
  if (prime.length > 1) {
    throw new PrimeLabelConflictError(prime);
  }
}
