import { describe, it, expect } from "vitest";
import {
  compactResponse,
  enrichHints,
  stripDescriptionFields,
  completableResponse,
  unescapeRichTextFields,
  addNestUrls,
} from "../../src/tools/index.js";

// ─── compactResponse ────────────────────────────────────────────────

describe("compactResponse", () => {
  it("strips non-compact fields from array items", () => {
    const data = [
      { _id: "1", title: "Task", description: "desc", extraField: "gone", completed: false },
    ];
    const result = compactResponse(data) as any[];
    expect(result[0]).toHaveProperty("_id");
    expect(result[0]).toHaveProperty("title");
    expect(result[0]).toHaveProperty("description");
    expect(result[0]).toHaveProperty("completed");
    expect(result[0]).not.toHaveProperty("extraField");
  });

  it("handles wrapped response { status, data: [...] }", () => {
    const data = {
      status: "ok",
      meta: { total: 1 },
      data: [{ _id: "1", title: "Task", extraField: "gone" }],
    };
    const result = compactResponse(data) as any;
    expect(result.status).toBe("ok");
    expect(result.meta).toEqual({ total: 1 });
    expect(result.data[0]).toHaveProperty("_id");
    expect(result.data[0]).not.toHaveProperty("extraField");
  });

  it("returns non-array data as-is", () => {
    const data = { _id: "1", title: "Single item", extraField: "kept" };
    const result = compactResponse(data);
    expect(result).toEqual(data);
  });

  it("includes role fields when type is role", () => {
    const data = [
      { _id: "1", title: "Role", accountabilities: ["a"], domains: ["d"], extraField: "gone" },
    ];
    const result = compactResponse(data, "role") as any[];
    expect(result[0]).toHaveProperty("accountabilities");
    expect(result[0]).toHaveProperty("domains");
    expect(result[0]).not.toHaveProperty("extraField");
  });

  it("includes user fields when type is user", () => {
    const data = [
      { _id: "1", username: "alice", profile: { name: "Alice" }, extraField: "gone" },
    ];
    const result = compactResponse(data, "user") as any[];
    expect(result[0]).toHaveProperty("username");
    expect(result[0]).toHaveProperty("profile");
    expect(result[0]).not.toHaveProperty("extraField");
  });
});

// ─── stripDescriptionFields ─────────────────────────────────────────

describe("stripDescriptionFields", () => {
  it("removes description from objects with _id", () => {
    const data = { _id: "1", title: "Task", description: "remove me" };
    const result = stripDescriptionFields(data) as any;
    expect(result._id).toBe("1");
    expect(result.title).toBe("Task");
    expect(result).not.toHaveProperty("description");
  });

  it("keeps description on objects without _id", () => {
    const data = { title: "Not a nest", description: "keep me" };
    const result = stripDescriptionFields(data) as any;
    expect(result.description).toBe("keep me");
  });

  it("strips recursively through known keys (data, items, nests)", () => {
    const data = {
      data: [
        { _id: "1", description: "remove" },
        { _id: "2", description: "also remove" },
      ],
    };
    const result = stripDescriptionFields(data) as any;
    expect(result.data[0]).not.toHaveProperty("description");
    expect(result.data[1]).not.toHaveProperty("description");
  });

  it("handles arrays at the top level", () => {
    const data = [
      { _id: "1", description: "remove" },
      { _id: "2", description: "also remove" },
    ];
    const result = stripDescriptionFields(data) as any[];
    expect(result[0]).not.toHaveProperty("description");
    expect(result[1]).not.toHaveProperty("description");
  });

  it("passes through primitives unchanged", () => {
    expect(stripDescriptionFields("hello")).toBe("hello");
    expect(stripDescriptionFields(42)).toBe(42);
    expect(stripDescriptionFields(null)).toBeNull();
  });
});

// ─── enrichHints ────────────────────────────────────────────────────

