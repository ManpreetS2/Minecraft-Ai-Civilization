import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

export function workspaceRoot(start = process.cwd()): string {
  let dir = start;
  while (true) {
    if (existsSync(resolve(dir, "pnpm-workspace.yaml"))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) return start;
    dir = parent;
  }
}

export function resolveFromRoot(path: string): string {
  if (path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path)) {
    return path;
  }
  return resolve(workspaceRoot(), path);
}
