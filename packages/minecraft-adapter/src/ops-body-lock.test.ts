import { afterEach, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { BodyLock, DuplicateBodyError, pidAlive } from "./body-lock.js";

/**
 * OPS-001 (restart / crash recovery of the single-body lock). Real child processes only (no network, no Minecraft).
 */
const children: ChildProcess[] = [];
afterEach(() => {
  for (const child of children.splice(0)) child.kill("SIGKILL");
});

const lockDir = () => mkdtempSync(join(tmpdir(), "ops-lock-"));

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

  // CONFIRMED (OPS-001): body-lock.ts:24-25 accepts any finite pid, and pidAlive (:45-52) calls process.kill(pid, 0).
  // kill(0, 0) targets the caller's own process group and succeeds, so a lock file containing "0" (truncated write,
  // manual edit) reads as a live foreign body and blocks that citizen's startup until someone deletes the file by hand.
  it.fails("KNOWN BUG: a lock file containing pid 0 must be treated as corrupt, not as a live duplicate body", () => {
    const lock = new BodyLock("Maya", lockDir());
    writeFileSync(lock.filePath, "0", "utf8");
    expect(() => lock.acquire()).not.toThrow();
  });

  it("locks are per citizen and case-insensitive on the username", () => {
    const dir = lockDir();
    const a = new BodyLock("Atlas", dir);
    const b = new BodyLock("ATLAS", dir);
    const c = new BodyLock("Maya", dir);
    expect(a.filePath).toBe(b.filePath);
    expect(a.filePath).not.toBe(c.filePath);
  });

  // CONFIRMED (OPS-001): body-lock.ts:17 builds the path with resolve(lockDir, `${username.toLowerCase()}.lock`) and
  // never sanitises the username, so "../x" escapes lockDir (and an absolute-looking name rewrites an arbitrary *.lock file,
  // including one that release() may later unlink). Usernames are operator-configured today, so severity is low.
  it.fails("KNOWN BUG: a username with path separators must not place the lock file outside the lock directory", () => {
    const dir = lockDir();
    const lock = new BodyLock("../../escape", dir);
    const rel = relative(resolve(dir), dirname(lock.filePath));
    expect(rel.startsWith("..")).toBe(false);
  });
});
