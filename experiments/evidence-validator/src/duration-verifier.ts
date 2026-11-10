import type { DurationTickAudit } from "./types.js";
import type { JournalRow } from "./schemas.js";
import type { KeyObject } from "node:crypto";
import { verifySourceAttestation, type SourceAttestation } from "./source-authenticator.js";

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
  trustedKeys?: Record<string, string | KeyObject> | Map<string, string | KeyObject>;
  expectedSourceSha?: string;
  rawJournalLines?: readonly string[];
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

  interface AuditedRow {
    seq: number;
    at: string;
    kind: string;
    durationMs?: number;
    measuredTps?: number | null;
    serverGameTick?: number | null;
    completedDuration?: boolean;
  }

  const rowsToAudit: AuditedRow[] = [];
  if (args.rawJournalLines && args.rawJournalLines.length > 0) {
    for (const line of args.rawJournalLines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        rowsToAudit.push(JSON.parse(trimmed) as AuditedRow);
      } catch {
        // syntax error handled elsewhere
      }
    }
  } else {
    rowsToAudit.push(...(args.journalRows as AuditedRow[]));
  }

  for (const row of rowsToAudit) {
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
      if (typeof row.durationMs === "number") {
        totalDurationMs += row.durationMs;
      }
      tickCount++;

      if (typeof row.measuredTps === "number") {
        tpsSum += row.measuredTps;
        tpsCount++;
      }

      if (typeof row.serverGameTick === "number") {
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
  if (rowsToAudit.length >= 2) {
    const firstTime = new Date(rowsToAudit[0]!.at).getTime();
    const lastTime = new Date(rowsToAudit[rowsToAudit.length - 1]!.at).getTime();
    if (!isNaN(firstTime) && !isNaN(lastTime)) {
      wallDurationMs = Math.max(0, lastTime - firstTime);
    }
  }

  // Phase 1 (Mission 006) & Phase A (Mission 007): Evaluate source attestation with cryptographic verification
  const attestationAudit = verifySourceAttestation({
    attestation: args.sourceAttestation,
    expectedExperimentId: args.experimentId,
    trustedAuthorities: args.trustedAuthorities,
    trustedKeys: args.trustedKeys,
    expectedSourceSha: args.expectedSourceSha,
    rawJournalLines: args.rawJournalLines,
    firstServerTick: firstServerGameTick,
    lastServerTick: lastServerGameTick,
    totalServerTicks:
      serverTickCount > 0 && lastServerGameTick !== undefined && firstServerGameTick !== undefined
        ? lastServerGameTick - firstServerGameTick
        : undefined,
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

  // Shutdown evidence check (Phase C, Mission 007)
  const shutdownRow = rowsToAudit.find((r) => r.kind === "shutdown");
  const hasShutdownEvidence = Boolean(shutdownRow) || Boolean(args.sourceAttestation?.endedAt);

  // Evaluate Server Ticks Progression & Authenticity
  if (serverTickCount > 0) {
    const elapsedServerTicks = (lastServerGameTick ?? 0) - (firstServerGameTick ?? 0);

    const minTicks =
      args.claimedDurationMinutes > 0
        ? args.claimedDurationMinutes * TICKS_PER_MINUTE_AT_20TPS * 0.95
        : MINIMUM_PAPER_TICKS_FOR_60MIN;
    const minSamples =
      args.claimedDurationMinutes >= 60
        ? 10
        : Math.min(10, Math.max(2, Math.floor(args.claimedDurationMinutes / 6)));

    if (serverTickRegressed) {
      reasons.push(
        "Server game tick regression detected: serverGameTick values did not monotonically increase, indicating server restart, rollback, or fabricated evidence",
      );
    } else if (serverTickGapDetected) {
      reasons.push(
        "Server game tick gap detected: a jump > 5 minutes in serverGameTick values indicates the Paper server was paused or the evidence was spliced",
      );
    } else if (args.claimedDurationMinutes > 0 && serverTickCount < minSamples) {
      reasons.push(
        `Insufficient server tick samples: only ${serverTickCount} serverGameTick observation(s) provided. Continuous server progression cannot be proven from isolated samples.`,
      );
    } else if (args.claimedDurationMinutes > 0 && elapsedServerTicks < minTicks) {
      reasons.push(
        `Insufficient Paper tick progression: elapsed server game ticks (${elapsedServerTicks}) deficit for ${args.claimedDurationMinutes}-minute requirement (expected ~${args.claimedDurationMinutes * TICKS_PER_MINUTE_AT_20TPS}, minimum allowed: ${minTicks})`,
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

  // Strict Duration Check
  const targetMs = args.claimedDurationMinutes * 60_000;
  let durationComplete = false;

  if (args.claimedDurationMinutes > 0) {
    if (isLiveClaim && wallDurationMs < targetMs) {
      reasons.push(
        `Live wall duration deficit: claimed ${args.claimedDurationMinutes} minutes, but elapsed wall time is only ${(wallDurationMs / 60_000).toFixed(2)} minutes (${wallDurationMs} ms vs required ${targetMs} ms). A live Paper demonstration cannot substitute simulated tick duration for elapsed wall time.`,
      );
    } else if (provenDurationMs < targetMs) {
      const extra =
        args.claimedDurationMinutes >= 60
          ? " A 58.8-minute run cannot be accepted as a completed 60-minute demonstration."
          : "";
      reasons.push(
        `Simulation duration deficit: claimed ${args.claimedDurationMinutes} minutes, but evidence only proves ${provenDurationMinutes} minutes (${provenDurationMs} ms vs required ${targetMs} ms).${extra}`,
      );
    } else {
      durationComplete = true;
    }

    if (isLiveClaim) {
      if (!hasShutdownEvidence) {
        durationComplete = false;
        reasons.push(
          "Missing reliable shutdown evidence: live Paper demonstration requires graceful shutdown record or attested endedAt timestamp.",
        );
      } else if (shutdownRow && !shutdownRow.completedDuration) {
        durationComplete = false;
        reasons.push(
          "Incomplete shutdown: server shutdown event indicates experiment was prematurely aborted.",
        );
      }

      if (gapsDetected.length > 0) {
        durationComplete = false;
        reasons.push(
          `Capture session interrupted: detected ${gapsDetected.length} unrecorded time gap(s) exceeding 60s in live event timeline.`,
        );
      }

      if (!tpsEvidencePresent) {
        durationComplete = false;
        reasons.push(
          "Absent TPS metrics: live Paper demonstration requires explicit server performance / TPS observations.",
        );
      }
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
    durationComplete:
      durationComplete && reasons.filter((r) => !r.includes("appears simulated")).length === 0,
    gapsDetected,
    sourceAttestationAudit: attestationAudit,
    reasons,
  };
}
