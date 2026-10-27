/**
 * Mission 006A — structured construction evidence logging.
 *
 * Distinguishes intended / attempted / observed / verified / persisted.
 * Never invents gameplay outcomes — callers must supply real observations.
 */
import { appendFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Vec3 } from "@civ/shared";

export type EvidencePhase =
  | "intended"
  | "attempted"
  | "observed"
  | "verified"
  | "persisted"
  | "aborted"
  | "cancelled";

export type ConstructionEvidenceEvent = {
  ts: string;
  experimentId: string;
  stage: string;
  phase: EvidencePhase;
  citizenId?: string;
  projectId?: string;
  blueprintId?: string;
  site?: Vec3;
  expectedPosition?: Vec3;
  intendedPlacement?: { item: string; position: Vec3; purpose?: string };
  preInventory?: Record<string, number>;
  postInventory?: Record<string, number>;
  inventoryDelta?: Record<string, number>;
  navigation?: { ok: boolean; code?: string; error?: string };
  equip?: { ok: boolean; item?: string; code?: string; error?: string };
  placement?: { ok: boolean; code?: string; error?: string; mineflayerResolved?: boolean };
  observedBlock?: { name?: string; properties?: Record<string, string>; position?: Vec3 };
  verified?: { ok: boolean; detail?: string };
  sqliteCheckpoint?: { ok: boolean; reason?: string; projectStatus?: string };
  constructionStatus?: string;
  failureReason?: string;
  note?: string;
  /** Explicit: this row is not live Minecraft evidence unless liveSession=true. */
  liveSession: boolean;
};

export type ConstructionEvidenceLog = {
  path: string;
  experimentId: string;
  liveSession: boolean;
  append: (event: Omit<ConstructionEvidenceEvent, "ts" | "experimentId" | "liveSession"> & { liveSession?: boolean }) => void;
  snapshotInventoryDelta: (
    before: Record<string, number>,
    after: Record<string, number>,
  ) => Record<string, number>;
};

export function inventoryDelta(
  before: Record<string, number>,
  after: Record<string, number>,
): Record<string, number> {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const delta: Record<string, number> = {};
  for (const key of keys) {
    const d = (after[key] ?? 0) - (before[key] ?? 0);
    if (d !== 0) delta[key] = d;
  }
  return delta;
}

export function createConstructionEvidenceLog(args: {
  dir: string;
  experimentId: string;
  liveSession?: boolean;
}): ConstructionEvidenceLog {
  mkdirSync(args.dir, { recursive: true });
  const path = join(args.dir, `${args.experimentId}.jsonl`);
  if (!existsSync(path)) {
    writeFileSync(path, "", "utf8");
  }
  const liveSession = args.liveSession === true;
  return {
    path,
    experimentId: args.experimentId,
    liveSession,
    snapshotInventoryDelta: inventoryDelta,
    append(event) {
      const row: ConstructionEvidenceEvent = {
        ts: new Date().toISOString(),
        experimentId: args.experimentId,
        liveSession: event.liveSession ?? liveSession,
        ...event,
      };
      appendFileSync(path, `${JSON.stringify(row)}\n`, "utf8");
    },
  };
}

export function evidenceHeaderMarkdown(args: {
  experimentId: string;
  stage: string;
  liveSession: boolean;
}): string {
  return [
    `# Construction evidence — ${args.experimentId}`,
    ``,
    `- Stage: ${args.stage}`,
    `- liveSession: ${args.liveSession}`,
    `- Note: offline/dry-run rows must never be treated as physical Minecraft proof.`,
    ``,
  ].join("\n");
}

export function ensureEvidenceDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
  const parent = dirname(dir);
  void parent;
}
