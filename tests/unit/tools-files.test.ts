import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  handleToolCall, toolDefinitions, withLocalFileTools, READONLY_TOOL_NAMES, LOCAL_FILE_MAX_BYTES,
} from "../../src/tools/index.js";
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

  it("nestr_read_file returns an SVG as text, never as an image block", async () => {
    // image/svg+xml is not one of the four types the model API accepts, and an
    // image block carrying it 400s the agent's whole request. SVG is markup, so
    // the source is the useful form anyway.
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><title>logo</title></svg>';
    mockFetch.mockResolvedValue(
      mockResponse(200, {
        status: "success",
        data: {
          id: "f1c",
          name: "logo-tagline.svg",
          contentType: "image/svg+xml",
          size: svg.length,
          dataBase64: Buffer.from(svg, "utf-8").toString("base64"),
        },
      })
    );

    const result = await handleToolCall(client, "nestr_read_file", { nestId: "nest-1", fileId: "f1c" });
    expect(result.isError).toBeFalsy();
    expect(result.content.filter((c) => c.type === "image")).toHaveLength(0);
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toContain("logo-tagline.svg");
    expect(text).toContain("<title>logo</title>");
  });

  it.each(["image/bmp", "image/avif", "image/heic", "image/x-icon", "image/tiff"])(
    "nestr_read_file returns metadata, not an image block, for %s",
    async (contentType) => {
      mockFetch.mockResolvedValue(
        mockResponse(200, {
          status: "success",
          data: { id: "f1d", name: "asset.bin", contentType, size: 4, dataBase64: "AAAA" },
        })
      );

      const result = await handleToolCall(client, "nestr_read_file", { nestId: "nest-1", fileId: "f1d" });
      expect(result.isError).toBeFalsy();
      expect(result.content.filter((c) => c.type === "image")).toHaveLength(0);
      const text = (result.content[0] as { type: "text"; text: string }).text;
      expect(text).toContain(contentType);
      expect(text).toContain("image/png");
    }
  );

  it("nestr_read_file inlines an image/jpg file as image/jpeg", async () => {
    // Uploaders mislabel JPEGs as image/jpg; the model API rejects that spelling.
    mockFetch.mockResolvedValue(
      mockResponse(200, {
        status: "success",
        data: { id: "f1e", name: "photo.jpg", contentType: "image/jpg", size: 4, dataBase64: "/9j/4A==" },
      })
    );

    const result = await handleToolCall(client, "nestr_read_file", { nestId: "nest-1", fileId: "f1e" });
    expect(result.isError).toBeFalsy();
    const imageBlocks = result.content.filter((c) => c.type === "image");
    expect(imageBlocks).toHaveLength(1);
    expect((imageBlocks[0] as { mimeType: string }).mimeType).toBe("image/jpeg");
  });

  it("nestr_read_file inlines an image whose content type carries a parameter", async () => {
    mockFetch.mockResolvedValue(
      mockResponse(200, {
        status: "success",
        data: { id: "f1f", name: "shot.png", contentType: "IMAGE/PNG; charset=binary", size: 4, dataBase64: "iVBORw0=" },
      })
    );

    const result = await handleToolCall(client, "nestr_read_file", { nestId: "nest-1", fileId: "f1f" });
    expect(result.isError).toBeFalsy();
    const imageBlocks = result.content.filter((c) => c.type === "image");
    expect(imageBlocks).toHaveLength(1);
    expect((imageBlocks[0] as { mimeType: string }).mimeType).toBe("image/png");
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

  it("nestr_upload_file requires name and contentType", async () => {
    const result = await handleToolCall(client, "nestr_upload_file", { nestId: "nest-1" });
    expect(result.isError).toBe(true);
    const parsed = parseResult((result.content[0] as { type: "text"; text: string }).text);
    expect(parsed.code).toBe("VALIDATION");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("nestr_upload_file accepts UTF-8 content and base64-encodes it for the API", async () => {
    const body = "# Notes\nhello, world";
    const descriptor = { id: "f10", name: "notes.md", contentType: "text/markdown", size: body.length };
    mockFetch.mockResolvedValue(mockResponse(200, { status: "success", data: descriptor }));

    const result = await handleToolCall(client, "nestr_upload_file", {
      nestId: "nest-1", name: "notes.md", contentType: "text/markdown", content: body,
    });
    expect(result.isError).toBeFalsy();

    const [, opts] = mockFetch.mock.calls[0];
    expect(JSON.parse(opts.body as string)).toEqual({
      name: "notes.md",
      contentType: "text/markdown",
      dataBase64: Buffer.from(body, "utf-8").toString("base64"),
    });
  });

  it("nestr_upload_file rejects providing both content and dataBase64", async () => {
    const result = await handleToolCall(client, "nestr_upload_file", {
      nestId: "nest-1", name: "x.txt", contentType: "text/plain", content: "hi", dataBase64: "aGk=",
    });
    expect(result.isError).toBe(true);
    const parsed = parseResult((result.content[0] as { type: "text"; text: string }).text);
    expect(parsed.code).toBe("VALIDATION");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("nestr_upload_file rejects providing neither content nor dataBase64", async () => {
    const result = await handleToolCall(client, "nestr_upload_file", {
      nestId: "nest-1", name: "x.txt", contentType: "text/plain",
    });
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

  // ─── nestr_upload_file with filePath (stdio only) ───────────────

  describe("filePath", () => {
    let dir: string;
    // Every byte value, so any text decoding or re-encoding on the way shows up.
    const bytes = Buffer.from(Array.from({ length: 512 }, (_, i) => i % 256));

    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), "nestr-mcp-upload-"));
      writeFileSync(join(dir, "shot.png"), bytes);
    });
    afterEach(() => {
      rmSync(dir, { recursive: true, force: true });
    });

    it("reads the local file and sends its exact bytes when local files are allowed", async () => {
      mockFetch.mockResolvedValue(
        mockResponse(200, { status: "success", data: { id: "f1", name: "shot.png", contentType: "image/png", size: 512 } })
      );
      const result = await handleToolCall(client, "nestr_upload_file", {
        nestId: "nest-1", name: "shot.png", contentType: "image/png", filePath: join(dir, "shot.png"),
      }, { allowLocalFiles: true });
      expect(result.isError).toBeFalsy();

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe("https://api.test.io/api/nests/nest-1/files");
      const sent = JSON.parse(opts.body as string);
      expect(Buffer.from(sent.dataBase64, "base64").equals(bytes)).toBe(true);
    });

    it("is refused on the hosted server, without reading the disk or calling the API", async () => {
      const result = await handleToolCall(client, "nestr_upload_file", {
        nestId: "nest-1", name: "shot.png", contentType: "image/png", filePath: join(dir, "shot.png"),
      });
      expect(result.isError).toBe(true);
      const parsed = parseResult((result.content[0] as { type: "text"; text: string }).text);
      expect(parsed.code).toBe("VALIDATION");
      expect(parsed.hint).toContain("nestr_get_upload_url");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("rejects filePath together with content", async () => {
      const result = await handleToolCall(client, "nestr_upload_file", {
        nestId: "nest-1", name: "x.txt", contentType: "text/plain", content: "hi", filePath: join(dir, "shot.png"),
      }, { allowLocalFiles: true });
      expect(result.isError).toBe(true);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("reports a missing file as an error", async () => {
      const result = await handleToolCall(client, "nestr_upload_file", {
        nestId: "nest-1", name: "x.png", contentType: "image/png", filePath: join(dir, "nope.png"),
      }, { allowLocalFiles: true });
      expect(result.isError).toBe(true);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("refuses a file far over the limit without reading it", async () => {
      // Sparse, so the test writes no real bytes.
      const big = join(dir, "big.bin");
      writeFileSync(big, "");
      truncateSync(big, LOCAL_FILE_MAX_BYTES + 1);
      const result = await handleToolCall(client, "nestr_upload_file", {
        nestId: "nest-1", name: "big.bin", contentType: "application/octet-stream", filePath: big,
      }, { allowLocalFiles: true });
      expect(result.isError).toBe(true);
      const parsed = parseResult((result.content[0] as { type: "text"; text: string }).text);
      expect(parsed.code).toBe("VALIDATION");
      expect(parsed.message).toContain("was not read");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("refuses a directory with a clear message", async () => {
      mkdirSync(join(dir, "folder"));
      const result = await handleToolCall(client, "nestr_upload_file", {
        nestId: "nest-1", name: "folder", contentType: "application/octet-stream", filePath: join(dir, "folder"),
      }, { allowLocalFiles: true });
      const parsed = parseResult((result.content[0] as { type: "text"; text: string }).text);
      expect(parsed.code).toBe("VALIDATION");
      expect(parsed.message).toContain("not a regular file");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("is advertised only by the local build", () => {
      const props = (defs: ReadonlyArray<{ name: string; inputSchema: unknown }>) => {
        const def = defs.find((d) => d.name === "nestr_upload_file");
        return Object.keys((def?.inputSchema as { properties: Record<string, unknown> }).properties);
      };
      expect(props(toolDefinitions)).not.toContain("filePath");
      expect(props(withLocalFileTools(toolDefinitions))).toContain("filePath");
    });
  });

  // ─── nestr_get_upload_url ───────────────────────────────────────

  it("nestr_get_upload_url POSTs name and contentType and returns the URL and curl line", async () => {
    const upload = {
      url: "https://app.test.io/api/file-uploads/nest-1/tok",
      method: "POST",
      expiresAt: "2026-10-28T10:10:00.000Z",
      maxBytes: 10485760,
      curl: "curl --data-binary @<path-to-file> 'https://app.test.io/api/file-uploads/nest-1/tok'",
    };
    mockFetch.mockResolvedValue(mockResponse(200, { status: "success", data: upload }));

    const result = await handleToolCall(client, "nestr_get_upload_url", {
      nestId: "nest-1", name: "shot.png", contentType: "image/png",
    });
    expect(result.isError).toBeFalsy();

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.test.io/api/nests/nest-1/files/upload-url");
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body as string)).toEqual({ name: "shot.png", contentType: "image/png" });

    const parsed = parseResult((result.content[0] as { type: "text"; text: string }).text);
    expect(parsed).toMatchObject(upload);
  });

  it("nestr_get_upload_url requires name and contentType", async () => {
    const result = await handleToolCall(client, "nestr_get_upload_url", { nestId: "nest-1" });
    expect(result.isError).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("nestr_get_upload_url is a write, so the read-only surface leaves it out", () => {
    expect(READONLY_TOOL_NAMES.has("nestr_get_upload_url")).toBe(false);
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
