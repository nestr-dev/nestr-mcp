import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Redis } from "ioredis";
import { RedisStore } from "../../src/oauth/redis-store.js";
import type { RegisteredClient } from "../../src/oauth/store.js";

const DAY_MS = 86400 * 1000;

/**
 * Minimal in-memory stand-in for the ioredis commands the client methods use.
 * Expiry is evaluated against Date.now(), so vi fake timers drive it.
 */
function createFakeRedis() {
  const strings = new Map<string, { value: string; expiresAt: number }>();
  const zsets = new Map<string, Map<string, number>>();

  const live = (key: string) => {
    const entry = strings.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      strings.delete(key);
      return undefined;
    }
    return entry;
  };

  return {
    async set(key: string, value: string, _ex: "EX", seconds: number) {
      strings.set(key, { value, expiresAt: Date.now() + seconds * 1000 });
      return "OK";
    },
    async get(key: string) {
      return live(key)?.value ?? null;
    },
    async getex(key: string, _ex: "EX", seconds: number) {
      const entry = live(key);
      if (!entry) return null;
      entry.expiresAt = Date.now() + seconds * 1000;
      return entry.value;
    },
    async exists(key: string) {
      return live(key) ? 1 : 0;
    },
    async zadd(key: string, score: number, member: string) {
      if (!zsets.has(key)) zsets.set(key, new Map());
      zsets.get(key)!.set(member, score);
      return 1;
    },
    async zremrangebyscore(key: string, _min: "-inf", max: number) {
      const set = zsets.get(key);
      if (!set) return 0;
      let removed = 0;
      for (const [member, score] of set) {
        if (score <= max) {
          set.delete(member);
          removed++;
        }
      }
      return removed;
    },
    async zcard(key: string) {
      return zsets.get(key)?.size ?? 0;
    },
  };
}

function client(id: string): RegisteredClient {
  return {
    client_id: id,
    client_name: "Test client",
    redirect_uris: ["https://example.com/callback"],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    registered_at: Date.now(),
  };
}

describe("RedisStore client registrations", () => {
  let store: RedisStore;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    vi.spyOn(console, "log").mockImplementation(() => {});
    store = new RedisStore(createFakeRedis() as unknown as Redis);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("keeps a client registered well past a day", async () => {
    await store.registerClient(client("mcp-a"));

    vi.advanceTimersByTime(2 * DAY_MS);

    expect(await store.getClient("mcp-a")).toMatchObject({ client_id: "mcp-a" });
  });

  it("resets the expiry on every lookup, so a client in use never expires", async () => {
    await store.registerClient(client("mcp-a"));

    for (let i = 0; i < 4; i++) {
      vi.advanceTimersByTime(60 * DAY_MS);
      expect(await store.getClient("mcp-a")).toBeDefined();
    }
  });

  it("expires a client nobody has used for 90 days", async () => {
    await store.registerClient(client("mcp-a"));

    vi.advanceTimersByTime(91 * DAY_MS);

    expect(await store.getClient("mcp-a")).toBeUndefined();
    expect(await store.clientExists("mcp-a")).toBe(false);
  });

  it("counts only live clients, so the count drops as registrations expire", async () => {
    await store.registerClient(client("mcp-a"));
    vi.advanceTimersByTime(30 * DAY_MS);
    await store.registerClient(client("mcp-b"));
    expect(await store.getClientCount()).toBe(2);

    vi.advanceTimersByTime(61 * DAY_MS);
    expect(await store.getClientCount()).toBe(1);

    vi.advanceTimersByTime(30 * DAY_MS);
    expect(await store.getClientCount()).toBe(0);
  });

  it("keeps a used client in the count after its original expiry", async () => {
    await store.registerClient(client("mcp-a"));
    vi.advanceTimersByTime(80 * DAY_MS);
    await store.getClient("mcp-a");

    vi.advanceTimersByTime(20 * DAY_MS);

    expect(await store.getClientCount()).toBe(1);
  });
});
