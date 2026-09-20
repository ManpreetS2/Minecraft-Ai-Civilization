import { describe, expect, it } from "vitest";
import { evaluateTwoProbeTestLaunch } from "./two-probe-test-guard.js";

describe("two-probe launch guard", () => {
  it("stays blocked until every approval flag is set", () => {
    const idle = evaluateTwoProbeTestLaunch({});
    expect(idle.allowed).toBe(false);
    if (!idle.allowed) expect(idle.error).toMatch(/MECHANICS_TWO_PROBE_TEST_ENABLED/);
  });

  it("refuses 25565/25566 and overlapping single-probe harnesses", () => {
    const flags = {
      MECHANICS_TWO_PROBE_TEST_ENABLED: "true",
      TWO_PROBE_ALLOW_WORLD_MUTATION: "true",
      TWO_PROBE_RED_APPROVED: "true",
      TWO_PROBE_BLUE_APPROVED: "true",
      TWO_PROBE_USER_APPROVED: "true",
    };
    expect(evaluateTwoProbeTestLaunch({ ...flags, TWO_PROBE_PORT: "25565" }).allowed).toBe(false);
    expect(evaluateTwoProbeTestLaunch({ ...flags, MECHANICS_HOME_TEST_ENABLED: "true" }).allowed).toBe(false);
    expect(evaluateTwoProbeTestLaunch({ ...flags, TWO_PROBE_HOME_USERNAME: "MineProbe", TWO_PROBE_MINE_USERNAME: "MineProbe" }).allowed).toBe(
      false,
    );
  });

  it("allows world-lab 1.21.11 after independent HomeProbe and MineProbe approvals", () => {
    const lab = evaluateTwoProbeTestLaunch({
      MECHANICS_TWO_PROBE_TEST_ENABLED: "true",
      TWO_PROBE_ALLOW_WORLD_MUTATION: "true",
      TWO_PROBE_RED_APPROVED: "true",
      TWO_PROBE_BLUE_APPROVED: "true",
      TWO_PROBE_USER_APPROVED: "true",
    });
    expect(lab).toMatchObject({ allowed: true, port: 25567, version: "1.21.11", rconPort: 25577 });
  });
});
