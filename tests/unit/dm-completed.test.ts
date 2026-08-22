import { describe, it, expect } from "vitest";
import { schemas } from "../../src/tools/index.js";

// Closing a conversation is the one DM field whose *absence* means something different
// from any value it can take: null reopens, true closes, and not sending it leaves the
// state alone. A boolean schema alone cannot say that, so both halves are pinned here.
describe("closing a conversation through the tools", () => {
  it("accepts true, null, and neither", () => {
    expect(schemas.updateDMThread.parse({ threadId: "t1", completed: true }).completed).toBe(true);
    expect(schemas.updateDMThread.parse({ threadId: "t1", completed: null }).completed).toBe(null);
    expect(schemas.updateDMThread.parse({ threadId: "t1", title: "x" }).completed).toBe(undefined);
  });

  it("refuses a value that is neither", () => {
    expect(() => schemas.updateDMThread.parse({ threadId: "t1", completed: "yes" })).toThrow();
  });

  it("takes the participant list as a nest does, not an add/remove pair", () => {
    // A DM thread is a nest, so it takes the nest's vocabulary: `users` is the list you
    // want. addUsers/removeUsers were a second way to say the same thing.
    expect(schemas.updateDMThread.parse({ threadId: "t1", users: ["u1", "u2"] }).users)
      .toEqual(["u1", "u2"]);
    expect(schemas.updateDMThread.parse({ threadId: "t1", title: "x" }).users).toBe(undefined);
  });

  it("takes includeCompleted on the listing, and leaves it off by default", () => {
    expect(schemas.listDMs.parse({ includeCompleted: true }).includeCompleted).toBe(true);
    expect(schemas.listDMs.parse({}).includeCompleted).toBe(undefined);
  });
});
