import { copyFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { serializeCommitmentTarget } from "@civ/shared";
import { BrainPersistence } from "./brain-persistence.js";
import { BrainReconciler } from "./brain-reconciler.js";
import {
  classifyDbPath,
  inspectDbCopy,
  migrateDbCopy,
} from "./db-copy-harness.js";
import { CivilizationStore } from "./store.js";

describe("Pass6 reconciler dry-run", () => {
  it("reports would-apply without writing brain effects", () => {
    const dir = mkdtempSync(join(tmpdir(), "civ-p6-"));
    const path = join(dir, "dry.sqlite");
    const store = new CivilizationStore(path);
    const brain = new BrainPersistence(store);
    const c = brain.createCommitmentPersistent({
      id: "c-dry",
      ownerCitizenId: "citizen_maya",
      goal: "deliver",
      payload: serializeCommitmentTarget({
        type: "item_transfer",
        item: "bread",
        quantity: 1,
        recipientCitizenId: "citizen_atlas",
      }),
    });
    store.appendEventIdempotent({
      id: "evt-dry",
      type: "ItemTransferred",
      timestamp: "2026-10-01T12:00:00.000Z",
      citizenId: "citizen_maya",
      payload: {
        to: "citizen_atlas",
        item: "bread",
        quantity: 1,
        verified: true,
        candidateCommitmentIds: [c.id],
      },
    });

    const report = brain && new BrainReconciler(store, brain).report({ batchSize: 10 });
    expect(report.dryRun).toBe(true);
    expect(report.wouldApply?.some((e) => e.eventId === "evt-dry")).toBe(true);
    expect(brain.hasAppliedEvent("evt-dry", "composite", "citizen_maya")).toBe(false);
    expect(brain.getCommitment(c.id)?.status).toBe("ACTIVE");

    const applied = new BrainReconciler(store, brain).reconcile({ batchSize: 10 });
    expect(applied.applied).toBe(1);
    expect(brain.getCommitment(c.id)?.status).toBe("COMPLETED");
    store.close();
  });
});

describe("Pass6 DB copy harness", () => {
  it("refuses production and world-lab authoritative paths; migrates named copies only", () => {
    expect(classifyDbPath("/data/civilization.sqlite").safeToMutate).toBe(false);
    expect(classifyDbPath("/lab/WORLD-LAB/run.sqlite").safeToMutate).toBe(false);
    expect(classifyDbPath("/tmp/civ-copy.sqlite").safeToMutate).toBe(true);
    expect(classifyDbPath("/tmp/fixture-brain.sqlite").safeToMutate).toBe(true);

    const dir = mkdtempSync(join(tmpdir(), "civ-p6-db-"));
    // Simulate an "authoritative" file name, then require work copy.
    const fakeProd = join(dir, "civilization.sqlite");
    const seed = join(dir, "seed-temp.sqlite");
    const seedStore = new CivilizationStore(seed);
    seedStore.close();
    copyFileSync(seed, fakeProd);

    expect(() =>
      migrateDbCopy(fakeProd, { applyMigrations: true }),
    ).toThrow(/refusing production|copy/i);

    const work = join(dir, "civilization.copy.sqlite");
    const report = migrateDbCopy(fakeProd, { applyMigrations: true, workCopyPath: work });
    expect(report.mutated).toBe(true);
    expect(report.path).toBe(work);
    expect(report.preflight.status).not.toBe("INCOMPATIBLE");

    const inspect = inspectDbCopy(work);
    expect(inspect.mutated).toBe(false);
    expect(inspect.rowCountsBefore.some((r) => r.table === "citizens")).toBe(true);
  });

  it("never treats unlabeled unknown paths as mutable", () => {
    const dir = mkdtempSync(join(tmpdir(), "civ-p6-unk-"));
    const mystery = join(dir, "mystery.sqlite");
    writeFileSync(mystery, "");
    // empty file isn't a valid sqlite for inspect — classification alone matters here
    expect(classifyDbPath(mystery).safeToMutate).toBe(false);
  });
});
