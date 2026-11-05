import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * run-on-candidate.sh must never delete or overwrite another agent's checkout. Every refusal below happens before any
 * install or test run, against a throwaway git repo, and checks that sentinel files survive.
 */
const script = fileURLToPath(new URL("../scripts/run-on-candidate.sh", import.meta.url)).replaceAll("\\", "/");
const sh = (cwd: string, ...a: string[]) => spawnSync("git", a, { cwd, encoding: "utf8" });
const bash = (...a: string[]) => spawnSync("bash", [script, ...a], { encoding: "utf8" });

function candidateRepo() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "qa-wrap-")));
  const repo = join(root, "cand");
  mkdirSync(repo);
  sh(repo, "init", "-q");
  sh(repo, "config", "user.email", "qa@example.invalid");
  sh(repo, "config", "user.name", "qa");
  writeFileSync(join(repo, "a.txt"), "one");
  sh(repo, "add", "-A");
  sh(repo, "commit", "-q", "-m", "c1");
  const sha = sh(repo, "rev-parse", "HEAD").stdout.trim();
  return { root, repo, sha };
}
const refused = (r: ReturnType<typeof bash>, re: RegExp) => {
  expect(r.status).toBe(2);
  expect(r.stderr).toMatch(re);
};

describe("run-on-candidate.sh safety", () => {
  it("refuses a destination that already exists and leaves its contents untouched", () => {
    const { root, repo, sha } = candidateRepo();
    const dest = join(root, "existing");
    mkdirSync(join(dest, "qa/v1"), { recursive: true });
    writeFileSync(join(dest, "qa/v1/KEEP.txt"), "precious");
    refused(bash(repo, sha, dest), /already exists/);
    expect(readFileSync(join(dest, "qa/v1/KEEP.txt"), "utf8")).toBe("precious");
  });

  it("refuses an existing destination that is a file or a dangling name too", () => {
    const { root, repo, sha } = candidateRepo();
    const f = join(root, "afile");
    writeFileSync(f, "x");
    refused(bash(repo, sha, f), /already exists/);
    expect(readFileSync(f, "utf8")).toBe("x");
  });

  it("refuses a short, malformed or unknown SHA", () => {
    const { root, repo, sha } = candidateRepo();
    refused(bash(repo, sha.slice(0, 12), join(root, "w1")), /full 40-character/);
    refused(bash(repo, "HEAD", join(root, "w2")), /full 40-character/);
    refused(bash(repo, "0".repeat(40), join(root, "w3")), /not in/);
    expect(existsSync(join(root, "w1")) || existsSync(join(root, "w3"))).toBe(false);
  });

  it("refuses a candidate repo with tracked working-tree changes and does not modify them", () => {
    const { root, repo, sha } = candidateRepo();
    writeFileSync(join(repo, "a.txt"), "edited by another agent");
    refused(bash(repo, sha, join(root, "w")), /tracked changes/);
    expect(readFileSync(join(repo, "a.txt"), "utf8")).toBe("edited by another agent");
    expect(existsSync(join(root, "w"))).toBe(false);
  });

  it("refuses a destination inside the candidate repo and one whose parent is missing", () => {
    const { root, repo, sha } = candidateRepo();
    refused(bash(repo, sha, join(repo, "inside")), /outside the candidate repo/);
    refused(bash(repo, sha, join(root, "no-such-parent/w")), /parent .* does not exist/);
    expect(existsSync(join(repo, "inside"))).toBe(false);
  });

  it("refuses a destination reached through a symlink (skipped where symlinks cannot be created)", () => {
    const { root, repo, sha } = candidateRepo();
    const real = join(root, "real");
    mkdirSync(real);
    const link = join(root, "link");
    try {
      symlinkSync(real, link, "dir");
    } catch {
      return;
    }
    refused(bash(repo, sha, join(link, "w")), /symlink/);
    expect(existsSync(join(real, "w"))).toBe(false);
  });

  it("refuses fewer than three arguments", () => {
    refused(bash("only-one"), /usage/);
  });

  it("the script contains no destructive commands", () => {
    const text = readFileSync(script, "utf8").split(String.fromCharCode(10)).filter((l) => !l.trimStart().startsWith("#")).join(String.fromCharCode(10));
    expect(text).not.toMatch(/\brm\b|\bmv\b|git clean|git reset|git stash|--force|checkout --/);
  });
});
