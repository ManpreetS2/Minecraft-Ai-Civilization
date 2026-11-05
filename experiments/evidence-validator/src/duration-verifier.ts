import type { DurationTickAudit } from "./types.js";
import type { JournalRow } from "./schemas.js";
import {
  verifySourceAttestation,
  type SourceAttestation,
} from "./source-authenticator.js";

/**
 * Expected server game ticks for a 60-minute real Paper run.
 * 20 TPS × 3600 seconds = 72,000 ticks.
 */
const TICKS_PER_MINUTE_AT_20TPS = 20 * 60;
const MINIMUM_PAPER_TICKS_FOR_60MIN = 72_000 * 0.95; // Allow max 5% natural TPS drift (68,400 ticks minimum)

export function auditDurationAndTicks(args: {
  claimedDurationMinutes: number;
  journalRows: JournalRow[];
  sourceAttestation?: SourceAttestation;
  experimentId?: string;
  trustedAuthorities?: string[];
}): DurationTickAudit {
  const reasons: string[] = [];
  const gapsDetected: Array<{ fromSeq: number; toSeq: number; gapMs: number }> = [];

  let totalDurationMs = 0;
  let tickCount = 0;
  let tpsSum = 0;
  let tpsCount = 0;
  let lastTimestamp: number | undefined;
  let lastSeq: number | undefined;

  // serverGameTick tracking
  let serverTickCount = 0;
  let firstServerGameTick: number | undefined;
  let lastServerGameTick: number | undefined;
  let serverTickProven = false;
  let serverTickRegressed = false;
  let serverTickGapDetected = false;

  for (const row of args.journalRows) {
    const rowTime = new Date(row.at).getTime();
    if (isNaN(rowTime)) {
      reasons.push(`Invalid timestamp found in journal row seq ${row.seq}: '${row.at}'`);
      continue;
    }

    if (lastTimestamp !== undefined && lastSeq !== undefined) {
      const wallGap = rowTime - lastTimestamp;
      if (wallGap > 65_000) {
        gapsDetected.push({ fromSeq: lastSeq, toSeq: row.seq, gapMs: wallGap });
      }
    }
    lastTimestamp = rowTime;
    lastSeq = row.seq;

    if (row.kind === "tick") {
      totalDurationMs += row.durationMs;
      tickCount++;

      if (row.measuredTps !== undefined) {
        tpsSum += row.measuredTps;
        tpsCount++;
      }

      if ("serverGameTick" in row && row.serverGameTick !== undefined) {
        const tick = row.serverGameTick;
        if (firstServerGameTick === undefined) {
          firstServerGameTick = tick;
        }
        serverTickCount++;

        if (lastServerGameTick !== undefined) {
          if (tick <= lastServerGameTick) {
            serverTickRegressed = true;
          } else {
            const tickDelta = tick - lastServerGameTick;
            if (tickDelta > TICKS_PER_MINUTE_AT_20TPS * 5) {
              serverTickGapDetected = true;
            }
          }
        }
        lastServerGameTick = tick;
      }
    }
  }

  // Calculate wall duration from timestamps
  let wallDurationMs = 0;
  if (args.journalRows.length >= 2) {
    const firstTime = new Date(args.journalRows[0]!.at).getTime();
    const lastTime = new Date(args.journalRows[args.journalRows.length - 1]!.at).getTime();
    if (!isNaN(firstTime) && !isNaN(lastTime)) {
      wallDurationMs = Math.max(0, lastTime - firstTime);
    }
  }

  // Phase 1 (Mission 006): Evaluate source attestation
  const attestationAudit = verifySourceAttestation({
    attestation: args.sourceAttestation,
    expectedExperimentId: args.experimentId,
    trustedAuthorities: args.trustedAuthorities,
  });

  // Phase 2 (Mission 006): Rigorous duration logic
  // For live proof, do NOT allow reported tick duration sum to replace insufficient wall time!
  const isLiveClaim = args.sourceAttestation?.sourceType === "paper_server_attested";
  let provenDurationMs: number;
  if (isLiveClaim) {
    provenDurationMs = wallDurationMs;
  } else {
    provenDurationMs = Math.max(totalDurationMs, wallDurationMs);
  }
  const provenDurationMinutes = Number((provenDurationMs / 60_000).toFixed(2));
  const averageTickDurationMs =
    tickCount > 0 ? Number((totalDurationMs / tickCount).toFixed(2)) : 0;
  const averageTps = tpsCount > 0 ? Number((tpsSum / tpsCount).toFixed(2)) : undefined;
  const tpsEvidencePresent = tpsCount > 0;

  // Evaluate Server Ticks Progression & Authenticity
  if (serverTickCount > 0) {
    const elapsedServerTicks = (lastServerGameTick ?? 0) - (firstServerGameTick ?? 0);

    if (serverTickRegressed) {
      reasons.push(
        "Server game tick regression detected: serverGameTick values did not monotonically increase, indicating server restart, rollback, or fabricated evidence",
      );
    } else if (serverTickGapDetected) {
      reasons.push(
        "Server game tick gap detected: a jump > 5 minutes in serverGameTick values indicates the Paper server was paused or the evidence was spliced",
      );
    } else if (args.claimedDurationMinutes >= 60 && serverTickCount < 10) {
      reasons.push(
        `Insufficient server tick samples: only ${serverTickCount} serverGameTick observation(s) provided. Continuous server progression cannot be proven from isolated samples.`,
      );
    } else if (args.claimedDurationMinutes >= 60 && elapsedServerTicks < MINIMUM_PAPER_TICKS_FOR_60MIN) {
      reasons.push(
        `Insufficient Paper tick progression: elapsed server game ticks (${elapsedServerTicks}) deficit for 60-minute requirement (expected ~72,000, minimum allowed: ${MINIMUM_PAPER_TICKS_FOR_60MIN})`,
      );
    } else if (!attestationAudit.proven) {
      // P0 FIX: Missing or unverified attestation MUST NOT allow serverTickProven = true!
      for (const r of attestationAudit.reasons) {
        reasons.push(r);
      }
    } else {
      serverTickProven = true;
    }
  } else if (isLiveClaim) {
    reasons.push("Missing server game tick evidence for live Paper demonstration claim");
  }

  // Strict 60-Minute Duration Check
  const targetMs = args.claimedDurationMinutes * 60_000;
  let durationComplete = false;

  if (args.claimedDurationMinutes >= 60) {
    if (isLiveClaim && wallDurationMs < targetMs) {
      reasons.push(
        `Live wall duration deficit: claimed ${args.claimedDurationMinutes} minutes, but elapsed wall time is only ${(wallDurationMs / 60_000).toFixed(2)} minutes (${wallDurationMs} ms vs required ${targetMs} ms). A live Paper demonstration cannot substitute simulated tick duration for elapsed wall time.`,
      );
    } else if (provenDurationMs < targetMs) {
      reasons.push(
        `Simulation duration deficit: claimed ${args.claimedDurationMinutes} minutes, but evidence only proves ${provenDurationMinutes} minutes (${provenDurationMs} ms vs required ${targetMs} ms). A 58.8-minute run cannot be accepted as a completed 60-minute demonstration.`,
      );
    } else {
      durationComplete = true;
    }
  } else if (args.claimedDurationMinutes > 0) {
    if (provenDurationMs < targetMs) {
      reasons.push(
        `Simulation duration deficit: claimed ${args.claimedDurationMinutes} minutes, but evidence only proves ${provenDurationMinutes} minutes (${provenDurationMs} ms vs expected ${targetMs} ms)`,
      );
    } else {
      durationComplete = true;
    }
  }

  if (tickCount === 0) {
    reasons.push("Missing tick evidence: no tick events recorded in evidence log");
  }

  if (!tpsEvidencePresent) {
    reasons.push("Absent TPS metrics: no server performance / TPS observations documented");
  }

  if (gapsDetected.length > 0) {
    reasons.push(
      `Detected ${gapsDetected.length} unrecorded time gap(s) exceeding 60s in event timeline`,
    );
  }

  return {
    claimedDurationMinutes: args.claimedDurationMinutes,
    provenDurationMs,
    provenDurationMinutes,
    tickCount,
    averageTickDurationMs,
    averageTps,
    tpsEvidencePresent,
    serverTickProven,
    serverTickCount,
    durationComplete: durationComplete && reasons.filter((r) => !r.includes("appears simulated")).length === 0,
    gapsDetected,
    sourceAttestationAudit: attestationAudit,
    reasons,
  };
}
