import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
export function child(script: string, mode: string, timeout = 60_000) {
  const p = spawnSync("pnpm", ["exec", "tsx", fileURLToPath(new URL(`../scripts/${script}`, import.meta.url)), mode], { encoding: "utf8", cwd: process.cwd(), timeout });
  const line = p.stdout.split("\n").filter((l) => l.startsWith("{")).pop();
  return { code: p.status, out: p.stdout, err: p.stderr, json: line ? (JSON.parse(line) as Record<string, unknown>) : undefined };
}
