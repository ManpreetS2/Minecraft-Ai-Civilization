import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// NO module mocks: real @civ/shared workspaceRoot()/resolveFromRoot() discovering pnpm-workspace.yaml from process.cwd(),
// real default paths (ISOLATED_* constants), real node:fs. This is the "is it only the test environment?" probe.
import { loadConfig } from "@civ/shared";
import { evaluateConstructionExperimentLive as live, ISOLATED_EVIDENCE_REL, ISOLATED_SQLITE_REL, ISOLATED_WORLD_LAB_REL, openVerifiedConstructionDatabaseFile } from "../../../apps/orchestrator/src/construction-experiment-guard.js";

const APPROVE = { CONSTRUCTION_EXPERIMENT_ENABLED: "true", CONSTRUCTION_EXPERIMENT_ALLOW_LIVE: "true", CONSTRUCTION_EXPERIMENT_ALLOW_WORLD_MUTATION: "true", AUTO_START_PAPER: "false" };
let ws = ""; const cwd0 = process.cwd();
beforeEach(() => {
  ws = realpathSync(mkdtempSync(join(tmpdir(), "qa57-ws-")));
  writeFileSync(join(ws, "pnpm-workspace.yaml"), "packages: []\n");
  mkdirSync(join(ws, "world-lab")); mkdirSync(join(ws, "data")); writeFileSync(join(ws, "data/world-lab-civilization.sqlite"), "PROTECTED");
  mkdirSync(join(ws, ISOLATED_WORLD_LAB_REL), { recursive: true }); writeFileSync(join(ws, ISOLATED_SQLITE_REL), "iso");
  process.chdir(ws);
});
afterEach(() => { process.chdir(cwd0); rmSync(ws, { recursive: true, force: true, maxRetries: 3 }); });
const run = (e: Record<string, string> = {}) => live({ ...APPROVE, ...e } as NodeJS.ProcessEnv);

describe("[ADV57-R] unmocked, default-path, real workspace discovery", () => {
  it("all-defaults configuration is allowed (control) and evidence defaults under the experiment root", () => {
    const g = run(); expect(g.allowed).toBe(true);
    if (g.allowed) { expect(g.evidenceDir).toBe(join(ws, ISOLATED_EVIDENCE_REL)); expect(g.paperPort).toBe(25568); expect(g.rconPort).toBe(25578); }
  });
  it("defect 1 (host) refused in the real environment", () => { expect(run({ MINECRAFT_HOST: "mc.example.com" }).allowed).toBe(false); expect(run({ MINECRAFT_HOST: "10.1.2.3" }).allowed).toBe(false); });
  it("defect 2 (shared port) refused in the real environment", () => { expect(run({ MINECRAFT_PORT: "30000", CONSTRUCTION_EXPERIMENT_RCON_PORT: "30000" }).allowed).toBe(false); });
  it("defect 3 (evidence beside protected DB) refused in the real environment", () => {
    const g = run({ CONSTRUCTION_EXPERIMENT_EVIDENCE_DIR: "data/evidence" }); expect(g.allowed).toBe(false);
    expect(run({ CONSTRUCTION_EXPERIMENT_EVIDENCE_DIR: join(ws, "data", "evidence") }).allowed).toBe(false); // absolute spelling
    expect(run({ CONSTRUCTION_EXPERIMENT_EVIDENCE_DIR: join(ws, "DATA", "evidence") }).allowed).toBe(false); // mixed case (case-insens. host)
  });
  it("workspace reached through a symlinked path (cwd = alias of root) still protects the originals", () => {
    const alias = join(tmpdir(), `qa57-alias-${process.pid}`); try { symlinkSync(ws, alias, "dir"); } catch { return; }
    try { process.chdir(alias);
      expect(run().allowed).toBe(true);
      expect(run({ CONSTRUCTION_EXPERIMENT_EVIDENCE_DIR: join(ws, "data", "evidence") }).allowed).toBe(false);
      expect(run({ CONSTRUCTION_EXPERIMENT_EVIDENCE_DIR: join(alias, "data", "evidence") }).allowed).toBe(false);
      expect(run({ CONSTRUCTION_EXPERIMENT_WORLD_LAB: join(alias, "world-lab") }).allowed).toBe(false);
      expect(run({ DATABASE_PATH: join(alias, "data", "world-lab-civilization.sqlite") }).allowed).toBe(false);
    } finally { process.chdir(ws); rmSync(alias, { force: true }); }
  });
  it("fresh-clone shape (no protected world-lab/data present) fails CLOSED, never open", () => {
    rmSync(join(ws, "world-lab"), { recursive: true }); expect(run().allowed).toBe(false);
  });
  it("isolated directory replaced by symlink to the protected world between runs is caught on the next run", () => {
    expect(run().allowed).toBe(true);
    rmSync(join(ws, ISOLATED_WORLD_LAB_REL), { recursive: true }); symlinkSync(join(ws, "world-lab"), join(ws, ISOLATED_WORLD_LAB_REL), "dir");
    expect(run().allowed).toBe(false);
  });
  it("end-to-end: gate -> handoff -> fd is a read-only descriptor of the isolated DB (cannot write)", async () => {
    const g = run(); if (!g.allowed) throw new Error(g.error);
    const h = openVerifiedConstructionDatabaseFile(g); if (!h.ok) throw new Error(h.error);
    const { writeSync, readSync, fstatSync } = await import("node:fs");
    expect(() => writeSync(h.fd, "x")).toThrow();
    const buf = Buffer.alloc(3); readSync(h.fd, buf, 0, 3, 0); expect(buf.toString()).toBe("iso");
    expect(fstatSync(h.fd).isFile()).toBe(true); h.close();
  });
  // ---- [LATENT DEFECT QA57-L3] The gate approves DEFAULT ports (25568/25578) and a default host when the env is silent, and its
  // result carries no host. The rest of the codebase resolves connection settings with loadConfig(), whose MINECRAFT_PORT default is
  // 25565 (the LIVE civilization port). Today no construction entry point connects (live body is deferred), so there is no exploit;
  // the first consumer that does `loadConfig(process.env)` after an approving gate would silently target the live port.
  it("a silent-env approval and loadConfig() agree on the Paper port the body would use", () => {
    const e = { ...APPROVE } as NodeJS.ProcessEnv;
    const g = live(e); if (!g.allowed) throw new Error(g.error);
    expect(loadConfig(e).MINECRAFT_PORT).toBe(g.paperPort);
  });
  it("the allowed gate exposes the vetted host so consumers need not re-read env", () => {
    const g = live({ ...APPROVE } as NodeJS.ProcessEnv); if (!g.allowed) throw new Error(g.error);
    expect(g).toHaveProperty("host");
  });
});
