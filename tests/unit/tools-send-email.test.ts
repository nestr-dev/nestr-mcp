import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { handleToolCall, toolDefinitions } from "../../src/tools/index.js";
import { NestrClient } from "../../src/api/client.js";

function mockResponse(status: number, body: unknown) {
  return {
    ok: status < 400,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

// The tool only names people and, for a forward, the message: Nestr resolves the
// recipients and fetches the original itself, so no address and no message bytes
// ever pass through the model.
describe("nestr_send_email", () => {
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

  const call = async (args: Record<string, unknown>, data: Record<string, unknown> = { sent: ["u1"], skipped: [] }) => {
    mockFetch.mockResolvedValue(mockResponse(200, { status: "success", data }));
    return handleToolCall(client, "nestr_send_email", args);
  };

  it("posts the recipients, subject, body and forward to the agent email route", async () => {
    const result = await call({
      to: ["u1", "role1"],
      subject: "Invoice",
      body: "For you",
      forward: { connectionId: "c1", messageId: "m1" },
    });
    expect(result.isError).toBeFalsy();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.test.io/api/agents/runs/email");
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body)).toEqual({
      to: ["u1", "role1"],
      subject: "Invoice",
      body: "For you",
      forward: { connectionId: "c1", messageId: "m1" },
    });
  });

  it("says who was sent to and that some were skipped", async () => {
    const result = await call(
      { to: ["u1", "u2"], subject: "Hi", body: "x" },
      { sent: ["u1"], skipped: [{ id: "u2", reason: "opted-out" }] },
    );
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.message).toBe("Sent to 1 person. 1 skipped; see skipped for who and why.");
    expect(parsed.skipped).toEqual([{ id: "u2", reason: "opted-out" }]);
  });

  it("tells the agent when the original was too large to attach", async () => {
    const result = await call(
      { to: ["u1"], subject: "Fwd", forward: { connectionId: "c1", messageId: "m1" } },
      { sent: ["u1"], skipped: [], attachmentOmitted: "too-large" },
    );
    expect(JSON.parse(result.content[0].text).message).toContain("too large to attach");
  });

  it("refuses an empty recipient list before calling Nestr", async () => {
    const result = await handleToolCall(client, "nestr_send_email", { to: [], subject: "x", body: "y" });
    expect(result.isError).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("refuses a call with neither a body nor a forward before calling Nestr", async () => {
    const result = await handleToolCall(client, "nestr_send_email", { to: ["u1"], subject: "x" });
    expect(result.isError).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("accepts a forward without a body", async () => {
    const result = await call({ to: ["u1"], subject: "Fwd", forward: { connectionId: "c1", messageId: "m1" } });
    expect(result.isError).toBeFalsy();
  });

  it("surfaces Nestr's refusal", async () => {
    mockFetch.mockResolvedValue(mockResponse(403, {
      status: "error",
      message: "Agent email is switched off in this workspace.",
    }));
    const result = await handleToolCall(client, "nestr_send_email", { to: ["u1"], subject: "x", body: "y" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("switched off");
  });

  it("forwards without a connection id, leaving the choice of mailbox to Nestr", async () => {
    const result = await call({ to: ["u1"], subject: "Fwd", forward: { messageId: "m1" } });
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(mockFetch.mock.calls[0][1].body).forward).toEqual({ messageId: "m1" });
    const def = toolDefinitions.find((t) => t.name === "nestr_send_email");
    expect((def!.inputSchema.properties.forward as { required: string[] }).required).toEqual(["messageId"]);
  });

  // A repeat after a timeout is not a failure: the people listed already got it.
  it("tells the agent who already had the email, so it does not send again", async () => {
    const result = await call(
      { to: ["u1"], subject: "Hi", body: "x" },
      { sent: [], alreadySent: ["u1"], skipped: [] },
    );
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.message).toContain("1 already had this email");
    expect(parsed.alreadySent).toEqual(["u1"]);
  });

  // Nestr may fetch the original and mail several people in one call, so this
  // request waits longer than the 30 s every other call gets.
  it("waits longer than other calls for Nestr to finish sending", async () => {
    const spy = vi.spyOn(AbortSignal, "timeout");
    await call({ to: ["u1"], subject: "Hi", body: "x" });
    expect(spy).toHaveBeenCalledWith(90000);
    spy.mockRestore();
  });

  it("is advertised as a write with no address parameter", () => {
    const def = toolDefinitions.find((t) => t.name === "nestr_send_email");
    expect(def).toBeDefined();
    expect(def!.annotations?.readOnlyHint).toBe(false);
    expect(Object.keys(def!.inputSchema.properties)).toEqual(["to", "subject", "body", "forward"]);
  });
});