describe("enrichHints", () => {
  it("adds toolCall to hints with /nests/{id} URL", () => {
    const data = {
      _id: "nest1",
      hints: [{ type: "related", label: "See", severity: "info", url: "/nests/abc123" }],
    };
    const result = enrichHints(data) as any;
    expect(result.hints[0].toolCall).toEqual({
      tool: "nestr_get_nest",
      params: { nestId: "abc123" },
    });
  });

  it("adds toolCall to /nests/{id}/posts URL", () => {
    const data = {
      _id: "nest1",
      hints: [{ type: "comments", label: "Comments", severity: "info", url: "/nests/abc123/posts" }],
    };
    const result = enrichHints(data) as any;
    expect(result.hints[0].toolCall).toEqual({
      tool: "nestr_get_comments",
      params: { nestId: "abc123" },
    });
  });

  it("adds toolCall to /nests/{id}/tensions URL", () => {
    const data = {
      _id: "nest1",
      hints: [{ type: "tensions", label: "Tensions", severity: "info", url: "/nests/abc123/tensions" }],
    };
    const result = enrichHints(data) as any;
    expect(result.hints[0].toolCall).toEqual({
      tool: "nestr_list_tensions",
      params: { nestId: "abc123" },
    });
  });

  it("maps /nests/{id}/children?search=... to nestr_search", () => {
    const data = {
      _id: "nest1",
      ancestors: ["workspace1"],
      hints: [{ type: "children", label: "Children", severity: "info", url: "/nests/parent1/children?search=todo" }],
    };
    const result = enrichHints(data) as any;
    expect(result.hints[0].toolCall).toEqual({
      tool: "nestr_search",
      params: { query: "in:parent1 todo", workspaceId: "workspace1" },
    });
  });

  it("leaves hints without URL unchanged", () => {
    const data = {
      _id: "nest1",
      hints: [{ type: "info", label: "No URL", severity: "info" }],
    };
    const result = enrichHints(data) as any;
    expect(result.hints[0]).not.toHaveProperty("toolCall");
  });

  it("processes arrays of items", () => {
    const data = [
      { _id: "1", hints: [{ type: "t", label: "l", severity: "i", url: "/nests/a" }] },
      { _id: "2", hints: [{ type: "t", label: "l", severity: "i", url: "/nests/b" }] },
    ];
    const result = enrichHints(data) as any[];
    expect(result[0].hints[0].toolCall.params.nestId).toBe("a");
    expect(result[1].hints[0].toolCall.params.nestId).toBe("b");
  });

  it("returns primitives unchanged", () => {
    expect(enrichHints(null)).toBeNull();
    expect(enrichHints("string")).toBe("string");
  });
});

// ─── addNestUrls ────────────────────────────────────────────────────

describe("addNestUrls", () => {
  it("uses parentId as the URL context when present", () => {
    const data = { _id: "task1", title: "Task", parentId: "project1" };
    const result = addNestUrls(data) as any;
    expect(result.url).toBe("https://app.nestr.io/n/project1/task1");
  });

  it("falls back to /n/{id} when parentId is 'inbox' (case-insensitive)", () => {
    expect((addNestUrls({ _id: "i1", title: "Item", parentId: "inbox" }) as any).url)
      .toBe("https://app.nestr.io/n/i1");
    expect((addNestUrls({ _id: "i2", title: "Item", parentId: "Inbox" }) as any).url)
      .toBe("https://app.nestr.io/n/i2");
    expect((addNestUrls({ _id: "i3", title: "Item", parentId: "INBOX" }) as any).url)
      .toBe("https://app.nestr.io/n/i3");
  });

  it("falls back to /n/{id} when parentId is missing (workspace via labels)", () => {
    const data = { _id: "ws1", title: "Workspace", labels: ["anchor-circle"] };
    const result = addNestUrls(data) as any;
    expect(result.url).toBe("https://app.nestr.io/n/ws1");
  });

  it("walks arrays of nests", () => {
    const data = [
      { _id: "n1", title: "A", parentId: "p1" },
      { _id: "n2", title: "B", parentId: "p1" },
    ];
    const result = addNestUrls(data) as any[];
    expect(result[0].url).toBe("https://app.nestr.io/n/p1/n1");
    expect(result[1].url).toBe("https://app.nestr.io/n/p1/n2");
  });

  it("walks wrapped responses { data: [...] }", () => {
    const data = {
      status: "ok",
      data: [{ _id: "n1", title: "A", parentId: "p1" }],
    };
    const result = addNestUrls(data) as any;
    expect(result.data[0].url).toBe("https://app.nestr.io/n/p1/n1");
  });

  it("walks completable list response shape { title, source, items }", () => {
    const data = {
      title: "Inbox",
      source: "inbox" as const,
      items: [{ _id: "n1", title: "Item", parentId: "inbox" }],
    };
    const result = addNestUrls(data) as any;
    expect(result.items[0].url).toBe("https://app.nestr.io/n/n1");
  });

  it("adds URL to nest nested inside a wrapper { message, nest }", () => {
    const data = {
      message: "Nest created successfully",
      nest: { _id: "n1", title: "T", parentId: "p1" },
    };
    const result = addNestUrls(data) as any;
    expect(result.nest.url).toBe("https://app.nestr.io/n/p1/n1");
    expect(result.message).toBe("Nest created successfully");
  });

  it("does NOT add URL to users (have username)", () => {
    const data = { _id: "u1", username: "alice", profile: { fullName: "Alice" } };
    const result = addNestUrls(data) as any;
    expect(result).not.toHaveProperty("url");
  });

  it("does NOT add URL to labels (have _id + title but no parentId/ancestors/labels[])", () => {
    const data = { _id: "lbl1", title: "Project", workspaceId: "ws1" };
    const result = addNestUrls(data) as any;
    expect(result).not.toHaveProperty("url");
  });

  it("does NOT add URL to error envelopes", () => {
    const data = { error: true, code: "VALIDATION", message: "bad input", retryable: false };
    const result = addNestUrls(data) as any;
    expect(result).not.toHaveProperty("url");
  });

  it("does NOT overwrite an existing url field", () => {
    const data = { _id: "n1", title: "T", parentId: "p1", url: "https://custom.example/n/n1" };
    const result = addNestUrls(data) as any;
    expect(result.url).toBe("https://custom.example/n/n1");
  });

  it("returns primitives unchanged", () => {
    expect(addNestUrls(null)).toBeNull();
    expect(addNestUrls("hello")).toBe("hello");
    expect(addNestUrls(42)).toBe(42);
  });

  it("composes with compactResponse — URL survives after compaction-then-url ordering", () => {
    const compacted = compactResponse([
      { _id: "n1", title: "A", parentId: "p1", extraField: "gone" },
    ]) as any[];
    const result = addNestUrls(compacted) as any[];
    expect(result[0]).not.toHaveProperty("extraField");
    expect(result[0].url).toBe("https://app.nestr.io/n/p1/n1");
  });
});

