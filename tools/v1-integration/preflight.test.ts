import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkPreflight, contained, requirePreflight, type PreflightInput } from "./preflight.js";
import { bundleFixture } from "./bundle-fixture.js";
const paths: string[] = [];
afterEach(() => { for (const path of paths.splice(0)) rmSync(path, { recursive: true, force: true }); });
function config(): PreflightInput {
  const cwd = process.cwd(), sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const manifest = bundleFixture(); manifest.sourceSha = sha;
  return { cwd, expectedRoot: cwd, expectedSha: sha, documentedChanges: "test fixture changes", mode: "offline-fixture", body: "controlled-fixture", provider: "scripted-in-process", database: ":memory:", outputDirectory: join(cwd, "artifacts/v1/test-run"), fixturePaths: [], manifest, minecraftPort: null, host: "127.0.0.1", binaries: ["node", "git"] };
}
describe("read-only preflight blocks unsafe startup", () => {
  it("accepts matching offline configuration and records binary versions", () => { const result = checkPreflight(config()); expect(result.failures).toEqual([]); expect(result.versions.node).toMatch(/^v/); });
  it.each(["port", "provider", "body", "database", "host", "sha", "output", "mode"])("refuses %s before startup callback", (kind) => {
    const c = config(), start = vi.fn();
    if (kind === "port") c.minecraftPort = 25565;
    if (kind === "provider") c.provider = "openai";
    if (kind === "body") c.body = "mineflayer";
    if (kind === "database") c.database = "data/civilization.sqlite";
    if (kind === "host") c.host = "example.com";
    if (kind === "sha") c.expectedSha = "b".repeat(40);
    if (kind === "output") c.outputDirectory = join(c.cwd, "data");
    if (kind === "mode") c.mode = "public-live-demonstration";
    expect(() => { requirePreflight(c); start(); }).toThrow(/refused/); expect(start).not.toHaveBeenCalled();
  });
  it("detects traversal and symlink ancestor escapes", () => {
    const root = mkdtempSync(join(tmpdir(), "v1-path-")); paths.push(root);
    const inside = join(root, "inside"), outside = join(root, "outside"); mkdirSync(inside); mkdirSync(outside);
    symlinkSync(outside, join(inside, "link"), process.platform === "win32" ? "junction" : "dir");
    expect(contained(inside, join(inside, "link/new"))).toBe(false);
    expect(contained(inside, join(inside, "../outside"))).toBe(false);
  });
});

