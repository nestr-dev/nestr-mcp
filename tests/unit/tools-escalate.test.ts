import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { handleToolCall } from "../../src/tools/index.js";
import { NestrClient } from "../../src/api/client.js";

function mockResponse(status: number, body: unknown) {
  return {
    ok: status < 400,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

// Escalating and then saying "a human is coming" is one message too many when Nestr has
// already posted its own confirmation into the thread. The tool always asks for silence
// and reads the answer, rather than assuming either way.
describe("nestr_escalate_to_support", () => {
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

  const escalate = async (data: Record<string, unknown>) => {
    mockFetch.mockResolvedValue(mockResponse(200, { status: "success", data }));
    const result = await handleToolCall(client, "nestr_escalate_to_support", {
      threadId: "t1",
      reason: "they asked for a person",
    });
    expect(result.isError).toBeFalsy();
    return JSON.parse(result.content[0].text) as { message: string };
  };

  it("asks for the confirmation to be left out, and sends the reason with it", async () => {
    await escalate({ queueKey: "support", statusMessagePosted: false });

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.test.io/api/users/me/dm/t1/escalate");
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body)).toEqual({
      suppressStatusMessage: true,
      reason: "they asked for a person",
    });
  });

  it("tells the caller to say a human is coming when the thread was left silent", async () => {
    const parsed = await escalate({ queueKey: "support", statusMessagePosted: false });
    expect(parsed.message).toContain("Tell them so");
  });

  it("tells the caller not to repeat it when Nestr posted the confirmation anyway", async () => {
    const parsed = await escalate({ queueKey: "support", statusMessagePosted: true });
    expect(parsed.message).toContain("Do not repeat it");
  });

  it("still says nothing more is needed for a thread already in the queue", async () => {
    const parsed = await escalate({ queueKey: "support", alreadyQueued: true, statusMessagePosted: false });
    expect(parsed.message).toContain("Already with a human");
  });
});
