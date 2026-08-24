import { describe, it, expect } from "vitest";
import { handleToolCall } from "../../src/tools/index.js";

const client = {} as never; // never reached: the gate refuses before any API call

describe("read-only gate", () => {
  it("refuses a write tool with AUTH_SCOPE_INSUFFICIENT", async () => {
    const res = await handleToolCall(client, "nestr_update_nest", { nestId: "x" }, { isReadOnly: true });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("AUTH_SCOPE_INSUFFICIENT");
    expect(res.content[0].text).toContain("read-only");
  });

  it("refuses an unannotated write tool", async () => {
    const res = await handleToolCall(client, "nestr_delete_tension_part_child", {}, { isReadOnly: true });
    expect(res.isError).toBe(true);
  });

  it("does not refuse a read tool", async () => {
    // Reaches the real handler, so it fails on the stub client rather than on the gate.
    const res = await handleToolCall(client, "nestr_get_nest", { nestId: "x" }, { isReadOnly: true });
    expect(String(res.content[0].text)).not.toContain("AUTH_SCOPE_INSUFFICIENT");
  });
});
