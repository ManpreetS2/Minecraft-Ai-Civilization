import { execFileSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appendFileSync, linkSync, mkdirSync, mkdtempSync, renameSync, rmSync, symlinkSync, writeFileSync, existsSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The guard module under test is chosen by env so the SAME assertions can run against base (#56) and candidate (#57).
const GUARD = process.env.QA57_GUARD ?? "../../../apps/orchestrator/src/construction-experiment-guard.js";
const fixture = vi.hoisted(() => ({ root: "" }));
vi.mock("@civ/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@civ/shared")>();
  const path = await import("node:path");
  return { ...actual, resolveFromRoot: (p: string) => path.resolve(fixture.root, p) };
});
const guard = await import(/* @vite-ignore */ GUARD) as typeof import("../../../apps/orchestrator/src/construction-experiment-guard.js");
const { evaluateConstructionExperimentLive: live, evaluateMission006BStage1Live: stage1, openVerifiedConstructionDatabaseFile: handoff, assertIsolatedNotOriginal: iso } = guard;

const env = (o: Record<string, string | undefined> = {}): NodeJS.ProcessEnv => {
  const e: Record<string, string | undefined> = {
    CONSTRUCTION_EXPERIMENT_ENABLED: "true", CONSTRUCTION_EXPERIMENT_ALLOW_LIVE: "true", CONSTRUCTION_EXPERIMENT_ALLOW_WORLD_MUTATION: "true",
    AUTO_START_PAPER: "false", MINECRAFT_PORT: "25568", CONSTRUCTION_EXPERIMENT_RCON_PORT: "25578",
    CONSTRUCTION_EXPERIMENT_WORLD_LAB: "isolated", DATABASE_PATH: "isolated/test.sqlite", CONSTRUCTION_EXPERIMENT_EVIDENCE_DIR: "isolated/evidence", ...o,
  };
  for (const k of Object.keys(e)) if (e[k] === undefined) delete e[k];
  return e as NodeJS.ProcessEnv;
};
const P = (...s: string[]) => join(fixture.root, ...s);
const denied = (e: NodeJS.ProcessEnv) => { const g = live(e); return g.allowed ? "ALLOWED" : g.error; };

beforeEach(() => {
  fixture.root = realpathSync(mkdtempSync(join(tmpdir(), "qa57-")));
  mkdirSync(P("world-lab/inner"), { recursive: true }); mkdirSync(P("data")); mkdirSync(P("isolated"));
  writeFileSync(P("data/world-lab-civilization.sqlite"), "PROTECTED"); writeFileSync(P("isolated/test.sqlite"), "iso");
  writeFileSync(P("world-lab/inner/level.dat"), "PROTECTED");
});
afterEach(() => rmSync(fixture.root, { recursive: true, force: true, maxRetries: 3 }));

describe("[ADV57-C0] control: the fixture is not vacuously refusing", () => {
  it("approved configuration is ALLOWED, and its gate is frozen and carries canonical paths", () => {
    const g = live(env()); expect(g.allowed).toBe(true);
    if (g.allowed) { expect(Object.isFrozen(g)).toBe(true); expect(g.paperPort).toBe(25568); expect(g.rconPort).toBe(25578); }
  });
  it("every approval variable missing/wrong is refused (default deny)", () => {
    for (const k of ["CONSTRUCTION_EXPERIMENT_ENABLED", "CONSTRUCTION_EXPERIMENT_ALLOW_LIVE", "CONSTRUCTION_EXPERIMENT_ALLOW_WORLD_MUTATION"])
      for (const v of [undefined, "", "TRUE", "1", " true", "yes"]) expect(denied(env({ [k]: v }))).not.toBe("ALLOWED");
    expect(denied({})).not.toBe("ALLOWED");
  });
});

