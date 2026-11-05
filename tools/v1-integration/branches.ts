import { execFileSync } from "node:child_process";

export interface BranchInput { id: string; ref: string; base: string; dependencies: string[]; owner: string | null }
export interface Ownership { pathPrefix: string; owner: string; sourceBranch: string; sourceSha: string; restriction: "no-modification" | "tooling-only"; pendingIndependentQa: boolean; handoff: string | null }
export type GitRead = (args: string[]) => string;
export function gitReader(cwd: string): GitRead {
  return (args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}
const sha = /^[a-f0-9]{40}$/;
/** Read-only Git plumbing. Missing refs remain blockers; never fetches or mutates branches. */
export function inspectBranches(inputs: BranchInput[], git: GitRead, ownership: Ownership[]) {
  const branches = inputs.map((input) => {
    try {
      const head = git(["rev-parse", "--verify", `${input.ref}^{commit}`]);
      const base = git(["rev-parse", "--verify", `${input.base}^{commit}`]);
      if (!sha.test(head) || !sha.test(base)) throw new Error("invalid resolved SHA");
      const mergeBase = git(["merge-base", base, head]);
      const counts = git(["rev-list", "--left-right", "--count", `${base}...${head}`]).split(/\s+/).map(Number);
      const paths = git(["diff", "--name-only", base, head]).split(/\r?\n/).filter(Boolean);
      const parents = git(["show", "-s", "--format=%P", head]).split(" ").filter(Boolean);
      return { ...input, head, base, mergeBase, parents, behind: counts[0], ahead: counts[1], paths, blocker: null as string | null };
    } catch (error) {
      return { ...input, head: null, mergeBase: null, parents: [], behind: null, ahead: null, paths: [] as string[], blocker: `Cannot inspect ${input.id}: ${error instanceof Error ? error.message : String(error)}` };
    }
  });
  const conflicts: { branches: string[]; paths: string[]; kind: string; requiredChecks: string[] }[] = [];
  for (let i = 0; i < branches.length; i++) for (let j = i + 1; j < branches.length; j++) {
    const a = branches[i]!, b = branches[j]!;
    const paths = a.paths.filter((p) => b.paths.includes(p));
    if (paths.length) conflicts.push({ branches: [a.id, b.id], paths, kind: "shared-path-semantic-review-required", requiredChecks: ["typecheck", "security", "provider-routing", "physical-action-accounting"] });
  }
  const unknownPaths = [...new Set(branches.flatMap((b) => b.paths))].filter((p) => !ownership.some((o) => p.startsWith(o.pathPrefix)));
  const blockers = branches.flatMap((b) => [ ...(b.blocker ? [b.blocker] : []), ...b.dependencies.filter((d) => !branches.some((candidate) => candidate.id === d && !candidate.blocker)).map((d) => `${b.id}: missing dependency ${d}`)]);
  const order: string[] = [], remaining = new Set(branches.map((b) => b.id));
  while (remaining.size) {
    const ready = branches.filter((b) => remaining.has(b.id) && b.dependencies.every((d) => order.includes(d)));
    if (!ready.length) { blockers.push(`Unresolved dependency cycle or missing refs: ${[...remaining].join(", ")}`); break; }
    for (const b of ready) { order.push(b.id); remaining.delete(b.id); }
  }
  return { schemaVersion: 1, branches, conflicts, candidateDependencyOrder: order, ownership, unknownPaths, blockers,
    automaticMergeAllowed: false, compatibility: "NOT PROVEN", directTextConflicts: "NOT CHECKED: overlap is not a merge result", unknownOwnershipPolicy: "no-modification" };
}
