import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";

export type DevResetRequest = {
  yes: boolean;
  world: boolean;
  dbPath: string;
  worldDir?: string;
};

export type DevResetResult = {
  ok: boolean;
  message: string;
  deleted: string[];
};

export function parseResetArgs(argv: string[]): Omit<DevResetRequest, "dbPath"> {
  return {
    yes: argv.includes("--yes") || argv.includes("--confirm"),
    world: argv.includes("--world"),
  };
}

export function resetDevelopmentState(request: DevResetRequest): DevResetResult {
  if (!request.yes) {
    return {
      ok: false,
      message:
        "Refusing to reset. Re-run with --yes to delete the development database. Add --world only if you also want to delete the Minecraft world.",
      deleted: [],
    };
  }

  const deleted: string[] = [];
  const dbPath = resolve(request.dbPath);
  for (const file of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    if (existsSync(file)) {
      rmSync(file, { force: true });
      deleted.push(file);
    }
  }

  if (request.world) {
    if (!request.worldDir) {
      return {
        ok: false,
        message: "World reset requested but no world directory was provided.",
        deleted,
      };
    }
    const worldDir = resolve(request.worldDir);
    if (existsSync(worldDir)) {
      rmSync(worldDir, { recursive: true, force: true });
      deleted.push(worldDir);
    }
  }

  return {
    ok: true,
    message: request.world
      ? `Deleted development database and Minecraft world (${deleted.length} paths).`
      : `Deleted development database only. Minecraft world was left untouched (${deleted.length} paths).`,
    deleted,
  };
}