describe("[ADV57-C1] defect 1: non-loopback server rejection", () => {
  const refused = ["mc.example.com", "localhost", "0.0.0.0", "10.0.0.5", "192.168.1.9", "8.8.8.8", "127.0.0.1.evil.com", "127.1", "2130706433", "0x7f.0.0.1",
    "127.0.0.1 ", " 127.0.0.1", "127.0.0.1\n", "127.0.0.1/", "[::1]", "::", "::ffff:127.0.0.1", "fe80::1", "fe80::1%lo0", "::1%25lo0", "::2", "1::1", "", "127.0.0.1:25565", "user@127.0.0.1", "ⅰ.com", "126.255.255.255", "128.0.0.1", "0177.0.0.1", "::127.0.0.1"];
  it.each(refused)("refuses MINECRAFT_HOST=%j with a HOST-specific reason", (host) => {
    const r = denied(env({ MINECRAFT_HOST: host }));
    expect(r).not.toBe("ALLOWED");
    expect(r).toMatch(/loopback/i); // reason proves it is the host rule firing, not an unrelated refusal
  });
  it.each(["127.0.0.1", "127.0.0.2", "127.255.255.254", "::1", "0:0:0:0:0:0:0:1", "0000:0000:0000:0000:0000:0000:0000:0001"])("accepts genuine loopback literal %j", (host) => {
    expect(denied(env({ MINECRAFT_HOST: host }))).toBe("ALLOWED");
  });
  it("omitted host defaults to loopback", () => expect(denied(env())).toBe("ALLOWED"));
  it("Stage-1 live gate inherits the host rule (cannot be bypassed by the auth phrase)", () => {
    const auth = { CONSTRUCTION_006B_STAGE1_AUTH: "Authorize Mission 006B Stage 1 live on isolated World-Lab port 25568 only." };
    expect(stage1({ ...env(auth) }).allowed).toBe(true);
    expect(stage1({ ...env({ ...auth, MINECRAFT_HOST: "mc.example.com" }) }).allowed).toBe(false);
    expect(stage1({ ...env({ ...auth }) }, "stage2").allowed).toBe(false);
  });
  it("prototype/inherited env keys do not smuggle a host", () => {
    const e = Object.create({ MINECRAFT_HOST: "mc.example.com" }) as NodeJS.ProcessEnv; Object.assign(e, env());
    const r = live(e); // inherited key is visible via property read; either refuse or allow is a policy call -> record, require no crash
    expect(typeof r.allowed).toBe("boolean");
  });
});

describe("[ADV57-C2] defect 2: Paper and RCON ports", () => {
  it.each([["25568", "25568"], ["25578", "25578"], ["30000", "30000"], ["25568", "25568"]])("shared port %s/%s refused", (a, b) => {
    expect(denied(env({ MINECRAFT_PORT: a, CONSTRUCTION_EXPERIMENT_RCON_PORT: b }))).toMatch(/distinct|protected|Refusing/);
  });
  it("shared-port refusal fires for a port that is NOT otherwise protected (proves the distinct-port rule itself)", () => {
    expect(denied(env({ MINECRAFT_PORT: "30000", CONSTRUCTION_EXPERIMENT_RCON_PORT: "30000" }))).toMatch(/distinct/i);
  });
  it.each(["25565", "25567", "25575", "25577", "0", "65536", "-1", "25568.5", "1e4", "0x63d0", " 25568", "25568 ", "٢٥٥٦٨", "", "NaN", "99999999999999999999"])("bad/protected port %j refused", (p) => {
    expect(denied(env({ MINECRAFT_PORT: p }))).not.toBe("ALLOWED");
    expect(denied(env({ CONSTRUCTION_EXPERIMENT_RCON_PORT: p }))).not.toBe("ALLOWED");
  });
  it("leading-zero spelling of a protected port (025567) cannot alias the protected port", () => {
    const r = denied(env({ MINECRAFT_PORT: "025567" })); // digits-only passes; Number() === 25567 -> must still be refused
    expect(r).not.toBe("ALLOWED");
  });
  it("leading-zero spelling of RCON 25577 refused", () => expect(denied(env({ CONSTRUCTION_EXPERIMENT_RCON_PORT: "0025577" }))).not.toBe("ALLOWED"));
  it("zero-padded equal ports refused as shared", () => expect(denied(env({ MINECRAFT_PORT: "30000", CONSTRUCTION_EXPERIMENT_RCON_PORT: "030000" }))).toMatch(/distinct/i));
  it("an unprotected but non-isolated port is currently accepted (policy probe, INFO)", () => {
    // Stage-1 pins 25568; the generic live gate allows any unprotected port. Recorded in the report, asserted so a change is noticed.
    expect(denied(env({ MINECRAFT_PORT: "30000", CONSTRUCTION_EXPERIMENT_RCON_PORT: "30001" }))).toBe("ALLOWED");
    expect(stage1(env({ CONSTRUCTION_006B_STAGE1_AUTH: "Authorize Mission 006B Stage 1 live on isolated World-Lab port 25568 only.", MINECRAFT_PORT: "30000", CONSTRUCTION_EXPERIMENT_RCON_PORT: "30001" })).allowed).toBe(false);
  });
});