// ─── completableResponse ────────────────────────────────────────────

describe("completableResponse", () => {
  it("wraps array data with source and title", () => {
    const items = [{ _id: "1" }, { _id: "2" }];
    const result = completableResponse(items, "inbox", "My Inbox");
    expect(result.title).toBe("My Inbox");
    expect(result.source).toBe("inbox");
    expect(result.items).toEqual(items);
  });

  it("extracts items from wrapped response", () => {
    const data = { status: "ok", data: [{ _id: "1" }] };
    const result = completableResponse(data, "children", "Children");
    expect(result.items).toEqual([{ _id: "1" }]);
  });

  it("returns empty items for non-array/non-wrapped data", () => {
    const result = completableResponse("not-an-array", "search", "Search");
    expect(result.items).toEqual([]);
  });
});

// ─── unescapeRichTextFields ─────────────────────────────────────────

describe("unescapeRichTextFields", () => {
  it("unescapes \\\\n to real newlines in description", () => {
    const args = { description: "line1\\nline2\\nline3" };
    const result = unescapeRichTextFields(args);
    expect(result.description).toBe("line1\nline2\nline3");
  });

  it("unescapes \\\\t to real tabs in description", () => {
    const args = { description: "col1\\tcol2" };
    const result = unescapeRichTextFields(args);
    expect(result.description).toBe("col1\tcol2");
  });

  it("unescapes purpose and body fields", () => {
    const args = { purpose: "a\\nb", body: "c\\nd" };
    const result = unescapeRichTextFields(args);
    expect(result.purpose).toBe("a\nb");
    expect(result.body).toBe("c\nd");
  });

  it("does not modify non-rich-text fields", () => {
    const args = { nestId: "abc\\n123", title: "hello\\nworld", description: "a\\nb" };
    const result = unescapeRichTextFields(args);
    expect(result.nestId).toBe("abc\\n123");
    expect(result.title).toBe("hello\\nworld");
    expect(result.description).toBe("a\nb");
  });

  it("returns the same object when no changes needed", () => {
    const args = { description: "no escapes here", nestId: "123" };
    const result = unescapeRichTextFields(args);
    expect(result).toBe(args);
  });

  it("leaves strings without backslashes untouched", () => {
    const args = { description: "plain text" };
    const result = unescapeRichTextFields(args);
    expect(result).toBe(args);
  });

  it("handles markdown code blocks correctly", () => {
    const args = { description: "```js\\nconsole.log('hello');\\n```" };
    const result = unescapeRichTextFields(args);
    expect(result.description).toBe("```js\nconsole.log('hello');\n```");
  });

  it("unescapes Windows-style \\\\r\\\\n line endings", () => {
    const args = { description: "line1\\r\\nline2\\r\\nline3" };
    const result = unescapeRichTextFields(args);
    expect(result.description).toBe("line1\r\nline2\r\nline3");
  });

  it("unescapes standalone \\\\r", () => {
    const args = { description: "col1\\rcol2" };
    const result = unescapeRichTextFields(args);
    expect(result.description).toBe("col1\rcol2");
  });
});
