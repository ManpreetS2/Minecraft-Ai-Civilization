import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** QA #39 assertions replayed as ordinary regressions against the integrated patch. Original source: 991634be7fa4ead2dd5a050a82c40aaabb110f7a. Disposable fixtures only. */
const fixture = vi.hoisted(() => ({ root: "" }));
vi.mock("@civ/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@civ/shared")>();
  const path = await import("node:path");
  return { ...actual, resolveFromRoot: (p: string) => path.resolve(fixture.root, p) };
});

import { assertIsolatedNotOriginal, evaluateConstructionExperimentLive, openVerifiedConstructionDatabaseFile } from "./construction-experiment-guard.js";

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

beforeEach(() => {
  fixture.root = mkdtempSync(join(tmpdir(), "civ-qa-guard-"));
  mkdirSync(join(fixture.root, "world-lab/inner"), { recursive: true });
  mkdirSync(join(fixture.root, "data"));
  mkdirSync(join(fixture.root, "isolated"));
  writeFileSync(join(fixture.root, "data/world-lab-civilization.sqlite"), "protected fixture");
  writeFileSync(join(fixture.root, "isolated/test.sqlite"), "isolated fixture");
  writeFileSync(join(fixture.root, "world-lab/inner/level.dat"), "protected fixture");
});
afterEach(() => rmSync(fixture.root, { recursive: true, force: true, maxRetries: 3 }));

describe("QA: the live gate (controls that must keep passing)", () => {
  it("allows the approved disposable configuration", () => {
    expect(evaluateConstructionExperimentLive(approvedEnv()).allowed).toBe(true);
  });
  it.each([
    ["live civilization port", { MINECRAFT_PORT: "25565" }],
    ["original world-lab port", { MINECRAFT_PORT: "25567" }],
    ["original RCON port", { CONSTRUCTION_EXPERIMENT_RCON_PORT: "25577" }],
    ["default RCON port", { CONSTRUCTION_EXPERIMENT_RCON_PORT: "25575" }],
    ["padded port text", { MINECRAFT_PORT: " 25568 " }],
    ["hex port text", { MINECRAFT_PORT: "0x63d0" }],
    ["auto-started Paper", { AUTO_START_PAPER: "true" }],
    ["capitalized approval", { CONSTRUCTION_EXPERIMENT_ALLOW_LIVE: "True" }],
    ["world-lab inside the protected world", { CONSTRUCTION_EXPERIMENT_WORLD_LAB: "world-lab/inner" }],
    ["database inside the protected world", { DATABASE_PATH: "world-lab/inner/level.dat" }],
    ["upper-case spelling of the protected world", { CONSTRUCTION_EXPERIMENT_WORLD_LAB: "WORLD-LAB/inner" }],
  ])("refuses %s", (_name, override) => {
    expect(evaluateConstructionExperimentLive({ ...approvedEnv(), ...override }).allowed).toBe(false);
  });
  it("refuses a forged or replayed handoff", () => {
    const gate = evaluateConstructionExperimentLive(approvedEnv());
    if (!gate.allowed) throw new Error(gate.error);
    expect(openVerifiedConstructionDatabaseFile({ ...gate })).toMatchObject({ ok: false });
    const first = openVerifiedConstructionDatabaseFile(gate);
    expect(first.ok).toBe(true);
    if (first.ok) first.close();
    expect(openVerifiedConstructionDatabaseFile(gate)).toMatchObject({ ok: false });
  });
});

describe("QA #39: closed regressions", () => {
  it("GAP 1: a non-loopback MINECRAFT_HOST passes the live gate (host is pinned in a table but never checked)", () => {
    const gate = evaluateConstructionExperimentLive({ ...approvedEnv(), MINECRAFT_HOST: "mc.example.com" });
    expect(gate.allowed).toBe(false);
  });
  it("GAP 2: Paper and RCON may share one port", () => {
    const gate = evaluateConstructionExperimentLive({ ...approvedEnv(), MINECRAFT_PORT: "25578", CONSTRUCTION_EXPERIMENT_RCON_PORT: "25578" });
    expect(gate.allowed).toBe(false);
  });
  it("GAP 3: evidence may be written beside the protected database in its data directory", () => {
    const gate = evaluateConstructionExperimentLive({ ...approvedEnv(), CONSTRUCTION_EXPERIMENT_EVIDENCE_DIR: "data/evidence" });
    expect(gate.allowed).toBe(false);
  });
});

describe("QA: further controls", () => {
  it.skipIf(process.platform !== "win32")("refuses an 8.3 short-name spelling of a path inside the protected world (when the volume has short names)", () => {
    const long = join(fixture.root, "world-lab", "inner");
    const short = execFileSync("cmd.exe", ["/d", "/c", `for %I in ("${long}") do @echo %~sI`], { encoding: "utf8" }).trim();
    if (short.toLowerCase() === long.toLowerCase()) return; // 8.3 names are disabled here, so there is no alias to test.
    expect(assertIsolatedNotOriginal({ isolatedWorldLab: short, isolatedSqlite: "isolated/test.sqlite" }).ok).toBe(false);
  });
});
