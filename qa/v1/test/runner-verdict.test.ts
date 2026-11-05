import { describe, expect, it } from "vitest";
import { evaluate, type RunFacts, type VitestJson } from "../src/verdict.js";

const t = (title: string, status = "passed") => ({ fullName: title, title, status });
const file = (name: string, ...tests: ReturnType<typeof t>[]) => ({ name, status: tests.some((x) => x.status === "failed") ? "failed" : "passed", assertionResults: tests });
const json = (...files: ReturnType<typeof file>[]): VitestJson => ({ numTotalTests: 0, numPassedTests: 0, numFailedTests: 0, testResults: files });
const good = (): RunFacts => ({
  vitest: json(file("C:/x/qa/v1/test/a.test.ts", t("[ADV-01] ok"), t("[ADV-02] ok"))),
  exitCode: 0, actualSha: "a".repeat(40), dirty: false, requiredFiles: ["qa/v1/test/a.test.ts"], requiredScenarios: ["ADV-01", "ADV-02"],
});

describe("QA runner verdict refuses to report PASS", () => {
  it("passes a clean, complete, single-SHA run", () => { expect(evaluate(good()).verdict).toBe("PASS"); });
  it("zero tests executed", () => {
    const v = evaluate({ ...good(), vitest: json(), requiredFiles: [], requiredScenarios: [] });
    expect(v.verdict).toBe("FAIL"); expect(v.reasons.join()).toMatch(/zero tests/);
  });
  it("a required test file is missing", () => {
    const v = evaluate({ ...good(), requiredFiles: ["qa/v1/test/missing.test.ts"] });
    expect(v.verdict).toBe("FAIL"); expect(v.reasons.join()).toMatch(/missing\.test\.ts produced no results/);
  });
  it("the tested SHA differs from the claimed SHA", () => {
    const v = evaluate({ ...good(), claimedSha: "b".repeat(40) });
    expect(v.verdict).toBe("FAIL"); expect(v.reasons.join()).toMatch(/differs from claimed SHA/);
  });
  it("a fixture silently fails setup (suite failed with no tests)", () => {
    const f = good(); f.vitest = json(...f.vitest!.testResults, { name: "C:/x/qa/v1/test/b.test.ts", status: "failed", assertionResults: [] });
    const v = evaluate(f); expect(v.verdict).toBe("FAIL"); expect(v.reasons.join()).toMatch(/failed to load or set up/);
  });
  it("the process exits nonzero even though every reported test passed", () => {
    const v = evaluate({ ...good(), exitCode: 1 }); expect(v.verdict).toBe("FAIL");
  });
  it("an expected failure (it.fails) is counted as a reproduced defect, never as a fix", () => {
    const f = good(); f.vitest = json(file("C:/x/qa/v1/test/a.test.ts", t("[ADV-01] ok"), t("[ADV-03][DEFECT] stale"))); f.requiredScenarios = ["ADV-01", "ADV-03"];
    const v = evaluate(f);
    expect(v.totals.defectsReproduced).toBe(1);
    expect(v.perScenario["ADV-03"]!.status).toBe("KNOWN_DEFECT_REPRODUCED");
    expect(v.verdict).toBe("FAIL"); expect(v.reasons.join()).toMatch(/not a fix/);
  });
  it("a skipped or BLOCKED scenario is not a pass", () => {
    const f = good(); f.vitest = json(file("C:/x/qa/v1/test/a.test.ts", t("[ADV-01] ok"), t("[ADV-02] needs interface", "skipped"))); 
    expect(evaluate(f).verdict).toBe("FAIL");
    f.vitest = json(file("C:/x/qa/v1/test/a.test.ts", t("[ADV-01] ok"), t("[ADV-02][BLOCKED] needs interface", "skipped")));
    const v = evaluate(f); expect(v.perScenario["ADV-02"]!.status).toBe("BLOCKED"); expect(v.verdict).toBe("FAIL");
  });
  it("a BLOCKED case that unexpectedly passes is flagged, not silently green", () => {
    const f = good(); f.vitest = json(file("C:/x/qa/v1/test/a.test.ts", t("[ADV-01] ok"), t("[ADV-02][BLOCKED] x")));
    expect(evaluate(f).reasons.join()).toMatch(/BLOCKED case passed/);
  });
  it("evidence from an unrelated branch or a dirty tree", () => {
    expect(evaluate({ ...good(), claimedBranch: "agents/cursor-v1", actualBranch: "agents/other" }).verdict).toBe("FAIL");
    expect(evaluate({ ...good(), dirty: true }).verdict).toBe("FAIL");
  });
  it("live proof is required but every scenario is simulated", () => {
    const v = evaluate({ ...good(), requireLive: true }); expect(v.verdict).toBe("FAIL"); expect(v.reasons.join()).toMatch(/OFFLINE_FIXTURE/);
  });
  it("a run that crashed before reporting", () => { expect(evaluate({ ...good(), vitest: undefined, exitCode: 1 }).verdict).toBe("FAIL"); });
});
