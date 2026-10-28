import {
  describe, it, expect, vi, beforeEach, afterEach,
} from "vitest";
import {
  enrichHints,
  handleToolCall,
  HINT_TYPE_GUIDANCE,
  INSTRUCTION_APPROVAL_NOTE,
  withInstructionApprovalNotes,
  writeEnvelopeHints,
} from "../../src/tools/index.js";
import { NestrClient } from "../../src/api/client.js";
import { HELP_TOPICS } from "../../src/help/topics.js";

// A role connector held back on scheduled runs until someone in its audience approves the
// role's latest instructions. From the outside that looks like a broken connection, and the
// obvious follow-ups (reconnect as anyone, change the connector, approve as the agent) are
// wrong, so these pin that the model is told what does release it, on every surface.

const awaitingHint = () => {
  return {
    type: "connector_awaiting_instruction_approval",
    severity: "warning",
    label: "Gmail is paused for scheduled runs until someone it is shared with approves this role's latest instructions. Manual runs still work. Approving, or reconnecting it as someone it is shared with, releases it.",
    detail: "The credential is fine: ...",
    count: 1,
    url: "https://app.nestr.io/n/role1?comment=c1",
    connectors: [{
      connectionId: "conn1",
      name: "Gmail",
      nestId: "role1",
      nestTitle: "Outreach",
      askedAt: "2026-10-01T09:00:00.000Z",
      commentUrl: "/n/role1?comment=c1",
      approvers: ["A teammate"],
      reconnectApproves: "when-in-audience",
    }],
  };
};

const pausedHint = () => {
  return {
    type: "connector_paused_by_instruction_edit",
    severity: "warning",
    label: "This edit means Gmail will pause on scheduled runs of Outreach until someone it is shared with approves the instructions; tell the person you're helping. Manual runs still work, and approving or reconnecting it as someone it is shared with releases it.",
    detail: "The edit was saved. ...",
    connectors: [{
      connectionId: "conn1", name: "Gmail", roleNestId: "role1", roleTitle: "Outreach",
    }],
  };
};

function mockResponse(status: number, body: unknown) {
  return {
    ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body),
  };
}

describe("connector_awaiting_instruction_approval on a nest read", () => {
  it("makes a relative hint url clickable too", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const enriched: any = enrichHints({
      _id: "role1", ancestors: ["ws1"], hints: [{ ...awaitingHint(), url: "/n/role1?unblock=1" }],
    });
    expect(enriched.hints[0].url).toMatch(/^https?:\/\/[^/]+\/n\/role1\?unblock=1$/);
  });

  it("passes the connectors through and adds guidance that survives summary level", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const enriched: any = enrichHints({ _id: "role1", ancestors: ["ws1"], hints: [awaitingHint()] });
    const hint = enriched.hints[0];
    expect(hint.connectors[0]).toMatchObject({
      name: "Gmail", approvers: ["A teammate"], reconnectApproves: "when-in-audience",
    });
    expect(hint.url).toBe("https://app.nestr.io/n/role1?comment=c1");
    // The API sends the per-connector link as an app path; it reaches the model clickable.
    expect(hint.connectors[0].commentUrl).toMatch(/^https?:\/\/[^/]+\/n\/role1\?comment=c1$/);
    expect(hint.guidance).toBe(HINT_TYPE_GUIDANCE.connector_awaiting_instruction_approval);
    // The page link is for a person: no tool call is invented, and it is not logged as a gap.
    expect(hint.toolCall).toBeUndefined();
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it("guidance says who can release it, how, and what does not help", () => {
    const text = HINT_TYPE_GUIDANCE.connector_awaiting_instruction_approval;
    expect(text).toContain("credential is fine");
    expect(text).toContain("settings will not help");
    expect(text).toContain("workspace admin");
    expect(text).toMatch(/reconnect by someone it is shared with also counts/);
    expect(text).toContain("You cannot approve on anyone's behalf");
    expect(text).toContain("re-runs the paused run");
  });

  it("nestr_explain_nest asks for it, so a held-back connector shows up there", async () => {
    const mockFetch = vi.fn().mockResolvedValue(mockResponse(200, {
      _id: "role1", ancestors: ["ws1"], hints: [awaitingHint()],
    }));
    vi.stubGlobal("fetch", mockFetch);
    const client = new NestrClient({ apiKey: "test-token", baseUrl: "https://api.test.io/api" });
    const result = await handleToolCall(client, "nestr_explain_nest", { nestId: "role1" });
    vi.unstubAllGlobals();
    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain("hints=full");
    expect(url).toContain("hintTypes=connector_awaiting_instruction_approval");
    const body = JSON.parse(result.content[0].text);
    expect(body.hints[0].guidance).toContain("Only a PERSON releases it");
  });
});

