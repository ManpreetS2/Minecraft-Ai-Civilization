import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export class DuplicateBodyError extends Error {
  override readonly name = "DuplicateBodyError";
    constructor(username: string, pid: number) {
    super(`Minecraft body for '${username}' already running (pid ${pid})`);
  }
}

export class BodyLock {
  readonly filePath: string;
  readonly username: string;

  constructor(username: string, lockDir = "./data/locks") {
    this.username = username;
    const dir = resolve(lockDir);
    this.filePath = resolve(dir, `${username.toLowerCase().replace(/[^a-z0-9_-]/g, "_")}.lock`);
    if (dirname(this.filePath) !== dir) {
      throw new Error(`Refusing lock path outside lock directory for '${username}'`);
    }
  }

  acquire(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        // "wx": atomic create-or-fail, so two starters cannot both pass an exists() check and both win.
        writeFileSync(this.filePath, String(process.pid), { encoding: "utf8", flag: "wx" });
        return;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
      const holder = this.readPid();
      if (holder === process.pid) return;
      if (holder !== undefined && pidAlive(holder)) throw new DuplicateBodyError(this.username, holder);
      try {
        unlinkSync(this.filePath); // stale / corrupt lock: remove and retry the atomic create
      } catch {
        // someone else already removed it
      }
    }
    throw new Error(`Could not acquire body lock for '${this.username}'`);
  }

  release(): void {
    if (!existsSync(this.filePath)) return;
    try {
      const pid = this.readPid();
      if (pid === undefined || pid === process.pid || !pidAlive(pid)) {
        unlinkSync(this.filePath);
      }
    } catch {
      // lock file already gone
    }
  }

  /** The pid in the lock file, or undefined when the file is missing or its content is not a strict positive integer. */
  private readPid(): number | undefined {
    try {
      const raw = readFileSync(this.filePath, "utf8").trim();
      if (!/^\d+$/.test(raw)) return undefined;
      const pid = Number(raw);
      return Number.isSafeInteger(pid) && pid > 0 ? pid : undefined;
    } catch {
      return undefined;
    }
  }
}

export function pidAlive(pid: number): boolean {
  // pid 0 / negative would signal a process group (kill(0, 0) always succeeds): never a live body.
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
