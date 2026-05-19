import { describe, it, expect } from "vitest";
import {
  PRIME_LABELS,
  PrimeLabelConflictError,
  findPrimeLabels,
  validatePrimeLabels,
} from "../../src/tools/validation.js";

describe("PRIME_LABELS", () => {
  it("contains the documented prime labels", () => {
    const expected = [
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
    ];
    for (const label of expected) {
      expect(PRIME_LABELS.has(label)).toBe(true);
    }
    expect(PRIME_LABELS.size).toBe(expected.length);
  });
});

describe("findPrimeLabels", () => {
  it("returns empty array for undefined or empty input", () => {
    expect(findPrimeLabels(undefined)).toEqual([]);
    expect(findPrimeLabels([])).toEqual([]);
  });

  it("returns empty array when no prime labels present", () => {
    expect(findPrimeLabels(["governance", "circle-meeting", "skill"])).toEqual([]);
  });

  it("returns the single prime label when only one is present", () => {
    expect(findPrimeLabels(["project", "individual-action"])).toEqual(["project"]);
  });

  it("returns multiple distinct prime labels", () => {
    const result = findPrimeLabels(["project", "tension", "skill"]);
    expect(result.sort()).toEqual(["project", "tension"]);
  });

  it("deduplicates the same prime label appearing twice", () => {
    expect(findPrimeLabels(["project", "project"])).toEqual(["project"]);
  });
});

describe("validatePrimeLabels", () => {
  it("does not throw for undefined or empty input", () => {
    expect(() => validatePrimeLabels(undefined)).not.toThrow();
    expect(() => validatePrimeLabels([])).not.toThrow();
  });

  it("does not throw when zero or one prime label is present", () => {
    expect(() => validatePrimeLabels(["governance", "skill"])).not.toThrow();
    expect(() => validatePrimeLabels(["project"])).not.toThrow();
    expect(() => validatePrimeLabels(["meeting", "governance"])).not.toThrow();
  });

  it("does not throw when the same prime label is duplicated", () => {
    expect(() => validatePrimeLabels(["project", "project"])).not.toThrow();
  });

  it("throws PrimeLabelConflictError when two prime labels are combined", () => {
    expect(() => validatePrimeLabels(["project", "tension"])).toThrow(PrimeLabelConflictError);
  });

  it("error names both conflicting labels", () => {
    try {
      validatePrimeLabels(["role", "circle"]);
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(PrimeLabelConflictError);
      const conflictErr = err as PrimeLabelConflictError;
      expect(conflictErr.conflicts.sort()).toEqual(["circle", "role"]);
      expect(conflictErr.message).toContain("role");
      expect(conflictErr.message).toContain("circle");
    }
  });

  it("throws when three prime labels are combined", () => {
    expect(() => validatePrimeLabels(["project", "tension", "meeting"])).toThrow(
      PrimeLabelConflictError
    );
  });
});
