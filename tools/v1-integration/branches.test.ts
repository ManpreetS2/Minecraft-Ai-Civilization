import { describe, expect, it } from "vitest";
import { inspectBranches, type GitRead } from "./branches.js";
describe("read-only branch contracts", () => {
  const git: GitRead = (args) => {
    if (args[0] === "rev-parse" || args[0] === "merge-base") return "a".repeat(40);
    if (args[0] === "rev-list") return "0\t2";
    if (args[0] === "show") return "b".repeat(40);
    if (args[0] === "diff") return "packages/agent-core/src/store.ts\ntools/check.ts";
    throw new Error("unexpected mutation or command");
  };
  it("reports overlap without asserting compatibility or permission", () => {
    const report = inspectBranches([{ id: "12", ref: "one", base: "main", dependencies: [], owner: "CODEX1" }, { id: "13", ref: "two", base: "one", dependencies: ["12"], owner: "CODEX1" }], git, []);
    expect(report.candidateDependencyOrder).toEqual(["12", "13"]);
    expect(report.conflicts).toHaveLength(1);
    expect(report.unknownPaths).toContain("packages/agent-core/src/store.ts");
    expect(report.compatibility).toBe("NOT PROVEN");
    expect(report.automaticMergeAllowed).toBe(false);
  });
  it("fails closed on unavailable references and missing dependencies", () => {
    const report = inspectBranches([{ id: "14", ref: "absent", base: "main", dependencies: ["13"], owner: null }], () => { throw new Error("missing ref"); }, []);
    expect(report.branches[0]?.head).toBeNull();
    expect(report.blockers.length).toBeGreaterThan(1);
    expect(report.candidateDependencyOrder).toEqual([]);
  });
});
