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
    this.filePath = resolve(lockDir, `${username.toLowerCase()}.lock`);
  }

  acquire(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    if (existsSync(this.filePath)) {
      const raw = readFileSync(this.filePath, "utf8").trim();
      const pid = Number.parseInt(raw, 10);
      if (Number.isFinite(pid) && pidAlive(pid) && pid !== process.pid) {
        throw new DuplicateBodyError(this.username, pid);
      }
    }
    writeFileSync(this.filePath, String(process.pid), "utf8");
  }

  release(): void {
    if (!existsSync(this.filePath)) return;
    try {
      const pid = Number.parseInt(readFileSync(this.filePath, "utf8").trim(), 10);
      if (pid === process.pid || !pidAlive(pid)) {
        unlinkSync(this.filePath);
      }
    } catch {
      // lock file already gone
    }
  }
}

export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
