import { describe, it, expect, vi } from "vitest";
import { enrichHints } from "../../src/tools/index.js";

// The `settings` hint (nestr-dev/slashme-online#2069) tells the model which settings tabs
// the person it is helping can open on a nest, and the URL for each — the answer to the
// question that produced `/n/<id>/settings/users`, a path no route has ever matched.
//
// It is the one hint with nothing to call: a link for a person, not an API route. These
// tests pin that it survives the trip anyway, because a hint that is silently emptied is
// indistinguishable from one that was never sent.
describe("the settings hint reaches the model", () => {
  const nestWithSettingsHint = () => {
    return {
      _id: "ws1",
      labels: ["workspace"],
      hints: [
        {
          type: "settings",
          label: "You can open this nest's settings: 3 tabs",
          severity: "info",
          count: 3,
          // Absolute, host and all, which is how Nestr sends every hint URL:
          // `<host>/api/...` for a route, `<host>/n/...` for a page.
          tabs: [
            { id: "users", title: "Users", url: "https://app.nestr.io/n/ws1?s=1#users" },
            { id: "details", title: "Details", url: "https://app.nestr.io/n/ws1?s=1#details" },
            { id: "plan", title: "Plan & billing", url: "https://app.nestr.io/n/ws1?s=1#plan" },
          ],
        },
      ],
    };
  };

  it("keeps the tabs and their URLs exactly as sent", () => {
    // A page link is the one thing here that leaves this server as a URL: the assistant
    // hands it to a person. Nestr already put its own host on it, and that host is the
    // one the person is using, so rewriting it here could only make it wrong.
    const enriched: any = enrichHints(nestWithSettingsHint());
    const hint = enriched.hints[0];
    expect(hint.tabs).toHaveLength(3);
    expect(hint.tabs[0]).toEqual({
      id: "users",
      title: "Users",
      url: "https://app.nestr.io/n/ws1?s=1#users",
    });
  });

  it("keeps a self-hosted host rather than substituting its own", () => {
    // The failure this pins: a deployment answers with its own links, and swapping in
    // app.nestr.io would send the person to a Nestr where the nest does not exist.
    const enriched: any = enrichHints({
      _id: "ws1",
      labels: ["workspace"],
      hints: [{
        type: "settings",
        label: "You can open this nest's settings: 1 tab",
        severity: "info",
        count: 1,
        tabs: [{ id: "users", title: "Users", url: "https://nestr.example.com/n/ws1?s=1#users" }],
      }],
    });
    expect(enriched.hints[0].tabs[0].url).toBe("https://nestr.example.com/n/ws1?s=1#users");
  });

  it("still matches an absolute API url to its tool", () => {
    // The other half of the same contract: a route hint arrives host-qualified too, and
    // the pattern table works on the path, so the host has to come off before matching.
    const enriched: any = enrichHints({
      _id: "n1",
      parentId: "ws1",
      hints: [{
        type: "unread_posts",
        label: "2 posts you have not read",
        severity: "info",
        url: "https://app.nestr.io/api/nests/n1/posts?unread=true",
      }],
    });
    expect(enriched.hints[0].toolCall?.tool).toBe("nestr_get_comments");
  });

  it("invents no tool call for it", () => {
    // There is no tool that opens a settings tab, and a fabricated one would be worse
    // than none: the model would call it instead of handing the person the link.
    const enriched: any = enrichHints(nestWithSettingsHint());
    expect(enriched.hints[0].toolCall).toBe(undefined);
    expect(enriched.hints[0].toolCalls).toBe(undefined);
  });

  it("logs no unrecognized-pattern complaint about it", () => {
    // That warning fires for a hint carrying a url the tool table cannot match. This one
    // carries none, so a complaint would mean the enrichment had misread its shape.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    enrichHints(nestWithSettingsHint());
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("nest URLs are for the Nestr this server talks to", () => {
  it("derives the web host from the API base", async () => {
    const { nestrWebBase } = await import("../../src/tools/index.js");
    expect(nestrWebBase("http://localhost:4001/api")).toBe("http://localhost:4001");
    expect(nestrWebBase("https://nestr.example.com/api/")).toBe("https://nestr.example.com");
  });

  it("falls back to the app host when nothing is configured", async () => {
    // Same default the API client uses, so an unconfigured server behaves as before.
    const { nestrWebBase } = await import("../../src/tools/index.js");
    expect(nestrWebBase(undefined)).toBe("https://app.nestr.io");
    expect(nestrWebBase("")).toBe("https://app.nestr.io");
  });
});
