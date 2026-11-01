import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { linkSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const fixture = vi.hoisted(() => ({ root: "" }));
vi.mock("@civ/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@civ/shared")>();
  const path = await import("node:path");
  return { ...actual, resolveFromRoot: (p: string) => path.resolve(fixture.root, p) };
});
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, realpathSync: vi.fn(actual.realpathSync) };
});

import { assertIsolatedNotOriginal, evaluateConstructionExperimentLive, pathsAliasSameTree, validatePathExists } from "./construction-experiment-guard.js";

describe("host-independent path syntax (lexical semantics, not foreign OS execution)", () => {
  it.each([
    ["C:\\a\\world-lab\\", "c:/a/world-lab/world", true],
    ["C:/a/world-lab/", "C:/a/world-lab", true],
    ["C:/a/x/../world-lab", "C:/a/world-lab/world", true],
    ["C:/a/world-lab", "C:/a/world-lab-copy", false],
    ["C:/", "C:/a/world-lab", true],
    ["C:/a/world-lab", "D:/a/world-lab", false],
    ["\\\\server\\share\\world-lab\\", "//SERVER/SHARE/world-lab/world", true],
    ["//server/share/", "//server/share/world", true],
    ["//server/share/world", "//server/share2/world", false],
    ["/sandbox/world-lab/", "/sandbox/world-lab", true],
    ["/", "/sandbox/world-lab", true],
    ["/sandbox/World", "/sandbox/world", false],
    ["/sandbox/world/../safe", "/sandbox/world", false],
    ["/sandbox/world", "/sandbox/world-copy", false],
    ["C:/sandbox/world", "/sandbox/world", true],
  ])("compares %s and %s", (a, b, expected) => {
    expect(pathsAliasSameTree(a, b)).toBe(expected);
    expect(pathsAliasSameTree(b, a)).toBe(expected);
  });

  it.each(["", "relative/world", "C:world", "\\world", "C:/world.", "C:/world ", "C:/world:stream", "\\\\?\\C:\\world", "//server", "bad\0path"])("refuses to certify ambiguous identity %j", (path) => {
    // true means isolation cannot be established, so callers must refuse.
    expect(pathsAliasSameTree(path, "C:/protected")).toBe(true);
  });
});