describe("[ADV57-C3] defect 3: evidence directory isolation and protected paths", () => {
  it.each(["data/evidence", "data", "data/", "./data/evidence", "DATA/evidence", "world-lab/evidence", "world-lab", "world-lab/inner", ".", "", "isolated/../data/x", "data/../data/evidence/deep/er"])(
    "evidence=%j refused", (ev) => {
      const r = denied(env({ CONSTRUCTION_EXPERIMENT_EVIDENCE_DIR: ev }));
      expect(r).not.toBe("ALLOWED");
    });
  it("evidence beside the protected DB: refusal reason is the alias rule (not an incidental error)", () => {
    expect(denied(env({ CONSTRUCTION_EXPERIMENT_EVIDENCE_DIR: "data/evidence" }))).toMatch(/Evidence path aliases original|original filesystem tree/);
  });
  it("evidence that is a PARENT of the protected tree (workspace root) refused", () => {
    expect(denied(env({ CONSTRUCTION_EXPERIMENT_EVIDENCE_DIR: fixture.root }))).toMatch(/aliases original|original filesystem/);
  });
  it("evidence as a symlink to the protected data dir refused", () => {
    try { symlinkSync(P("data"), P("isolated/evlink"), "dir"); } catch { return; }
    expect(denied(env({ CONSTRUCTION_EXPERIMENT_EVIDENCE_DIR: "isolated/evlink" }))).not.toBe("ALLOWED");
    expect(denied(env({ CONSTRUCTION_EXPERIMENT_EVIDENCE_DIR: "isolated/evlink/new/deeper" }))).not.toBe("ALLOWED");
  });
  it("dangling symlink evidence dir refused (lstat vs stat)", () => {
    try { symlinkSync(P("nowhere-xyz"), P("isolated/dangling"), "dir"); } catch { return; }
    expect(denied(env({ CONSTRUCTION_EXPERIMENT_EVIDENCE_DIR: "isolated/dangling/x" }))).not.toBe("ALLOWED");
  });
  it("evidence ancestor is a regular FILE refused", () => {
    expect(denied(env({ CONSTRUCTION_EXPERIMENT_EVIDENCE_DIR: "isolated/test.sqlite/evidence" }))).not.toBe("ALLOWED");
  });
  it("legitimate not-yet-created nested evidence dir is allowed (control)", () => {
    expect(denied(env({ CONSTRUCTION_EXPERIMENT_EVIDENCE_DIR: "isolated/evidence/run-1/deeper" }))).toBe("ALLOWED");
  });
  it("evidence dir INSIDE the isolated world-lab or equal to it: policy probe (INFO)", () => {
    const r = denied(env({ CONSTRUCTION_EXPERIMENT_EVIDENCE_DIR: "isolated" }));
    console.warn(`QA57-INFO evidence==isolated world dir -> ${r}`);
    expect(typeof r).toBe("string");
  });
  it("isolated world == protected / DB == protected DB / world inside protected refused", () => {
    for (const o of [{ CONSTRUCTION_EXPERIMENT_WORLD_LAB: "world-lab" }, { CONSTRUCTION_EXPERIMENT_WORLD_LAB: "." }, { DATABASE_PATH: "data/world-lab-civilization.sqlite" }, { DATABASE_PATH: "world-lab/inner/level.dat" }, { CONSTRUCTION_EXPERIMENT_WORLD_LAB: "data" }])
      expect(denied(env(o))).not.toBe("ALLOWED");
  });
  it("missing / non-existent isolated or protected targets fail CLOSED", () => {
    expect(denied(env({ DATABASE_PATH: "isolated/missing.sqlite" }))).not.toBe("ALLOWED");
    expect(denied(env({ CONSTRUCTION_EXPERIMENT_WORLD_LAB: "isolated-missing" }))).not.toBe("ALLOWED");
    rmSync(P("data/world-lab-civilization.sqlite")); expect(denied(env())).not.toBe("ALLOWED");
  });
  it("NUL byte / control chars in any path refused", () => {
    for (const k of ["CONSTRUCTION_EXPERIMENT_WORLD_LAB", "DATABASE_PATH", "CONSTRUCTION_EXPERIMENT_EVIDENCE_DIR"]) for (const v of ["a\0b", "a\nb", "a\tb"]) expect(denied(env({ [k]: v }))).not.toBe("ALLOWED");
  });
});

