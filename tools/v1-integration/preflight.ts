import { existsSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { execFileSync } from "node:child_process";
import { buildManifest, type RunBundle } from "./manifest.js";
export interface PreflightInput { cwd: string; expectedRoot: string; expectedSha: string; documentedChanges: string | null; mode: string; body: string; provider: string; database: string; outputDirectory: string; fixturePaths: string[]; manifest: RunBundle; minecraftPort: number | null; host: string; binaries: string[] }
function canonical(path: string): string {
  if (existsSync(path)) return realpathSync(path);
  const parent = dirname(path);
  if (parent === path) throw new Error(`No existing ancestor: ${path}`);
  return resolve(canonical(parent), relative(parent, path));
}
export function contained(root: string, path: string): boolean {
  const rel = relative(canonical(resolve(root)), canonical(resolve(path)));
  return rel !== "" && !isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`);
}
export function checkPreflight(input: PreflightInput) {
  const failures: string[] = [];
  const git = (args: string[]) => execFileSync("git", args, { cwd: input.cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  let sourceSha: string | null = null;
  try {
    if (canonical(git(["rev-parse", "--show-toplevel"])) !== canonical(input.expectedRoot)) failures.push("Wrong repository/worktree");
    sourceSha = git(["rev-parse", "HEAD"]);
    if (!/^[a-f0-9]{40}$/.test(input.expectedSha) || sourceSha !== input.expectedSha) failures.push("Exact candidate SHA mismatch");
    if (git(["status", "--porcelain"]) && !input.documentedChanges?.trim()) failures.push("Dirty tree needs explicit change record");
  } catch { failures.push("Cannot inspect repository/worktree"); }
  if (input.mode !== "offline-fixture" || input.body !== "controlled-fixture" || input.provider !== "scripted-in-process") failures.push("Only controlled offline fixture startup approved");
  if (input.minecraftPort !== null) failures.push("Offline scenario must not select any Minecraft port");
  if (!["127.0.0.1", "::1"].includes(input.host)) failures.push("Non-loopback host forbidden");
  if (![":memory:", ":temporary-fixture:"].includes(input.database)) failures.push("Offline scaffold requires in-memory or internally allocated temporary SQLite; database paths forbidden");
  try {
    const evidenceRoot = resolve(input.expectedRoot, "artifacts/v1");
    if (!contained(input.expectedRoot, evidenceRoot) || !contained(evidenceRoot, input.outputDirectory)) failures.push("Evidence directory must be below artifacts/v1 within worktree");
  } catch { failures.push("Unsafe evidence path or symlink ancestor"); }
  for (const path of input.fixturePaths) if (!existsSync(path) || !contained(input.expectedRoot, path)) failures.push(`Missing or unsafe fixture: ${path}`);
  try { buildManifest(input.manifest); if (input.manifest.sourceSha !== sourceSha || input.manifest.mode !== "offline-fixture") failures.push("Manifest source/mode mismatch"); } catch (error) { failures.push(`Invalid manifest: ${String(error)}`); }
  const versions: Record<string, string> = {};
  for (const binary of input.binaries) {
    if (!["node", "git", "pnpm"].includes(binary)) { failures.push(`Unsupported binary check: ${binary}`); continue; }
    try { versions[binary] = execFileSync(binary, ["--version"], { encoding: "utf8", shell: process.platform === "win32" && binary === "pnpm" }).trim(); } catch { failures.push(`Required binary unavailable: ${binary}`); }
  }
  if (versions.node && Number(versions.node.replace(/^v/, "").split(".")[0]) < 22) failures.push("Node >=22 required");
  return { passed: failures.length === 0, sourceSha, versions, failures };
}
export function requirePreflight(input: PreflightInput): ReturnType<typeof checkPreflight> {
  const result = checkPreflight(input);
  if (!result.passed) throw new Error(`Preflight refused startup: ${result.failures.join("; ")}`);
  return result;
}

