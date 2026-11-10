import { createHash } from "node:crypto";
import type { ValidatedManifest, JournalRow } from "../src/schemas.js";

export function createTestManifest(overrides?: Partial<ValidatedManifest>): ValidatedManifest {
  return {
    experimentId: "exp-2v2-demo-001",
    sourceSha: "9945f02f38e14a7d63b3eed66279d191ad06ad3d",
    stage: "2v2",
    durationMinutes: 60,
    worldSeed: "civilization-seed-alpha",
    sites: [
      { communityId: "north_cove", x: 100, y: 64, z: 100, biome: "plains" },
      { communityId: "south_vale", x: 250, y: 64, z: 250, biome: "forest" },
    ],
    citizens: [
      {
        id: "gpt_atlas",
        communityId: "north_cove",
        personalitySeed: "seed_atlas",
        family: "gpt",
        model: "gpt-4o",
        sessionId: "session_atlas_001",
        inventoryVerified: true,
        inventory: [],
        shelterVerifiedAbsent: true,
      },
      {
        id: "gpt_maya",
        communityId: "north_cove",
        personalitySeed: "seed_maya",
        family: "gpt",
        model: "gpt-4o",
        sessionId: "session_maya_001",
        inventoryVerified: true,
        inventory: [],
        shelterVerifiedAbsent: true,
      },
      {
        id: "claude_theo",
        communityId: "south_vale",
        personalitySeed: "seed_theo",
        family: "claude",
        model: "claude-3-5-sonnet",
        sessionId: "session_theo_001",
        inventoryVerified: true,
        inventory: [],
        shelterVerifiedAbsent: true,
      },
      {
        id: "claude_ava",
        communityId: "south_vale",
        personalitySeed: "seed_ava",
        family: "claude",
        model: "claude-3-5-sonnet",
        sessionId: "session_ava_001",
        inventoryVerified: true,
        inventory: [],
        shelterVerifiedAbsent: true,
      },
    ],
    server: {
      version: "1.21.6",
      paperBuild: 48,
      difficulty: "normal",
      keepInventory: false,
      hardcore: false,
      doDaylightCycle: true,
      doMobSpawning: true,
      doMobLoot: true,
    },
    paths: {
      runRoot: "/isolated/run_001",
      world: "/isolated/run_001/world",
      database: "/isolated/run_001/database.sqlite",
      evidence: "/isolated/run_001/evidence.jsonl",
    },
    budget: {
      ceilingUsd: 10.0,
      accountingEnabled: true,
      unknownUsageFailClosed: true,
    },
    recording: {
      enabled: true,
      audience: "operator_only",
    },
    humanDirectives: [],
    privacyReplay: {
      sourceSha: "9945f02f38e14a7d63b3eed66279d191ad06ad3d",
      passed: 220,
      failed: 0,
      skipped: 0,
    },
    ...overrides,
  };
}

export class JournalBuilder {
  private seq = 0;
  private previousHash = "";
  private readonly lines: string[] = [];
  private readonly rows: JournalRow[] = [];
  private currentTimeMs: number;

  constructor(
    private readonly experimentId = "exp-2v2-demo-001",
    baseTime?: string | number,
  ) {
    this.currentTimeMs =
      baseTime !== undefined
        ? typeof baseTime === "number"
          ? baseTime
          : Date.parse(baseTime)
        : Date.parse("2026-11-05T12:00:00.000Z");
    this.append({
      kind: "start",
      recordingAudience: "operator_only",
      mode: "offline",
    });
  }

  append(payload: Record<string, unknown>): this {
    this.seq += 1;
    const duration = typeof payload.durationMs === "number" ? payload.durationMs : 0;
    this.currentTimeMs += duration;
    const rowObj = {
      experimentId: this.experimentId,
      seq: this.seq,
      at: payload.at ?? new Date(this.currentTimeMs).toISOString(),
      previousHash: this.previousHash,
      ...payload,
    };
    const hash = createHash("sha256").update(JSON.stringify(rowObj)).digest("hex");
    const fullRow = { ...rowObj, hash } as JournalRow;
    this.previousHash = hash;
    this.rows.push(fullRow);
    this.lines.push(JSON.stringify(fullRow));
    return this;
  }

  appendRaw(rawString: string): this {
    this.lines.push(rawString);
    return this;
  }

  build() {
    return {
      lines: [...this.lines],
      rows: [...this.rows],
    };
  }
}

export function createValid2v2Journal(): { lines: string[]; rows: JournalRow[] } {
  const b = new JournalBuilder("exp-2v2-demo-001");

  // Atlas gathers oak log
  const attemptId1 = "attempt-atlas-001";
  b.append({
    kind: "action_attempt",
    citizenId: "gpt_atlas",
    attemptId: attemptId1,
    action: "gather",
    decisionSource: "model",
    decisionEventId: "decision-atlas-001",
    expectedItem: "oak_log",
  });
  b.append({
    kind: "action_observation",
    citizenId: "gpt_atlas",
    attemptId: attemptId1,
    verified: true,
    successReported: true,
    beforeInventory: {},
    afterInventory: { oak_log: 1 },
    worldChanges: [],
  });

  // Maya gathers sweet berries
  const attemptId2 = "attempt-maya-001";
  b.append({
    kind: "action_attempt",
    citizenId: "gpt_maya",
    attemptId: attemptId2,
    action: "gather",
    decisionSource: "planner",
    decisionEventId: "decision-maya-001",
    expectedItem: "sweet_berries",
  });
  b.append({
    kind: "action_observation",
    citizenId: "gpt_maya",
    attemptId: attemptId2,
    verified: true,
    successReported: true,
    beforeInventory: {},
    afterInventory: { sweet_berries: 2 },
    worldChanges: [],
  });

  // Theo crafts oak planks
  const attemptId3 = "attempt-theo-001";
  b.append({
    kind: "action_attempt",
    citizenId: "claude_theo",
    attemptId: attemptId3,
    action: "craft",
    decisionSource: "model",
    decisionEventId: "decision-theo-001",
    expectedItem: "oak_planks",
  });
  b.append({
    kind: "action_observation",
    citizenId: "claude_theo",
    attemptId: attemptId3,
    verified: true,
    successReported: true,
    beforeInventory: { oak_log: 1 },
    afterInventory: { oak_planks: 4 },
    worldChanges: [],
  });

  // Ava moves to natural shelter
  const attemptId4 = "attempt-ava-001";
  b.append({
    kind: "action_attempt",
    citizenId: "claude_ava",
    attemptId: attemptId4,
    action: "move",
    decisionSource: "reflex",
    decisionEventId: "decision-ava-001",
    target: { x: 252, y: 64, z: 252 },
    range: 1.5,
  });
  b.append({
    kind: "action_observation",
    citizenId: "claude_ava",
    attemptId: attemptId4,
    verified: true,
    successReported: true,
    beforeInventory: {},
    afterInventory: {},
    position: { x: 251.5, y: 64, z: 252 },
    worldChanges: [],
  });

  // Add 60 ticks with 60,000ms duration each (= 3,600,000ms = 60 minutes) with measured TPS
  for (let i = 0; i < 60; i++) {
    b.append({
      kind: "tick",
      durationMs: 60_000,
      measuredTps: 19.9,
    });
  }

  b.append({
    kind: "shutdown",
    completedDuration: true,
    mode: "offline",
    attempted: 4,
    verified: 4,
    unverified: 0,
    interrupted: 0,
    failed: 0,
  });

  return b.build();
}
