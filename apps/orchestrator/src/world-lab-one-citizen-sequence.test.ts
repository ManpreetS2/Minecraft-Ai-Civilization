import { describe, expect, it } from "vitest";
import {
  applySequenceNote,
  ATLAS_POND_LAST_POS,
  daySequenceComplete,
  emptyDaySequence,
  evaluateLiveConnectPreflight,
  evaluatePositioningGate,
  firstClaimedBedSleepEndsRun,
  parseWorldLabOneCitizenArgs,
  reportOneCitizenDay,
  seedDaySequenceFromExistingHome,
} from "./world-lab-one-citizen-sequence.js";
import { WORLD_LAB_ONE_CITIZEN_ENV } from "./world-lab-one-citizen-guard.js";

describe("world-lab spawn vs teleport", () => {
  it("lets the planner start from the fishing pond and does not treat teleport as approved", () => {
    const gate = evaluatePositioningGate(ATLAS_POND_LAST_POS);
    expect(gate.allowed).toBe(true);
    expect(gate.atPond).toBe(true);
    expect(gate.inClaimReach).toBe(false);
    expect(gate.teleportApproved).toBe(false);
    expect(gate.citizenWalkExpected).toBe(true);
    expect(gate.request).toMatch(/NOT approved/i);

    const preflight = evaluateLiveConnectPreflight({
      env: WORLD_LAB_ONE_CITIZEN_ENV,
      spawn: ATLAS_POND_LAST_POS,
    });
    expect(preflight.allowed).toBe(true);
    expect(preflight.wouldConnectCitizen).toBe(true);
    expect(preflight.wouldStartPlanner).toBe(true);
  });

  it("refuses the live-civ port even from a pond spawn", () => {
    const preflight = evaluateLiveConnectPreflight({
      env: { ...WORLD_LAB_ONE_CITIZEN_ENV, MINECRAFT_PORT: "25565" },
      spawn: ATLAS_POND_LAST_POS,
    });
    expect(preflight.allowed).toBe(false);
    expect(preflight.wouldConnectCitizen).toBe(false);
    expect(preflight.wouldStartPlanner).toBe(false);
    if (!preflight.allowed) expect(preflight.error).toMatch(/25565/);
  });

  it("defaults to dry-run without --live", () => {
    expect(parseWorldLabOneCitizenArgs([]).dryRun).toBe(true);
    expect(parseWorldLabOneCitizenArgs([]).live).toBe(false);
    expect(parseWorldLabOneCitizenArgs(["--live"]).live).toBe(true);
    expect(parseWorldLabOneCitizenArgs(["--live", "--dry-run"]).live).toBe(false);
  });
});

describe("pre-claimed home curfew observability", () => {
  it("seeds claimedHomeId from existing membership and marks curfew when sleep_at_home starts", () => {
    let state = seedDaySequenceFromExistingHome(emptyDaySequence(), "home_h9");
    expect(state.claimedHomeId).toBe("home_h9");
    state = applySequenceNote(state, {
      channel: "PLANNER_CHOICE",
      task: "sleep_at_home",
      action: "sleep",
      type: "TaskStarted",
    });
    expect(state.curfew).toBe(true);
  });
});

describe("first claimed-bed sleep vs bounded stop", () => {
  it("does not end the full-day observation on the first claimed-bed sleep", () => {
    let state = emptyDaySequence();
    state = applySequenceNote(state, {
      channel: "HOME_CLAIM",
      action: "claimHome",
      task: "claim_home",
      success: true,
      homeId: "home_h5",
      item: "home_h5",
    });
    state = applySequenceNote(state, {
      channel: "SLEEP_RESULT",
      action: "sleep",
      task: "sleep_at_home",
      success: true,
    });
    expect(state.claimedHomeId).toBe("home_h5");
    expect(state.firstNightSleep).toBe(true);
    expect(state.legalSleepAfterDay).toBe(false);
    expect(firstClaimedBedSleepEndsRun(state)).toBe(false);
    expect(daySequenceComplete(state)).toBe(false);
    const report = reportOneCitizenDay(state, "time_limit");
    expect(report.verdict).toBe("PARTIAL");
    expect(report.firstSleepEndedRun).toBe(false);
    expect(report.missing).toContain("following_daytime_activity");
    expect(report.summary).toMatch(/PARTIAL/);
  });
});