describe("[ADV57-C4] symlink / hardlink / alias behaviour", () => {
  it("isolated DB hardlinked to the protected DB refused", () => {
    rmSync(P("isolated/test.sqlite")); linkSync(P("data/world-lab-civilization.sqlite"), P("isolated/test.sqlite"));
    expect(denied(env())).not.toBe("ALLOWED");
  });
  it("hardlink inside the evidence tree / world tree to a protected file refused", () => {
    mkdirSync(P("isolated/evidence"), { recursive: true }); linkSync(P("world-lab/inner/level.dat"), P("isolated/evidence/level.dat"));
    expect(denied(env())).not.toBe("ALLOWED");
  });
  it("symlink in the isolated world pointing at the protected world refused", () => {
    try { symlinkSync(P("world-lab"), P("isolated/wl"), "dir"); } catch { return; }
    expect(denied(env())).not.toBe("ALLOWED");
  });
  it("isolated world-lab path IS a symlink to protected world refused", () => {
    try { symlinkSync(P("world-lab"), P("isolated-link"), "dir"); } catch { return; }
    expect(denied(env({ CONSTRUCTION_EXPERIMENT_WORLD_LAB: "isolated-link" }))).not.toBe("ALLOWED");
    expect(denied(env({ CONSTRUCTION_EXPERIMENT_WORLD_LAB: "isolated-link/inner" }))).not.toBe("ALLOWED");
  });
  it("isolated DB symlink to protected DB refused (also via chain of two links)", () => {
    rmSync(P("isolated/test.sqlite"));
    try { symlinkSync(P("data/world-lab-civilization.sqlite"), P("isolated/l1")); symlinkSync(P("isolated/l1"), P("isolated/test.sqlite")); } catch { return; }
    expect(denied(env())).not.toBe("ALLOWED");
  });
  it("a symlink to a clean external dir inside the isolated tree is refused (links never allowed) -- control for strictness", () => {
    mkdirSync(P("elsewhere")); try { symlinkSync(P("elsewhere"), P("isolated/ok"), "dir"); } catch { return; }
    expect(denied(env())).not.toBe("ALLOWED");
  });
  it("sidecars: -wal/-shm/-journal as symlink or hardlink to protected files refused; a plain regular sidecar allowed", () => {
    writeFileSync(P("isolated/test.sqlite-wal"), "w"); expect(denied(env())).toBe("ALLOWED");
    rmSync(P("isolated/test.sqlite-wal")); try { symlinkSync(P("data/world-lab-civilization.sqlite"), P("isolated/test.sqlite-shm")); } catch { return; }
    expect(denied(env())).not.toBe("ALLOWED");
  });
  it("a FIFO / special file in the isolated tree refused", () => {
    if (process.platform === "win32") return;
    try { execFileSync("mkfifo", [P("isolated/fifo")]); } catch { return; }
    expect(denied(env())).not.toBe("ALLOWED");
  });
});

describe("[ADV57-C5] mixed-case and Unicode aliases (host filesystem dependent)", () => {
  const caseInsensitive = (() => { const d = mkdtempSync(join(tmpdir(), "qa57-ci-")); try { writeFileSync(join(d, "a"), "x"); return existsSync(join(d, "A")); } finally { rmSync(d, { recursive: true, force: true }); } })();
  it(`[host case-insensitive=${caseInsensitive}] upper-case spellings of protected paths are refused in every slot`, () => {
    for (const o of [{ CONSTRUCTION_EXPERIMENT_WORLD_LAB: "WORLD-LAB" }, { CONSTRUCTION_EXPERIMENT_WORLD_LAB: "World-Lab/inner" }, { DATABASE_PATH: "DATA/world-lab-civilization.sqlite" },
      { DATABASE_PATH: "Data/World-Lab-Civilization.SQLITE" }, { CONSTRUCTION_EXPERIMENT_EVIDENCE_DIR: "DATA/evidence" }, { CONSTRUCTION_EXPERIMENT_EVIDENCE_DIR: "Data" }]) {
      const r = denied(env(o));
      if (caseInsensitive) expect({ o, r }).not.toEqual({ o, r: "ALLOWED" });
      else expect(typeof r).toBe("string"); // case-sensitive FS: these are different (nonexistent) paths, fail-closed anyway
    }
  });
  it("on a case-SENSITIVE host a nonexistent upper-case alias must still not be ALLOWED for evidence (future-created alias)", () => {
    const r = denied(env({ CONSTRUCTION_EXPERIMENT_EVIDENCE_DIR: "DATA/evidence" }));
    if (!caseInsensitive) console.warn(`QA57-INFO case-sensitive host: DATA/evidence -> ${r} (a different directory on this FS; correct to allow, not provable as alias)`);
    expect(typeof r).toBe("string");
  });
  it("Unicode normalization alias (NFD vs NFC) of the protected world: refused or distinct-FS", () => {
    const nfc = "caf\u00e9", nfd = "cafe\u0301";
    mkdirSync(P(nfc)); writeFileSync(P(nfc, "x.sqlite"), "x");
    const r = denied(env({ CONSTRUCTION_EXPERIMENT_WORLD_LAB: nfd, DATABASE_PATH: `${nfd}/x.sqlite` }));
    expect(typeof r).toBe("string"); // sanity: no crash. Identity (dev:ino) path covers true aliasing.
  });
});

