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

function parseResult(text: string): Record<string, unknown> {
  return JSON.parse(text);
}

describe("file attachment tools", () => {
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

  // ─── nestr_get_nest_files ───────────────────────────────────────

  it("nestr_get_nest_files GETs /nests/:id/files and lists each file", async () => {
    const files = [
      { id: "f1", name: "diagram.png", contentType: "image/png", size: 2048, createdBy: "u1", createdAt: "2026-01-01" },
      { id: "f2", name: "notes.txt", contentType: "text/plain", size: 300 },
    ];
    mockFetch.mockResolvedValue(mockResponse(200, { status: "success", data: files }));

    const result = await handleToolCall(client, "nestr_get_nest_files", { nestId: "nest-1" });
    expect(result.isError).toBeFalsy();

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.test.io/api/nests/nest-1/files");
    expect(opts.method ?? "GET").toBe("GET");

    // A text block listing each file's id, name, contentType, size.
    expect(result.content).toHaveLength(1);
    const block = result.content[0];
    expect(block.type).toBe("text");
    const text = (block as { type: "text"; text: string }).text;
    expect(text).toContain("f1");
    expect(text).toContain("diagram.png");
    expect(text).toContain("image/png");
    expect(text).toContain("f2");
    expect(text).toContain("notes.txt");
  });

  it("nestr_get_nest_files reports when there are no attachments", async () => {
    mockFetch.mockResolvedValue(mockResponse(200, { status: "success", data: [] }));

    const result = await handleToolCall(client, "nestr_get_nest_files", { nestId: "nest-1" });
    expect(result.isError).toBeFalsy();
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toMatch(/no file attachments/i);
  });

  it("nestr_get_nest_files works with a comment id (files keyed by nestId)", async () => {
    mockFetch.mockResolvedValue(mockResponse(200, { status: "success", data: [] }));
    await handleToolCall(client, "nestr_get_nest_files", { nestId: "comment-9" });
    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.test.io/api/nests/comment-9/files");
  });

  it("nestr_get_nest_files requires nestId", async () => {
    const result = await handleToolCall(client, "nestr_get_nest_files", {});
    expect(result.isError).toBe(true);
    const parsed = parseResult((result.content[0] as { type: "text"; text: string }).text);
    expect(parsed.code).toBe("VALIDATION");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // ─── nestr_read_file ────────────────────────────────────────────

  it("nestr_read_file returns image content for image/* files", async () => {
    const pngBase64 = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64");
    mockFetch.mockResolvedValue(
      mockResponse(200, {
        status: "success",
        data: { id: "f1", name: "diagram.png", contentType: "image/png", size: 4, dataBase64: pngBase64 },
      })
    );

    const result = await handleToolCall(client, "nestr_read_file", { nestId: "nest-1", fileId: "f1" });
    expect(result.isError).toBeFalsy();

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.test.io/api/nests/nest-1/files/f1");
    expect(opts.method ?? "GET").toBe("GET");

    // A short text label naming the file, plus an MCP image content item.
    const imageBlocks = result.content.filter((c) => c.type === "image");
    expect(imageBlocks).toHaveLength(1);
    expect(imageBlocks[0]).toEqual({ type: "image", data: pngBase64, mimeType: "image/png" });

    const textBlocks = result.content.filter((c) => c.type === "text");
    expect(textBlocks).toHaveLength(1);
    expect((textBlocks[0] as { type: "text"; text: string }).text).toContain("diagram.png");
  });

  it("nestr_read_file returns metadata (no image block) for an oversized image", async () => {
    // A 6MB image is over MAX_IMAGE_INLINE_BYTES (5MB): forwarding the base64
    // would exceed the model API's per-image limit, so degrade to a note.
    mockFetch.mockResolvedValue(
      mockResponse(200, {
        status: "success",
        data: { id: "f1b", name: "huge.png", contentType: "image/png", size: 6 * 1024 * 1024, dataBase64: "iVBORw0=" },
      })
    );

    const result = await handleToolCall(client, "nestr_read_file", { nestId: "nest-1", fileId: "f1b" });
    expect(result.isError).toBeFalsy();
    expect(result.content.filter((c) => c.type === "image")).toHaveLength(0);
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toContain("huge.png");
    expect(text).toMatch(/too large to inline/i);
  });

  it("nestr_read_file decodes text/* files to UTF-8 text", async () => {
    const body = "hello,\nworld ✓";
    const dataBase64 = Buffer.from(body, "utf-8").toString("base64");
    mockFetch.mockResolvedValue(
      mockResponse(200, {
        status: "success",
        data: { id: "f2", name: "notes.txt", contentType: "text/plain", size: body.length, dataBase64 },
      })
    );

    const result = await handleToolCall(client, "nestr_read_file", { nestId: "nest-1", fileId: "f2" });
    expect(result.isError).toBeFalsy();
    expect(result.content.filter((c) => c.type === "image")).toHaveLength(0);
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toContain("notes.txt");
    expect(text).toContain("hello,");
    expect(text).toContain("world ✓");
  });

  it("nestr_read_file decodes application/json files to text", async () => {
    const body = JSON.stringify({ a: 1, b: [2, 3] });
    const dataBase64 = Buffer.from(body, "utf-8").toString("base64");
    mockFetch.mockResolvedValue(
      mockResponse(200, {
        status: "success",
        data: { id: "f3", name: "data.json", contentType: "application/json", size: body.length, dataBase64 },
      })
    );

    const result = await handleToolCall(client, "nestr_read_file", { nestId: "nest-1", fileId: "f3" });
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toContain("data.json");
    expect(text).toContain('"a":1');
  });

  it("nestr_read_file decodes application/json with a charset parameter as text", async () => {
    // Regression: `application/json; charset=utf-8` must not fall through to the
    // metadata-only branch — a strict === check would miss the parameter variant.
    const body = JSON.stringify({ ok: true });
    const dataBase64 = Buffer.from(body, "utf-8").toString("base64");
    mockFetch.mockResolvedValue(
      mockResponse(200, {
        status: "success",
        data: { id: "f3b", name: "data.json", contentType: "application/json; charset=utf-8", size: body.length, dataBase64 },
      })
    );

    const result = await handleToolCall(client, "nestr_read_file", { nestId: "nest-1", fileId: "f3b" });
    expect(result.content.filter((c) => c.type === "image")).toHaveLength(0);
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toContain('"ok":true');
    expect(text).not.toMatch(/can't be inlined|cannot be inlined/i);
  });

  it("nestr_read_file truncates very large text files", async () => {
    const body = "x".repeat(250_000);
    const dataBase64 = Buffer.from(body, "utf-8").toString("base64");
    mockFetch.mockResolvedValue(
      mockResponse(200, {
        status: "success",
        data: { id: "f4", name: "big.txt", contentType: "text/plain", size: body.length, dataBase64 },
      })
    );

    const result = await handleToolCall(client, "nestr_read_file", { nestId: "nest-1", fileId: "f4" });
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toMatch(/truncated/i);
    // The label + note surround the 200k-char body, so total stays bounded.
    expect(text.length).toBeLessThan(201_000);
  });

  it("nestr_read_file returns metadata only for PDFs (cannot inline)", async () => {
    mockFetch.mockResolvedValue(
      mockResponse(200, {
        status: "success",
        data: { id: "f5", name: "report.pdf", contentType: "application/pdf", size: 10240, dataBase64: "JVBERi0=" },
      })
    );

    const result = await handleToolCall(client, "nestr_read_file", { nestId: "nest-1", fileId: "f5" });
    expect(result.content.filter((c) => c.type === "image")).toHaveLength(0);
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toContain("report.pdf");
    expect(text).toContain("application/pdf");
    expect(text).toMatch(/can't be inlined|cannot be inlined/i);
  });

  it("nestr_read_file requires nestId and fileId", async () => {
    const result = await handleToolCall(client, "nestr_read_file", { nestId: "nest-1" });
    expect(result.isError).toBe(true);
    const parsed = parseResult((result.content[0] as { type: "text"; text: string }).text);
    expect(parsed.code).toBe("VALIDATION");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("nestr_read_file surfaces a 404 as NOT_FOUND", async () => {
    mockFetch.mockResolvedValue(mockResponse(404, { message: "File not found" }));
    const result = await handleToolCall(client, "nestr_read_file", { nestId: "nest-1", fileId: "missing" });
    expect(result.isError).toBe(true);
    const parsed = parseResult((result.content[0] as { type: "text"; text: string }).text);
    expect(parsed.code).toBe("NOT_FOUND");
  });

  // ─── client methods ─────────────────────────────────────────────

  it("getNestFiles unwraps { status, data }", async () => {
    const files = [{ id: "f1", name: "a.png", contentType: "image/png", size: 1 }];
    mockFetch.mockResolvedValue(mockResponse(200, { status: "success", data: files }));
    const result = await client.getNestFiles("nest-1");
    expect(result).toEqual(files);
  });

  it("getNestFile unwraps { status, data }", async () => {
    const file = { id: "f1", name: "a.png", contentType: "image/png", size: 1, dataBase64: "AA==" };
    mockFetch.mockResolvedValue(mockResponse(200, { status: "success", data: file }));
    const result = await client.getNestFile("nest-1", "f1");
    expect(result).toEqual(file);
    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.test.io/api/nests/nest-1/files/f1");
  });

  // ─── nestr_upload_file ──────────────────────────────────────────

  it("nestr_upload_file POSTs the file body and returns its descriptor", async () => {
    const dataBase64 = Buffer.from("hello").toString("base64");
    const descriptor = { id: "f9", name: "greeting.txt", contentType: "text/plain", size: 5, createdBy: "u1", createdAt: "2026-07-14" };
    mockFetch.mockResolvedValue(mockResponse(200, { status: "success", data: descriptor }));

    const result = await handleToolCall(client, "nestr_upload_file", {
      nestId: "nest-1", name: "greeting.txt", contentType: "text/plain", dataBase64,
    });
    expect(result.isError).toBeFalsy();

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.test.io/api/nests/nest-1/files");
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body as string)).toEqual({ name: "greeting.txt", contentType: "text/plain", dataBase64 });

    const parsed = parseResult((result.content[0] as { type: "text"; text: string }).text);
    expect((parsed.file as { id: string }).id).toBe("f9");
    expect(parsed.message).toContain("greeting.txt");
  });

  it("nestr_upload_file attaches to a comment id (files keyed by nestId)", async () => {
    mockFetch.mockResolvedValue(
      mockResponse(200, { status: "success", data: { id: "f1", name: "a.png", contentType: "image/png", size: 3 } })
    );
    await handleToolCall(client, "nestr_upload_file", {
      nestId: "comment-7", name: "a.png", contentType: "image/png", dataBase64: "AAAA",
    });
    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.test.io/api/nests/comment-7/files");
  });

  it("nestr_upload_file requires name, contentType and dataBase64", async () => {
    const result = await handleToolCall(client, "nestr_upload_file", { nestId: "nest-1" });
    expect(result.isError).toBe(true);
    const parsed = parseResult((result.content[0] as { type: "text"; text: string }).text);
    expect(parsed.code).toBe("VALIDATION");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("nestr_upload_file surfaces an over-size rejection as an error", async () => {
    mockFetch.mockResolvedValue(mockResponse(422, { message: "File exceeds the maximum upload size of 10485760 bytes" }));
    const result = await handleToolCall(client, "nestr_upload_file", {
      nestId: "nest-1", name: "big.bin", contentType: "application/octet-stream", dataBase64: "AAAA",
    });
    expect(result.isError).toBe(true);
  });

  // ─── nestr_delete_file ──────────────────────────────────────────

  it("nestr_delete_file DELETEs /nests/:id/files/:fileId", async () => {
    mockFetch.mockResolvedValue(mockResponse(200, { status: "success" }));
    const result = await handleToolCall(client, "nestr_delete_file", { nestId: "nest-1", fileId: "f9" });
    expect(result.isError).toBeFalsy();

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.test.io/api/nests/nest-1/files/f9");
    expect(opts.method).toBe("DELETE");
    const parsed = parseResult((result.content[0] as { type: "text"; text: string }).text);
    expect(parsed.message).toContain("f9");
  });

  it("nestr_delete_file requires nestId and fileId", async () => {
    const result = await handleToolCall(client, "nestr_delete_file", { nestId: "nest-1" });
    expect(result.isError).toBe(true);
    const parsed = parseResult((result.content[0] as { type: "text"; text: string }).text);
    expect(parsed.code).toBe("VALIDATION");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("nestr_delete_file surfaces a 404 as NOT_FOUND", async () => {
    mockFetch.mockResolvedValue(mockResponse(404, { message: "Could not find file" }));
    const result = await handleToolCall(client, "nestr_delete_file", { nestId: "nest-1", fileId: "missing" });
    expect(result.isError).toBe(true);
    const parsed = parseResult((result.content[0] as { type: "text"; text: string }).text);
    expect(parsed.code).toBe("NOT_FOUND");
  });

  it("createNestFile unwraps { status, data } and POSTs", async () => {
    const descriptor = { id: "f1", name: "a.txt", contentType: "text/plain", size: 2 };
    mockFetch.mockResolvedValue(mockResponse(200, { status: "success", data: descriptor }));
    const result = await client.createNestFile("nest-1", { name: "a.txt", contentType: "text/plain", dataBase64: "AAA=" });
    expect(result).toEqual(descriptor);
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.test.io/api/nests/nest-1/files");
    expect(opts.method).toBe("POST");
  });

  it("deleteNestFile issues a DELETE to the file URL", async () => {
    mockFetch.mockResolvedValue(mockResponse(200, { status: "success" }));
    await client.deleteNestFile("nest-1", "f1");
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.test.io/api/nests/nest-1/files/f1");
    expect(opts.method).toBe("DELETE");
  });
});