describe("canonical isolation on the actual host filesystem", () => {
  beforeEach(async () => {
    const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
    vi.mocked(realpathSync).mockImplementation(actual.realpathSync);
    fixture.root = mkdtempSync(join(tmpdir(), "civ-isolation-"));
    mkdirSync(join(fixture.root, "world-lab"));
    mkdirSync(join(fixture.root, "data"));
    mkdirSync(join(fixture.root, "isolated"));
    writeFileSync(join(fixture.root, "data/world-lab-civilization.sqlite"), "disposable protected fixture");
    writeFileSync(join(fixture.root, "isolated/test.sqlite"), "disposable isolated fixture");
  });
  afterEach(() => {
    vi.clearAllMocks();
    rmSync(fixture.root, { recursive: true, force: true, maxRetries: 3 });
  });
  const check = (isolatedWorldLab = "isolated", isolatedSqlite = "isolated/test.sqlite") =>
    assertIsolatedNotOriginal({ isolatedWorldLab, isolatedSqlite });

  it("allows physically distinct disposable targets", () => {
    expect(check()).toEqual({ ok: true });
  });
  it("rejects an isolated directory junction/symlink to the protected world", () => {
    symlinkSync(join(fixture.root, "world-lab"), join(fixture.root, "alias"), process.platform === "win32" ? "junction" : "dir");
    expect(check("alias").ok).toBe(false);
  });
  it("rejects an isolated database inside the protected world", () => {
    writeFileSync(join(fixture.root, "world-lab/test.sqlite"), "fixture");
    expect(check("isolated", "world-lab/test.sqlite").ok).toBe(false);
  });
  it("rejects a database hard link to the protected database", () => {
    linkSync(join(fixture.root, "data/world-lab-civilization.sqlite"), join(fixture.root, "isolated/hardlink.sqlite"));
    expect(check("isolated", "isolated/hardlink.sqlite").ok).toBe(false);
  });
  it("fails closed when canonical identity cannot be read", () => {
    vi.mocked(realpathSync).mockImplementationOnce(() => { throw new Error("access denied"); });
    expect(validatePathExists("isolated", "fixture").ok).toBe(false);
  });
  it("rejects missing candidates", () => {
    expect(check("missing").ok).toBe(false);
  });

  const approvedEnv = (): NodeJS.ProcessEnv => ({
    CONSTRUCTION_EXPERIMENT_ENABLED: "true",
    CONSTRUCTION_EXPERIMENT_ALLOW_LIVE: "true",
    CONSTRUCTION_EXPERIMENT_ALLOW_WORLD_MUTATION: "true",
    AUTO_START_PAPER: "false",
    MINECRAFT_PORT: "25568",
    CONSTRUCTION_EXPERIMENT_RCON_PORT: "25578",
    CONSTRUCTION_EXPERIMENT_WORLD_LAB: "isolated",
    DATABASE_PATH: "isolated/test.sqlite",
    CONSTRUCTION_EXPERIMENT_EVIDENCE_DIR: "isolated/evidence",
  });
  it("allows a valid gate with canonical paths and a new evidence directory", () => {
    const gate = evaluateConstructionExperimentLive(approvedEnv());
    expect(gate.allowed).toBe(true);
    if (!gate.allowed) throw new Error(gate.error);
    expect(gate.worldLabDir).toBe(realpathSync(join(fixture.root, "isolated")));
    expect(gate.sqlitePath).toBe(realpathSync(join(fixture.root, "isolated/test.sqlite")));
    expect(gate.evidenceDir).toBe(join(gate.worldLabDir, "evidence"));
  });
  it("rejects evidence redirected through a junction into the protected world", () => {
    symlinkSync(join(fixture.root, "world-lab"), join(fixture.root, "alias"), process.platform === "win32" ? "junction" : "dir");
    expect(evaluateConstructionExperimentLive({ ...approvedEnv(), CONSTRUCTION_EXPERIMENT_EVIDENCE_DIR: "alias/new/evidence" }).allowed).toBe(false);
  });
  it("returns a refusal for an unsupported evidence path without throwing", () => {
    expect(evaluateConstructionExperimentLive({ ...approvedEnv(), CONSTRUCTION_EXPERIMENT_EVIDENCE_DIR: "\\\\?\\C:\\world" }).allowed).toBe(false);
  });
  it("fails closed when the isolated candidate canonical lookup fails", () => {
    const actual = vi.mocked(realpathSync).getMockImplementation()!;
    vi.mocked(realpathSync).mockImplementation((p) => {
      if (String(p) === join(fixture.root, "isolated")) throw new Error("unreadable candidate");
      return actual(p);
    });
    expect(check().ok).toBe(false);
  });
  it("rejects a dangling evidence junction/symlink rather than treating it as a new directory", () => {
    const target = join(fixture.root, "temporary-target");
    mkdirSync(target);
    symlinkSync(target, join(fixture.root, "dangling"), process.platform === "win32" ? "junction" : "dir");
    rmSync(target, { recursive: true });
    expect(evaluateConstructionExperimentLive({ ...approvedEnv(), CONSTRUCTION_EXPERIMENT_EVIDENCE_DIR: "dangling" }).allowed).toBe(false);
  });
  it("requires native unambiguous syntax before touching the filesystem", () => {
    const foreign = process.platform === "win32" ? "C:relative/world" : "C:/foreign/world";
    const calls = vi.mocked(realpathSync).mock.calls.length;
    expect(validatePathExists(foreign, "foreign").ok).toBe(false);
    expect(vi.mocked(realpathSync).mock.calls).toHaveLength(calls);
  });
  it.each(["isolated", "world-lab"])("rejects a directory used as SQLite target: %s", (path) => {
    expect(check("isolated", path).ok).toBe(false);
  });
  it.each(["", "0", "-1", "65536", "NaN", "Infinity", "25568.5", "not-a-port"])("refuses invalid paper and RCON ports %j", (port) => {
    expect(evaluateConstructionExperimentLive({ ...approvedEnv(), MINECRAFT_PORT: port }).allowed).toBe(false);
    expect(evaluateConstructionExperimentLive({ ...approvedEnv(), CONSTRUCTION_EXPERIMENT_RCON_PORT: port }).allowed).toBe(false);
  });
  it.each([
    ["MINECRAFT_PORT", "25565"],
    ["MINECRAFT_PORT", "25567"],
    ["CONSTRUCTION_EXPERIMENT_RCON_PORT", "25575"],
    ["CONSTRUCTION_EXPERIMENT_RCON_PORT", "25577"],
  ])("keeps the existing protected port refusal for %s=%s", (key, port) => {
    expect(evaluateConstructionExperimentLive({ ...approvedEnv(), [key]: port }).allowed).toBe(false);
  });
});