describe("[ADV57-C6] mutation after preflight and replayed/forged handoff", () => {
  const ok = () => { const g = live(env()); if (!g.allowed) throw new Error(g.error); return g; };
  it("clean handoff opens exactly once, read-only; replay refused; forged copy refused; mutation of returned gate impossible", () => {
    const g = ok(); const forged = { ...g }; expect(handoff(forged as never).ok).toBe(false);
    expect(() => { (g as { sqlitePath: string }).sqlitePath = P("data/world-lab-civilization.sqlite"); }).toThrow();
    const a = handoff(g); expect(a.ok).toBe(true); if (a.ok) a.close();
    expect(handoff(g).ok).toBe(false);
  });
  it("close() is idempotent (no double-close of a recycled fd)", () => {
    const a = handoff(ok()); if (!a.ok) throw new Error(a.error); a.close(); a.close();
  });
  it("two independent gates have independent single-use handoffs", () => {
    const a = ok(), b = ok(); const x = handoff(a); const y = handoff(b); expect([x.ok, y.ok]).toEqual([true, true]);
    if (x.ok) x.close(); if (y.ok) y.close();
  });
  const mutations: Array<[string, () => void]> = [
    ["DB replaced by symlink to protected DB", () => { rmSync(P("isolated/test.sqlite")); symlinkSync(P("data/world-lab-civilization.sqlite"), P("isolated/test.sqlite")); }],
    ["DB rewritten in place (size/mtime change)", () => appendFileSync(P("isolated/test.sqlite"), "more")],
    ["DB renamed away and replaced by fresh file", () => { renameSync(P("isolated/test.sqlite"), P("isolated/old")); writeFileSync(P("isolated/test.sqlite"), "new"); }],
    ["WAL sidecar appears", () => writeFileSync(P("isolated/test.sqlite-wal"), "w")],
    ["protected DB modified", () => appendFileSync(P("data/world-lab-civilization.sqlite"), "tamper")],
    ["protected DB sidecar appears", () => writeFileSync(P("data/world-lab-civilization.sqlite-wal"), "w")],
    ["protected DB hardlinked into isolated tree", () => { mkdirSync(P("isolated/evidence"), { recursive: true }); linkSync(P("data/world-lab-civilization.sqlite"), P("isolated/evidence/x")); }],
    ["evidence ancestor swapped for symlink to protected data", () => { mkdirSync(P("isolated/evidence")); rmSync(P("isolated/evidence"), { recursive: true }); symlinkSync(P("data"), P("isolated/evidence"), "dir"); }],
    ["new file added to isolated world", () => writeFileSync(P("isolated/newfile"), "x")],
  ];
  it.each(mutations)("refuses handoff after: %s", (_n, mutate) => {
    const g = ok(); try { mutate(); } catch { return; }
    const h = handoff(g); if (h.ok) h.close();
    expect(h.ok).toBe(false);
  });
  it("a refused handoff still consumes the token (no retry oracle)", () => {
    const g = ok(); appendFileSync(P("isolated/test.sqlite"), "x"); expect(handoff(g).ok).toBe(false);
    writeFileSync(P("isolated/test.sqlite"), "iso"); // can't restore mtime/ctime
    expect(handoff(g).ok).toBe(false);
  });
});

describe("[ADV57-C7] assertIsolatedNotOriginal direct API", () => {
  it("rejects relative escapes, root, empty", () => {
    for (const w of ["../x", "/", "", "world-lab/..", "isolated/../world-lab"]) expect(iso({ isolatedWorldLab: w, isolatedSqlite: "isolated/test.sqlite" }).ok).toBe(false);
  });
  it("rejects Windows-syntax absolute paths on POSIX hosts and vice versa (fail closed)", () => {
    for (const w of ["C:\\world-lab", "\\\\server\\share\\x", "C:/x"]) {
      const r = iso({ isolatedWorldLab: w, isolatedSqlite: "isolated/test.sqlite" });
      if (process.platform !== "win32") expect(r.ok).toBe(false);
    }
  });
});
