import { describe, it, expect } from "vitest";
import { translateEndpoint } from "../../src/tools/index.js";

describe("DM hint endpoints translate to tool calls", () => {
  it("maps the unread-threads hint, keeping the filter", () => {
    // Without the query the suggested call would list every thread, which is the
    // opposite of what a hint saying "3 you have not read" is for.
    const call = translateEndpoint({
      purpose: "List just those threads",
      method: "GET",
      path: "/api/users/me/dm?unread=true",
    } as never);
    expect(call?.tool).toBe("nestr_list_dms");
    expect(call?.parametersExample).toEqual({ unread: true });
  });

  it("maps the thread's unread-posts hint", () => {
    const call = translateEndpoint({
      purpose: "Read just those posts",
      method: "GET",
      path: "/api/users/me/dm/t1/posts?unread=true",
    } as never);
    expect(call?.tool).toBe("nestr_get_dm_posts");
    expect(call?.parametersExample).toEqual({ threadId: "t1", unread: true });
  });

  it("maps the read acknowledgement, which is not DM-specific", () => {
    const call = translateEndpoint({
      purpose: "Mark everything up to the newest of them as read",
      method: "POST",
      path: "/api/posts/p9/read",
    } as never);
    expect(call?.tool).toBe("nestr_mark_post_read");
    expect(call?.parametersExample).toEqual({ postId: "p9" });
  });

  it("keeps GET and PATCH on a thread apart", () => {
    const get = translateEndpoint({ method: "GET", path: "/api/users/me/dm/t1" } as never);
    const patch = translateEndpoint({ method: "PATCH", path: "/api/users/me/dm/t1" } as never);
    expect(get?.tool).toBe("nestr_get_dm_thread");
    expect(patch?.tool).toBe("nestr_update_dm_thread");
  });

  it("keeps a listing and a thread apart at the same depth", () => {
    // /dm and /dm/{t} differ by one segment now that threads sit directly under it.
    const list = translateEndpoint({ method: "GET", path: "/api/users/me/dm" } as never);
    const thread = translateEndpoint({ method: "GET", path: "/api/users/me/dm/t1" } as never);
    const start = translateEndpoint({ method: "POST", path: "/api/users/me/dm" } as never);
    expect(list?.tool).toBe("nestr_list_dms");
    expect(thread?.tool).toBe("nestr_get_dm_thread");
    expect(start?.tool).toBe("nestr_start_dm_thread");
  });

  it("emits the tool's parameter name, not the URL's", () => {
    // The route spells it ?user=, the tool calls it withUser. Emitting the URL's
    // spelling would produce a call the tool's own schema rejects.
    const call = translateEndpoint({
      method: "GET",
      path: "/api/users/me/dm?user=nestr_support",
    } as never);
    expect(call?.tool).toBe("nestr_list_dms");
    expect(call?.parametersExample).toEqual({ withUser: "nestr_support" });
  });

  it("does not let a deeper route fall through to a shallower one", () => {
    // /dm/{t}/posts must not be read as /dm/{t} with a stray segment.
    const posts = translateEndpoint({ method: "GET", path: "/api/users/me/dm/t1/posts" } as never);
    const thread = translateEndpoint({ method: "GET", path: "/api/users/me/dm/t1" } as never);
    expect(posts?.tool).toBe("nestr_get_dm_posts");
    expect(thread?.tool).toBe("nestr_get_dm_thread");
  });
});

describe("posts responses keep their unread hint", () => {
  it("enriches the hint on a regular nest's posts, not just a DM's", async () => {
    const { enrichHints } = await import("../../src/tools/index.js");
    // The shape getNestPosts actually returns: the envelope, not a bare array.
    const enriched: any = enrichHints({
      status: "success",
      data: [{ _id: "p1" }],
      hints: [
        {
          type: "unread_posts",
          count: 2,
          endpoints: [{ purpose: "Mark read", method: "POST", path: "/api/posts/p9/read" }],
        },
      ],
    });
    // endpoints[] populates toolCalls (plural); toolCall is the legacy url path.
    expect(enriched.hints[0].toolCalls[0].tool).toBe("nestr_mark_post_read");
    expect(enriched.hints[0].toolCalls[0].parametersExample).toEqual({ postId: "p9" });
    // The payload must survive the envelope branch.
    expect(enriched.data).toHaveLength(1);
  });
});

describe("legacy url hints emit typed values too", () => {
  it("coerces unread to a boolean, which is what the tools declare", async () => {
    const { enrichHints } = await import("../../src/tools/index.js");
    const enriched: any = enrichHints({
      _id: "t1",
      hints: [{ type: "unread_posts", url: "/api/users/me/dm/t1/posts?unread=true" }],
    });
    expect(enriched.hints[0].toolCall.tool).toBe("nestr_get_dm_posts");
    expect(enriched.hints[0].toolCall.params).toEqual({ threadId: "t1", unread: true });
  });
});

describe("queue hint endpoints", () => {
  it("maps a queue thread listing, keeping the unread filter", async () => {
    const { translateEndpoint } = await import("../../src/tools/index.js");
    const call = translateEndpoint({
      method: "GET",
      path: "/api/users/me/queues/support/threads?unread=true",
    } as never);
    expect(call?.tool).toBe("nestr_list_queue_threads");
    expect(call?.parametersExample).toEqual({ key: "support", unread: true });
  });

  it("does not read the queue listing as a queue-threads listing", async () => {
    const { translateEndpoint } = await import("../../src/tools/index.js");
    const call = translateEndpoint({ method: "GET", path: "/api/users/me/queues" } as never);
    expect(call?.tool).toBe("nestr_list_queues");
  });
});
