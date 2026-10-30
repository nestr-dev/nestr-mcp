import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  handleToolCall,
  toolDefinitions,
  schemas,
  READONLY_TOOL_NAMES,
} from '../../src/tools/index.js';
import { NestrClient } from '../../src/api/client.js';
import { TENSION_PROCESSING_INSTRUCTIONS } from '../../src/skills/tension-processing.js';

// An agent that fills a role is a voter on every tension proposed in its circle,
// and until this tool it had no way to answer: nestr_update_tension_status moves
// a tension through its lifecycle on behalf of whoever raised it, and its enum
// stops at `proposed` and `draft`.

function mockResponse(status: number, body: unknown) {
  return {
    ok: status < 400,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

const parseResult = (text: string): Record<string, unknown> => JSON.parse(text);

const voteBody = (decision: string) => ({
  status: 'success',
  data: { status: decision, message: `Vote recorded: ${decision}` },
});

describe('nestr_vote_on_tension', () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  let client: NestrClient;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
    client = new NestrClient({ apiKey: 'test-token', baseUrl: 'https://api.test.io/api' });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // The REST status route is the only write path for a decision, and it spells
  // the two answers `accepted` and `escalated`. The tool speaks the domain's
  // words and translates, so a model never has to guess that objecting is
  // spelled "escalated".
  it('consent PATCHes the status route with accepted', async () => {
    mockFetch.mockResolvedValue(mockResponse(200, voteBody('accepted')));
    const result = await handleToolCall(client, 'nestr_vote_on_tension', {
      nestId: 'circle-1',
      tensionId: 'ten-1',
      decision: 'consent',
    });
    expect(result.isError).toBeFalsy();

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('https://api.test.io/api/nests/circle-1/tensions/ten-1/status');
    expect(opts.method).toBe('PATCH');
    expect(JSON.parse(opts.body)).toEqual({ status: 'accepted' });
  });

  it('object PATCHes the status route with escalated', async () => {
    mockFetch.mockResolvedValue(mockResponse(200, voteBody('escalated')));
    const result = await handleToolCall(client, 'nestr_vote_on_tension', {
      nestId: 'circle-1',
      tensionId: 'ten-1',
      decision: 'object',
    });
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({ status: 'escalated' });
  });

  it('reports back what was recorded', async () => {
    mockFetch.mockResolvedValue(mockResponse(200, voteBody('accepted')));
    const result = await handleToolCall(client, 'nestr_vote_on_tension', {
      nestId: 'circle-1',
      tensionId: 'ten-1',
      decision: 'consent',
    });
    const parsed = parseResult(result.content[0].text);
    expect(parsed.message).toMatch(/consent/i);
    expect(parsed.decision).toBe('consent');
  });

  // An objection ends the round and has to carry its reason, so the tool says so
  // rather than leaving the run to discover it from the proposer later.
  it('tells the caller an objection needs its reason stated', async () => {
    mockFetch.mockResolvedValue(mockResponse(200, voteBody('escalated')));
    const result = await handleToolCall(client, 'nestr_vote_on_tension', {
      nestId: 'circle-1',
      tensionId: 'ten-1',
      decision: 'object',
    });
    const parsed = parseResult(result.content[0].text);
    expect(String(parsed.message)).toMatch(/reason|why|comment/i);
  });

  it('refuses a decision that is neither answer, without calling the API', async () => {
    const result = await handleToolCall(client, 'nestr_vote_on_tension', {
      nestId: 'circle-1',
      tensionId: 'ten-1',
      decision: 'abstain',
    });
    expect(result.isError).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // The decision cannot be recorded for anyone but the caller: there is no
  // parameter for a user, deliberately, because the server derives the consenter
  // from the bearer token and an `onBehalfOf` here would invite one.
  it('takes no user parameter, so it can only ever answer as the caller', () => {
    const def = toolDefinitions.find((t) => t.name === 'nestr_vote_on_tension');
    expect(def).toBeDefined();
    const props = Object.keys(def!.inputSchema.properties ?? {});
    expect(props.sort()).toEqual(['decision', 'nestId', 'tensionId']);
    expect(Object.keys(schemas.voteOnTension.shape).sort()).toEqual([
      'decision',
      'nestId',
      'tensionId',
    ]);
  });

  // The description must not predict server behaviour whose truth depends on
  // which web release is deployed. It once said a workspace API key "is refused",
  // which only becomes true with nestr-web#2547; merged first, it would have told
  // a model its key was safe while the route still recorded the key creator's
  // consent. It states the rule the caller controls instead.
  it("tells the caller to use a person's token without predicting the server's refusal", () => {
    const def = toolDefinitions.find((t) => t.name === 'nestr_vote_on_tension');
    expect(def!.description).toMatch(/token that identifies one person/i);
    expect(def!.description).not.toMatch(/is refused/i);
  });

  // Recording a decision changes the world, so the read-only surface must not
  // advertise it. READONLY_TOOL_NAMES is derived from the annotation.
  it('is a write, and absent from the read-only surface', () => {
    expect(READONLY_TOOL_NAMES.has('nestr_vote_on_tension')).toBe(false);
  });

  // A 403 is how the server refuses a caller who is not a voter, or a token with
  // nobody's consent to record. It must surface, not be swallowed.
  it("surfaces the server's refusal rather than reporting success", async () => {
    mockFetch.mockResolvedValue(
      mockResponse(403, { message: 'You are not a voter on this tension' }),
    );
    const result = await handleToolCall(client, 'nestr_vote_on_tension', {
      nestId: 'circle-1',
      tensionId: 'ten-1',
      decision: 'consent',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/not a voter/i);
  });
});

describe('the lifecycle tool points at the new one', () => {
  // Its description said resolution does not happen through a tool at all. It
  // does now, and leaving that sentence standing would send a voter to the app.
  it('names nestr_vote_on_tension as how a decision is recorded', () => {
    const def = toolDefinitions.find((t) => t.name === 'nestr_update_tension_status');
    expect(def!.description).toContain('nestr_vote_on_tension');
    // Still not something THIS tool does, and its enum is unchanged.
    expect(
      (def!.inputSchema.properties as Record<string, { enum?: unknown[] }>).status.enum,
    ).toEqual(['proposed', 'draft']);
  });

  it('the tension-processing skill says how to answer a consent request', () => {
    expect(TENSION_PROCESSING_INSTRUCTIONS).toContain('nestr_vote_on_tension');
  });
});
