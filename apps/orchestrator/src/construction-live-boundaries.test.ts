import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ root: "" }));
vi.mock("@civ/shared", async original => {
  const actual = await original<typeof import("@civ/shared")>();
  const path = await import("node:path");
  return { ...actual, resolveFromRoot: (p: string) => path.resolve(fixture.root, p) };
});
import { evaluateConstructionExperimentLive } from "./construction-experiment-guard.js";
const approved = (): NodeJS.ProcessEnv => ({
  CONSTRUCTION_EXPERIMENT_ENABLED: "true", CONSTRUCTION_EXPERIMENT_ALLOW_LIVE: "true",
  CONSTRUCTION_EXPERIMENT_ALLOW_WORLD_MUTATION: "true", AUTO_START_PAPER: "false",
  MINECRAFT_PORT: "25568", CONSTRUCTION_EXPERIMENT_RCON_PORT: "25578",
  CONSTRUCTION_EXPERIMENT_WORLD_LAB: "isolated/world", DATABASE_PATH: "isolated/test.sqlite",
  CONSTRUCTION_EXPERIMENT_EVIDENCE_DIR: "isolated/evidence",
});
beforeEach(() => {
  fixture.root = mkdtempSync(join(tmpdir(), "construction-boundaries-"));
  for (const directory of ["world-lab", "data", "isolated/world", "data/experiment-world", "data-copy"]) mkdirSync(join(fixture.root, directory), { recursive: true });
  for (const file of ["data/world-lab-civilization.sqlite", "data/experiment.sqlite", "isolated/test.sqlite"]) writeFileSync(join(fixture.root, file), "disposable fixture");
});
afterEach(() => rmSync(fixture.root, { recursive: true, force: true, maxRetries: 3 }));
describe("construction live endpoint and output boundaries (no network)", () => {
  it.each([undefined, "127.0.0.1", "127.0.0.2", "::1", "0:0:0:0:0:0:0:1"])("accepts a supported loopback literal %s", host => {
    expect(evaluateConstructionExperimentLive({ ...approved(), MINECRAFT_HOST: host }).allowed).toBe(true);
  });
  it.each(["mc.example.com", "localhost", "192.0.2.1", "0.0.0.0", "::", "[::1]", "127.0.0.1.example", "127.1", "2130706433", " 127.0.0.1 ", "", "::1%lo0", "fe80::1%1"])("rejects a remote, DNS or ambiguous host %j", host => {
    expect(evaluateConstructionExperimentLive({ ...approved(), MINECRAFT_HOST: host }).allowed).toBe(false);
  });
  it("rejects Paper and RCON sharing one port", () => {
    expect(evaluateConstructionExperimentLive({ ...approved(), MINECRAFT_PORT: "25578" }).allowed).toBe(false);
  });
  it.each([
    { MINECRAFT_PORT: "25577" }, { MINECRAFT_PORT: "25575" },
    { CONSTRUCTION_EXPERIMENT_RCON_PORT: "25565" }, { CONSTRUCTION_EXPERIMENT_RCON_PORT: "25567" },
  ])("rejects a protected port used by the other protocol: %j", override => {
    expect(evaluateConstructionExperimentLive({ ...approved(), ...override }).allowed).toBe(false);
  });
  it.each([
    { CONSTRUCTION_EXPERIMENT_EVIDENCE_DIR: "data/evidence" },
    { CONSTRUCTION_EXPERIMENT_WORLD_LAB: "data/experiment-world" },
    { DATABASE_PATH: "data/experiment.sqlite" },
  ])("rejects output inside the protected database directory: %j", override => {
    expect(evaluateConstructionExperimentLive({ ...approved(), ...override }).allowed).toBe(false);
  });
  it("preserves separator-delimited evidence ancestry checks", () => {
    expect(evaluateConstructionExperimentLive({ ...approved(), CONSTRUCTION_EXPERIMENT_EVIDENCE_DIR: "data-copy/evidence" }).allowed).toBe(true);
  });
  it("rejects a case alias of the protected data directory on a native case-insensitive filesystem", context => {
    const alias = join(fixture.root, "DATA");
    if (!existsSync(alias)) { context.skip(); return; }
    expect(evaluateConstructionExperimentLive({ ...approved(), CONSTRUCTION_EXPERIMENT_EVIDENCE_DIR: join(alias, "evidence") }).allowed).toBe(false);
  });

});
