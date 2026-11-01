import { afterAll, afterEach, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { BodyLock, DuplicateBodyError, pidAlive } from "./body-lock.js";

/**
 * OPS-001 (restart / crash recovery of the single-body lock). Real child processes only (no network, no Minecraft).
 */
const children: ChildProcess[] = [];
afterEach(() => {
  for (const child of children.splice(0)) child.kill("SIGKILL");
});

const tmpDirs: string[] = [];
const lockDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "ops-lock-"));
  tmpDirs.push(dir);
  return dir;
};
afterAll(() => {
  for (const dir of tmpDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      // best effort (Windows may still hold a handle)
    }
  }
});
// pid 0 / negative semantics are POSIX kill() semantics: not meaningful on Windows.
const posixIt = it.skipIf(process.platform === "win32");

function liveForeignPid(): number {
  const child = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { stdio: "ignore" });
  children.push(child);
  if (!child.pid) throw new Error("no pid");
  return child.pid;
}

async function deadPid(): Promise<number> {
  const child = spawn(process.execPath, ["-e", "0"], { stdio: "ignore" });
  const pid = child.pid;
  if (!pid) throw new Error("no pid");
  await new Promise((r) => child.once("exit", r));
  return pid;
}

describe("OPS-001 BodyLock crash recovery", () => {
  it("acquire writes our pid; a second acquire by the same process is idempotent; release removes the file", () => {
    const lock = new BodyLock("Atlas", lockDir());
    lock.acquire();
    expect(readFileSync(lock.filePath, "utf8")).toBe(String(process.pid));
    expect(() => lock.acquire()).not.toThrow();
    lock.release();
    expect(existsSync(lock.filePath)).toBe(false);
    expect(() => lock.release()).not.toThrow();
  });

  it("a lock left behind by a CRASHED process (dead pid) is taken over on restart", async () => {
    const dir = lockDir();
    const lock = new BodyLock("Atlas", dir);
    writeFileSync(lock.filePath, String(await deadPid()), "utf8");
    expect(() => lock.acquire()).not.toThrow();
    expect(readFileSync(lock.filePath, "utf8")).toBe(String(process.pid));
    lock.release();
  });

  it("a lock held by a LIVE foreign process refuses a duplicate body, and release() leaves the foreign lock alone", () => {
    const pid = liveForeignPid();
    const dir = lockDir();
    const lock = new BodyLock("Atlas", dir);
    writeFileSync(lock.filePath, String(pid), "utf8");
    expect(pidAlive(pid)).toBe(true);
    expect(() => lock.acquire()).toThrow(DuplicateBodyError);
    expect(() => lock.acquire()).toThrow(`pid ${pid}`);
    lock.release();
    expect(readFileSync(lock.filePath, "utf8")).toBe(String(pid));
  });

  it("release() clears a stale lock whose owner is dead, but not before", async () => {
    const lock = new BodyLock("Kai", lockDir());
    writeFileSync(lock.filePath, String(await deadPid()), "utf8");
    lock.release();
    expect(existsSync(lock.filePath)).toBe(false);
  });

  it.each(["", "   ", "not-a-pid", "-5"])("a corrupt lock file (%j) never blocks startup", (content) => {
    const lock = new BodyLock("Maya", lockDir());
    writeFileSync(lock.filePath, content, "utf8");
    expect(() => lock.acquire()).not.toThrow();
    expect(readFileSync(lock.filePath, "utf8")).toBe(String(process.pid));
    lock.release();
  });

  // FIXED (OPS-002): pidAlive used process.kill(pid, 0) for any finite pid, and kill(0, 0) targets the caller's own
  // process group and succeeds, so a lock file containing "0" (truncated write, manual edit) read as a live foreign body and
  // blocked that citizen's startup until the file was deleted by hand. pid <= 0 (and non-integers) are now never alive.
  posixIt("a lock file containing pid 0 (or negative) is stale: acquire takes it over and release() clears it", () => {
    for (const content of ["0", "-1", "-999999"]) {
      const lock = new BodyLock("Maya", lockDir());
      writeFileSync(lock.filePath, content, "utf8");
      expect(() => lock.acquire(), content).not.toThrow();
      expect(readFileSync(lock.filePath, "utf8")).toBe(String(process.pid));
      lock.release();
      writeFileSync(lock.filePath, content, "utf8");
      lock.release(); // a stale 0 lock must also be removable
      expect(existsSync(lock.filePath), content).toBe(false);
    }
  });

  posixIt("pidAlive: rejects non-positive and non-integer pids, still true for this process", () => {
    for (const pid of [0, -1, -1234, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) expect(pidAlive(pid), String(pid)).toBe(false);
    expect(pidAlive(process.pid)).toBe(true);
  });

  // FIXED (OPS-002): the pid was read with parseInt, so "<livepid>abc" / "<livepid>.5" parsed as that live pid. Only /^\d+$/ counts now.
  it("a lock file whose content merely STARTS with a live pid is corrupt, not a live duplicate (strict /^\\d+$/ parse)", () => {
    const pid = liveForeignPid();
    for (const content of [`${pid}abc`, `${pid}.5`, `0x${pid.toString(16)}`, `${pid} ${pid}`, `+${pid}`, `${pid}e0`]) {
      const lock = new BodyLock("Maya", lockDir());
      writeFileSync(lock.filePath, content, "utf8");
      expect(() => lock.acquire(), content).not.toThrow();
      expect(readFileSync(lock.filePath, "utf8")).toBe(String(process.pid));
      lock.release();
    }
    // surrounding whitespace / trailing newline is still a valid pid file
    const lock = new BodyLock("Kai", lockDir());
    writeFileSync(lock.filePath, `${pid}\n`, "utf8");
    expect(() => lock.acquire()).toThrow(DuplicateBodyError);
  });

  // FIXED (OPS-002): acquire used exists() + write, so two starters could both pass the check and both "win". The create is now
  // atomic ("wx"); a live foreign holder is never overwritten and a stale lock is replaced through the same atomic create.
  it("acquire never overwrites a live holder's lock file (atomic create)", () => {
    const pid = liveForeignPid();
    const lock = new BodyLock("Atlas", lockDir());
    writeFileSync(lock.filePath, String(pid), "utf8");
    expect(() => lock.acquire()).toThrow(DuplicateBodyError);
    expect(readFileSync(lock.filePath, "utf8")).toBe(String(pid));
  });

  it("locks are per citizen and case-insensitive on the username", () => {
    const dir = lockDir();
    const a = new BodyLock("Atlas", dir);
    const b = new BodyLock("ATLAS", dir);
    const c = new BodyLock("Maya", dir);
    expect(a.filePath).toBe(b.filePath);
    expect(a.filePath).not.toBe(c.filePath);
  });

  // FIXED (OPS-002): the lock path used resolve(lockDir, `${username.toLowerCase()}.lock`) with no sanitising, so "../x" escaped
  // lockDir (and an absolute-looking name could rewrite an arbitrary *.lock file that release() may later unlink). The username
  // is now reduced to [a-z0-9_-] and the resolved path must sit directly inside the lock directory.
  it.each(["../../escape", "..\\..\\escape", "/etc/passwd", "a/b", "C:\\x", "..", "...", "", "Atlas\u0000x"])("username %j cannot place the lock file outside the lock directory", (name) => {
    const dir = lockDir();
    const lock = new BodyLock(name, dir);
    expect(dirname(lock.filePath)).toBe(resolve(dir));
    expect(basename(lock.filePath)).toMatch(/^[a-z0-9_-]*\.lock$/);
    lock.acquire();
    expect(existsSync(lock.filePath)).toBe(true);
    lock.release();
  });

  it("real Minecraft-style usernames are unchanged by sanitising (only lower-cased, as before)", () => {
    const dir = lockDir();
    expect(new BodyLock("Atlas_01", dir).filePath).toBe(resolve(dir, "atlas_01.lock"));
  });
});
