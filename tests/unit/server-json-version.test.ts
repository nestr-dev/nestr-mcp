import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// The MCP Registry reads server.json. release.sh bumps it with package.json, and
// this catches a bump that skipped it so main never claims a stale version.
const readJson = (file: string) =>
  JSON.parse(readFileSync(new URL(`../../${file}`, import.meta.url), "utf8"));

describe("server.json version", () => {
  const { version } = readJson("package.json");
  const server = readJson("server.json");

  it("matches package.json at the top level", () => {
    expect(server.version).toBe(version);
  });

  it("matches package.json for the npm package entry", () => {
    expect(server.packages[0].version).toBe(version);
  });
});