describe("connector_paused_by_instruction_edit on an update", () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  let client: NestrClient;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    client = new NestrClient({ apiKey: "test-token", baseUrl: "https://api.test.io/api" });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("lifts the hint out of the envelope and says to tell the person", async () => {
    mockFetch.mockResolvedValue(mockResponse(200, {
      status: "success", data: { _id: "skill1", title: "New text" }, hints: [pausedHint()],
    }));
    const result = await handleToolCall(client, "nestr_update_nest", {
      nestId: "skill1", description: "New text",
    });
    expect(result.isError).toBeFalsy();
    const body = JSON.parse(result.content[0].text);
    expect(body._id).toBe("skill1");
    expect(body.message).toContain("tell the person you are helping");
    expect(body.tellThePerson).toBe(pausedHint().label);
    expect(body.hints[0].type).toBe("connector_paused_by_instruction_edit");
    expect(body.hints[0].connectors[0].roleTitle).toBe("Outreach");
    expect(body.hints[0].guidance).toBe(HINT_TYPE_GUIDANCE.connector_paused_by_instruction_edit);
    // Lifted, not duplicated.
    expect(body.nest.hints).toBeUndefined();
    expect(body.nest.data._id).toBe("skill1");
  });

  it("leaves an update with no write hints as it was", async () => {
    mockFetch.mockResolvedValue(mockResponse(200, { status: "success", data: { _id: "n1" } }));
    const result = await handleToolCall(client, "nestr_update_nest", { nestId: "n1", title: "x" });
    const body = JSON.parse(result.content[0].text);
    expect(body.message).toBe("Nest updated successfully");
    expect(body.tellThePerson).toBeUndefined();
    expect(body.hints).toBeUndefined();
  });

  it("does not lift a bare nest's own hints, which are about the nest", () => {
    const nest = { _id: "n1", hints: [{ type: "no_purpose", label: "x", severity: "warning" }] };
    expect(writeEnvelopeHints(nest)).toEqual({ rest: nest });
  });
});

describe("pendingInstructionApprovals on nestr_list_connections", () => {
  const row = (pending: unknown[]) => {
    return {
      connectionId: "conn1",
      connectorName: "Gmail",
      owner: { type: "role-domain", id: "dom1" },
      authorizations: [],
      pendingInstructionApprovals: pending,
    };
  };

  it("adds the note and an absolute comment link to rows that are waiting", () => {
    const [out]: any = withInstructionApprovalNotes([row([{
      nestId: "role1", nestTitle: "Outreach", askedAt: "2026-10-01T09:00:00.000Z",
      commentPath: "/n/role1?comment=c1", canApprove: false,
    }])]);
    expect(out.instructionApprovalNote).toBe(INSTRUCTION_APPROVAL_NOTE);
    expect(out.pendingInstructionApprovals[0].commentUrl).toMatch(/^https?:\/\/[^/]+\/n\/role1\?comment=c1$/);
    expect(out.pendingInstructionApprovals[0].canApprove).toBe(false);
  });

  it("keeps an already absolute commentUrl and leaves rows with nothing waiting alone", () => {
    const waiting = row([{ nestId: "r", askedAt: null, commentUrl: "https://app.example/n/r?comment=c" }]);
    const idle = row([]);
    const [a, b]: any = withInstructionApprovalNotes([waiting, idle]);
    expect(a.pendingInstructionApprovals[0].commentUrl).toBe("https://app.example/n/r?comment=c");
    expect(b).toBe(idle);
  });

  it("the note names who releases it and that an agent cannot", () => {
    expect(INSTRUCTION_APPROVAL_NOTE).toContain("workspace admin");
    expect(INSTRUCTION_APPROVAL_NOTE).toContain("reconnects it");
    expect(INSTRUCTION_APPROVAL_NOTE).toContain("an agent cannot approve");
    expect(INSTRUCTION_APPROVAL_NOTE).toContain("will not release it");
  });

  it("the tool applies it", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse(200, {
      status: "success",
      data: [row([{ nestId: "role1", askedAt: null, commentPath: "/n/role1?comment=c1" }])],
    })));
    const client = new NestrClient({ apiKey: "test-token", baseUrl: "https://api.test.io/api" });
    const result = await handleToolCall(client, "nestr_list_connections", { workspaceId: "ws1" });
    vi.unstubAllGlobals();
    const [first] = JSON.parse(result.content[0].text);
    expect(first.instructionApprovalNote).toBe(INSTRUCTION_APPROVAL_NOTE);
  });
});

describe("help", () => {
  it("documents both hint types and has a topic for them", () => {
    expect(HELP_TOPICS["nest-model"]).toContain("connector_awaiting_instruction_approval");
    expect(HELP_TOPICS["nest-model"]).toContain("connector_paused_by_instruction_edit");
    expect(HELP_TOPICS.topics).toContain("- connector-instruction-approval:");
    const topic = HELP_TOPICS["connector-instruction-approval"];
    expect(topic).toContain("An agent cannot approve on a person's behalf");
    expect(topic).toContain("pendingInstructionApprovals");
    expect(topic).toContain("when-in-audience");
  });
});
