import { describe, expect, it } from "vitest";
import { auditDurationAndTicks } from "../src/duration-verifier.js";
import type { JournalRow } from "../src/schemas.js";

describe("Duration and Tick Verifier", () => {
  it("verifies duration when ticks and wall-clock time meet claimed 60 minutes", () => {
    const rows: JournalRow[] = [];
    const baseTime = Date.now();

    // 60 tick rows of 60,000ms each = 3,600,000ms = 60 minutes
    for (let i = 0; i < 60; i++) {
      rows.push({
        kind: "tick",
        experimentId: "exp-1",
        seq: i + 1,
        at: new Date(baseTime + i * 60_000).toISOString(),
        previousHash: "",
        hash: "",
        durationMs: 60_000,
        measuredTps: 20.0,
      });
    }

    const audit = auditDurationAndTicks({
      claimedDurationMinutes: 60,
      journalRows: rows,
    });

    expect(audit.durationComplete).toBe(true);
    expect(audit.provenDurationMinutes).toBe(60);
    expect(audit.tpsEvidencePresent).toBe(true);
    expect(audit.averageTps).toBe(20.0);
    expect(audit.reasons.length).toBe(0);
  });

  it("detects duration deficit when claimed 60 minutes but only 10 minutes proven", () => {
    const rows: JournalRow[] = [];
    const baseTime = Date.now();

    // Only 10 ticks of 60,000ms = 10 minutes
    for (let i = 0; i < 10; i++) {
      rows.push({
        kind: "tick",
        experimentId: "exp-2",
        seq: i + 1,
        at: new Date(baseTime + i * 60_000).toISOString(),
        previousHash: "",
        hash: "",
        durationMs: 60_000,
        measuredTps: 19.5,
      });
    }

    const audit = auditDurationAndTicks({
      claimedDurationMinutes: 60,
      journalRows: rows,
    });

    expect(audit.durationComplete).toBe(false);
    expect(audit.provenDurationMinutes).toBe(10);
    expect(audit.reasons.join(" ")).toContain("Simulation duration deficit");
  });

  it("detects missing tick evidence and absent TPS metrics", () => {
    const rows: JournalRow[] = [
      {
        kind: "start",
        experimentId: "exp-3",
        seq: 1,
        at: "2026-11-01T12:00:00.000Z",
        previousHash: "",
        hash: "",
        recordingAudience: "operator_only",
        mode: "offline",
      },
      {
        kind: "shutdown",
        experimentId: "exp-3",
        seq: 2,
        at: "2026-11-01T13:00:00.000Z",
        previousHash: "",
        hash: "",
        completedDuration: true,
        mode: "offline",
      },
    ];

    const audit = auditDurationAndTicks({
      claimedDurationMinutes: 60,
      journalRows: rows,
    });

    expect(audit.durationComplete).toBe(false);
    expect(audit.tpsEvidencePresent).toBe(false);
    expect(audit.reasons.join(" ")).toContain("Missing tick evidence");
    expect(audit.reasons.join(" ")).toContain("Absent TPS metrics");
  });
});
