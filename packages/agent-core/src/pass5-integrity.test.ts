import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig, serializeCommitmentTarget } from "@civ/shared";
import { BrainPersistence } from "./brain-persistence.js";
import { BrainReconciler } from "./brain-reconciler.js";
import { captureBrainSnapshot, replayBrainState } from "./brain-replay.js";
import { CitizenBrainAdapter } from "./citizen-brain-adapter.js";
import { isSyntheticEffectId, parseBeliefEffectKey } from "./event-provenance.js";
import {
  inspectSchemaCompatibility,
  snapshotSqliteSchema,
  type SchemaSnapshot,
} from "./schema-preflight.js";
import { CivilizationStore } from "./store.js";

function temp(name: string) {
  const dir = mkdtempSync(join(tmpdir(), "civ-p5-"));
  const path = join(dir, `${name}.sqlite`);
  expect(path.includes("civilization.sqlite")).toBe(false);
  const store = new CivilizationStore(path);
  const brain = new BrainPersistence(store);
  return { path, store, brain };
}

describe("Pass5 commitment predicates + quantity progress", () => {
  it("Scenario A/B/C/D: progressive bread delivery, replay, wrong recipient", () => {
    const { path, brain, store } = temp("progress");
    const c = brain.createCommitmentPersistent({
      id: "c-maya-bread",
      ownerCitizenId: "citizen_maya",
      counterpartyId: "citizen_atlas",
      goal: "deliver_bread",
      payload: serializeCommitmentTarget({
        type: "item_transfer",
        item: "bread",
        quantity: 5,
        recipientCitizenId: "citizen_atlas",
      }),
      createdAt: "2026-10-01T10:00:00.000Z",
    });

    brain.applyVerifiedTransfer({
      eventId: "t1",
      type: "ItemTransferred",
      timestamp: "2026-10-01T10:01:00.000Z",
      giverCitizenId: "citizen_maya",
      receiverCitizenId: "citizen_atlas",
      item: "bread",
      quantity: 1,
      candidateCommitmentIds: [c.id],
    });
    expect(brain.getCommitment(c.id)?.status).toBe("ACTIVE");
    expect(brain.getCommitmentProgress(c.id)).toMatchObject({ delivered: 1, required: 5 });

    // wrong item — no progress
    brain.applyVerifiedTransfer({
      eventId: "t-carrot",
      type: "ItemTransferred",
      timestamp: "2026-10-01T10:02:00.000Z",
      giverCitizenId: "citizen_maya",
      receiverCitizenId: "citizen_atlas",
      item: "carrot",
      quantity: 5,
      candidateCommitmentIds: [c.id],
    });
    expect(brain.getCommitmentProgress(c.id)?.delivered).toBe(1);

    // Scenario D: wrong recipient
    brain.applyVerifiedTransfer({
      eventId: "t-theo",
      type: "ItemTransferred",
      timestamp: "2026-10-01T10:03:00.000Z",
      giverCitizenId: "citizen_maya",
      receiverCitizenId: "citizen_theo",
      item: "bread",
      quantity: 4,
      candidateCommitmentIds: [c.id],
    });
    expect(brain.getCommitmentProgress(c.id)?.delivered).toBe(1);

    // wrong giver
    brain.applyVerifiedTransfer({
      eventId: "t-atlas-gives",
      type: "ItemTransferred",
      timestamp: "2026-10-01T10:04:00.000Z",
      giverCitizenId: "citizen_atlas",
      receiverCitizenId: "citizen_atlas",
      item: "bread",
      quantity: 4,
      candidateCommitmentIds: [c.id],
    });
    expect(brain.getCommitmentProgress(c.id)?.delivered).toBe(1);

    store.close();
    // Scenario A restart
    const restored = new CivilizationStore(path);
    const brain2 = new BrainPersistence(restored);
    expect(brain2.getCommitment(c.id)?.status).toBe("ACTIVE");
    expect(brain2.getCommitmentProgress(c.id)).toMatchObject({ delivered: 1, required: 5 });

    // Scenario B: remaining 4
    brain2.applyVerifiedTransfer({
      eventId: "t2",
      type: "ItemTransferred",
      timestamp: "2026-10-01T11:00:00.000Z",
      giverCitizenId: "citizen_maya",
      receiverCitizenId: "citizen_atlas",
      item: "bread",
      quantity: 4,
      candidateCommitmentIds: [c.id],
    });
    expect(brain2.getCommitment(c.id)?.status).toBe("COMPLETED");
    expect(brain2.getCommitmentProgress(c.id)).toMatchObject({ delivered: 5, required: 5 });

    // Scenario C: replay same events — stay 5/5
    brain2.applyVerifiedTransfer({
      eventId: "t1",
      type: "ItemTransferred",
      timestamp: "2026-10-01T10:01:00.000Z",
      giverCitizenId: "citizen_maya",
      receiverCitizenId: "citizen_atlas",
      item: "bread",
      quantity: 1,
      candidateCommitmentIds: [c.id],
    });
    brain2.applyVerifiedTransfer({
      eventId: "t2",
      type: "ItemTransferred",
      timestamp: "2026-10-01T11:00:00.000Z",
      giverCitizenId: "citizen_maya",
      receiverCitizenId: "citizen_atlas",
      item: "bread",
      quantity: 4,
      candidateCommitmentIds: [c.id],
    });
    expect(brain2.getCommitmentProgress(c.id)?.delivered).toBe(5);
    expect(brain2.getCommitment(c.id)?.status).toBe("COMPLETED");
    restored.close();
  });

  it("candidateCommitmentId alone cannot force completion without predicate match", () => {
    const { brain } = temp("force");
    const c = brain.createCommitmentPersistent({
      ownerCitizenId: "citizen_maya",
      goal: "deliver_bread",
      payload: serializeCommitmentTarget({
        type: "item_transfer",
        item: "bread",
        quantity: 1,
        recipientCitizenId: "citizen_atlas",
      }),
    });
    brain.applyVerifiedTransfer({
      eventId: "wrong",
      type: "ItemTransferred",
      timestamp: "2026-10-01T12:00:00.000Z",
      giverCitizenId: "citizen_maya",
      receiverCitizenId: "citizen_atlas",
      item: "stick",
      quantity: 1,
      completesCommitmentId: c.id,
    });
    expect(brain.getCommitment(c.id)?.status).toBe("ACTIVE");
    expect(brain.getCommitmentProgress(c.id)?.delivered).toBe(0);
  });
});

describe("Pass5 durable model budget", () => {
  it("Scenario E/F: Atlas remains capped after restart; new MC day resets; routine window survives", () => {
    const { path, store, brain } = temp("budget");
    const config = loadConfig({
      ...process.env,
      CITIZEN_BRAIN_V2_ENABLED: "true",
      LLM_MAX_CALLS_PER_CITIZEN_PER_MC_DAY: "2",
      LLM_MAX_ROUTINE_CALLS_PER_WINDOW: "2",
      LLM_ROUTINE_WINDOW_MS: "60000",
    });
    const adapter = new CitizenBrainAdapter(config, brain);
    const t0 = Date.parse("2026-10-01T12:00:00.000Z");
    adapter.recordDurableBudgetCall({
      citizenId: "citizen_atlas",
      category: "ROUTINE",
      atMs: t0,
      mcDay: 3,
      decisionId: "d1",
    });
    adapter.recordDurableBudgetCall({
      citizenId: "citizen_atlas",
      category: "ROUTINE",
      atMs: t0 + 1000,
      mcDay: 3,
      decisionId: "d2",
    });
    // retry same decision must not double-count
    adapter.recordDurableBudgetCall({
      citizenId: "citizen_atlas",
      category: "ROUTINE",
      atMs: t0 + 1500,
      mcDay: 3,
      decisionId: "d2",
      fallbackUsed: true,
    });
    expect(adapter.getBudgetHistory().filter((h) => h.citizenId === "citizen_atlas")).toHaveLength(2);

    store.close();
    const restored = new CivilizationStore(path);
    const brain2 = new BrainPersistence(restored);
    const adapter2 = new CitizenBrainAdapter(config, brain2);
    const exhausted = adapter2.deliberate({
      citizenId: "citizen_atlas",
      citizenName: "Atlas",
      memories: [],
      situationQuery: "next",
      routing: { lethalDanger: false, continuingObviousSkill: false, ordinaryChoice: true },
      taskFailed: true,
      now: t0 + 2000,
      mcDay: 3,
    });
    expect(exhausted.budgetExhausted).toBe(true);

    const maya = adapter2.deliberate(
      {
        citizenId: "citizen_maya",
        citizenName: "Maya",
        memories: [],
        situationQuery: "next",
        routing: { lethalDanger: false, continuingObviousSkill: false, ordinaryChoice: true },
        taskFailed: true,
        now: t0 + 2000,
        mcDay: 3,
      },
      { primaryGoal: "gather_food", reasonSummary: "food", confidence: 0.5 },
    );
    expect(maya.budgetExhausted).toBe(false);
    expect(maya.llmCalled).toBe(true);

    // Scenario F: new Minecraft day resets day budget (after routine window elapses)
    const day4Now = t0 + 120_000;
    const day4 = adapter2.deliberate(
      {
        citizenId: "citizen_atlas",
        citizenName: "Atlas",
        memories: [],
        situationQuery: "next",
        routing: { lethalDanger: false, continuingObviousSkill: false, ordinaryChoice: true },
        taskFailed: true,
        now: day4Now,
        mcDay: 4,
      },
      { primaryGoal: "gather_wood", reasonSummary: "wood", confidence: 0.5 },
      { decisionId: "d-day4" },
    );
    expect(day4.budgetExhausted).toBe(false);
    expect(day4.llmCalled).toBe(true);

    // rolling routine window still obeyed from durable timestamps within window
    adapter2.recordDurableBudgetCall({
      citizenId: "citizen_kai",
      category: "ROUTINE",
      atMs: day4Now + 10_000,
      mcDay: 4,
      decisionId: "k1",
    });
    adapter2.recordDurableBudgetCall({
      citizenId: "citizen_kai",
      category: "ROUTINE",
      atMs: day4Now + 11_000,
      mcDay: 4,
      decisionId: "k2",
    });
    const kaiWindow = adapter2.deliberate({
      citizenId: "citizen_kai",
      citizenName: "Kai",
      memories: [],
      situationQuery: "next",
      routing: { lethalDanger: false, continuingObviousSkill: false, ordinaryChoice: true },
      taskFailed: true,
      now: day4Now + 12_000,
      mcDay: 4,
    });
    expect(kaiWindow.budgetExhausted).toBe(true);
    expect(kaiWindow.skipReason).toMatch(/routine_window|citizen_day/);
    restored.close();
  });
});

describe("Pass5 reconciler + replay + provenance", () => {
  it("Scenario G: reconciler repairs missing brain effects once", () => {
    const { store, brain } = temp("recon");
    const c = brain.createCommitmentPersistent({
      id: "c1",
      ownerCitizenId: "citizen_maya",
      goal: "deliver",
      payload: serializeCommitmentTarget({
        type: "item_transfer",
        item: "bread",
        quantity: 1,
        recipientCitizenId: "citizen_atlas",
      }),
    });
    // Durable verified event present, brain effects missing (crash window).
    store.appendEventIdempotent({
      id: "evt-orphan",
      type: "ItemTransferred",
      timestamp: "2026-10-01T15:00:00.000Z",
      citizenId: "citizen_maya",
      payload: {
        to: "citizen_atlas",
        item: "bread",
        quantity: 1,
        verified: true,
        candidateCommitmentIds: [c.id],
      },
    });
    expect(brain.hasAppliedEvent("evt-orphan", "composite", "citizen_maya")).toBe(false);

    const reconciler = new BrainReconciler(store, brain);
    const first = reconciler.reconcile({ batchSize: 10 });
    expect(first.applied).toBe(1);
    expect(brain.getCommitment(c.id)?.status).toBe("COMPLETED");
    expect(brain.hasAppliedEvent("evt-orphan", "composite", "citizen_maya")).toBe(true);

    const second = reconciler.reconcile({ batchSize: 10 });
    expect(second.applied).toBe(0);
    expect(second.skippedAlreadyApplied).toBeGreaterThanOrEqual(1);

    // malformed never silently dropped
    store.appendEventIdempotent({
      id: "evt-bad",
      type: "ItemTransferred",
      timestamp: "2026-10-01T15:01:00.000Z",
      citizenId: "citizen_maya",
      payload: { to: "citizen_atlas", item: "bread", verified: true },
    });
    const bad = reconciler.reconcile({ batchSize: 10 });
    expect(bad.failures.some((f) => f.eventId === "evt-bad" && f.code === "MALFORMED")).toBe(true);
  });

  it("Scenario H: full replay into fresh DB matches snapshot", () => {
    const events = [
      {
        eventId: "r1",
        type: "ItemTransferred" as const,
        timestamp: "2026-10-01T08:00:00.000Z",
        giverCitizenId: "citizen_maya",
        receiverCitizenId: "citizen_atlas",
        item: "bread",
        quantity: 2,
        candidateCommitmentIds: ["c-replay"],
        learned: [
          {
            citizenId: "citizen_maya",
            dimension: "resource_sharing" as const,
            direction: 1 as const,
          },
        ],
      },
      {
        eventId: "r2",
        type: "ItemTransferred" as const,
        timestamp: "2026-10-01T08:05:00.000Z",
        giverCitizenId: "citizen_maya",
        receiverCitizenId: "citizen_atlas",
        item: "bread",
        quantity: 3,
        candidateCommitmentIds: ["c-replay"],
      },
    ];
    const seed = {
      commitments: [
        {
          id: "c-replay",
          ownerCitizenId: "citizen_maya",
          counterpartyId: "citizen_atlas",
          goal: "deliver_bread",
          createdAt: "2026-10-01T07:00:00.000Z",
          target: {
            type: "item_transfer" as const,
            item: "bread",
            quantity: 5,
            recipientCitizenId: "citizen_atlas",
          },
        },
      ],
      events,
    };
    const a = replayBrainState(seed);
    const b = replayBrainState(seed);
    expect(b.snapshot).toEqual(a.snapshot);
    expect(a.snapshot.commitments[0]?.status).toBe("COMPLETED");
    expect(a.snapshot.commitments[0]?.progressDelivered).toBe(5);

    // double replay of same events inside one DB stays equal
    const { path, store, brain } = temp("dbl");
    for (const c of seed.commitments) {
      brain.createCommitmentPersistent({
        id: c.id,
        ownerCitizenId: c.ownerCitizenId,
        counterpartyId: c.counterpartyId,
        goal: c.goal,
        payload: serializeCommitmentTarget(c.target),
        createdAt: c.createdAt,
      });
    }
    for (const e of events) brain.applyVerifiedTransfer(e);
    const snap1 = captureBrainSnapshot(brain, store);
    for (const e of events) brain.applyVerifiedTransfer(e);
    const snap2 = captureBrainSnapshot(brain, store);
    expect(snap2).toEqual(snap1);
    store.close();
    a.close();
    b.close();
    void path;
  });

  it("belief effects retain source_event_id; synthetic keys are not MC events", () => {
    const { brain, store } = temp("prov");
    brain.applyVerifiedTransfer({
      eventId: "mc-evt-9",
      type: "ItemTransferred",
      timestamp: "2026-10-01T09:00:00.000Z",
      giverCitizenId: "citizen_maya",
      receiverCitizenId: "citizen_atlas",
      item: "bread",
      quantity: 1,
    });
    const rows = store.db
      .prepare(
        `SELECT event_id, source_event_id, effect_role FROM relationship_belief_evidence
         WHERE source_event_id = 'mc-evt-9' ORDER BY effect_role`,
      )
      .all() as Array<{ event_id: string; source_event_id: string; effect_role: string }>;
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.source_event_id === "mc-evt-9")).toBe(true);
    expect(rows.map((r) => r.effect_role).sort()).toEqual(["transfer_giver", "transfer_receiver"]);
    for (const r of rows) {
      if (r.effect_role !== "direct") {
        expect(isSyntheticEffectId(r.event_id)).toBe(true);
        expect(parseBeliefEffectKey(r.event_id).sourceEventId).toBe("mc-evt-9");
      }
    }
  });
});

describe("Pass5 schema preflight (read-only)", () => {
  it("classifies clean, pass4, mismatched PK, missing migrations, richer supersets", () => {
    const cleanOld: SchemaSnapshot = {
      tables: [
        {
          name: "citizens",
          columns: [
            { name: "id", type: "TEXT", pk: 1, notnull: 1 },
            { name: "name", type: "TEXT", pk: 0, notnull: 1 },
          ],
        },
        {
          name: "events",
          columns: [
            { name: "id", type: "TEXT", pk: 1, notnull: 1 },
            { name: "type", type: "TEXT", pk: 0, notnull: 1 },
            { name: "timestamp", type: "TEXT", pk: 0, notnull: 1 },
            { name: "citizen_id", type: "TEXT", pk: 0, notnull: 0 },
            { name: "payload", type: "TEXT", pk: 0, notnull: 1 },
          ],
        },
        {
          name: "memories",
          columns: [{ name: "id", type: "TEXT", pk: 1, notnull: 1 }],
        },
        {
          name: "relationships",
          columns: [
            { name: "citizen_id", type: "TEXT", pk: 1, notnull: 1 },
            { name: "other_id", type: "TEXT", pk: 2, notnull: 1 },
            { name: "trust", type: "REAL", pk: 0, notnull: 1 },
            { name: "familiarity", type: "REAL", pk: 0, notnull: 1 },
          ],
        },
        {
          name: "llm_calls",
          columns: [
            { name: "id", type: "TEXT", pk: 1, notnull: 1 },
            { name: "citizen_id", type: "TEXT", pk: 0, notnull: 0 },
            { name: "timestamp", type: "TEXT", pk: 0, notnull: 1 },
            { name: "ok", type: "INTEGER", pk: 0, notnull: 1 },
          ],
        },
      ],
    };
    expect(inspectSchemaCompatibility(cleanOld).status).toBe("MANUAL_RECONCILE_REQUIRED");

    const { store } = temp("preflight-live");
    const live = snapshotSqliteSchema(store.db);
    const liveReport = inspectSchemaCompatibility(live);
    expect(["COMPATIBLE", "MANUAL_RECONCILE_REQUIRED"]).toContain(liveReport.status);
    expect(liveReport.findings.some((f) => f.code === "INCOMPATIBLE_PRIMARY_KEY")).toBe(false);
    store.close();

    const badPk: SchemaSnapshot = {
      tables: [
        ...cleanOld.tables.filter((t) => t.name !== "events"),
        {
          name: "events",
          columns: [
            { name: "event_uuid", type: "TEXT", pk: 1, notnull: 1 },
            { name: "type", type: "TEXT", pk: 0, notnull: 1 },
            { name: "timestamp", type: "TEXT", pk: 0, notnull: 1 },
            { name: "citizen_id", type: "TEXT", pk: 0, notnull: 0 },
            { name: "payload", type: "TEXT", pk: 0, notnull: 1 },
          ],
        },
      ],
      migrations: ["brain_persistence_v2"],
    };
    expect(inspectSchemaCompatibility(badPk).status).toBe("INCOMPATIBLE");

    const richer: SchemaSnapshot = {
      tables: live.tables.map((t) =>
        t.name === "llm_calls"
          ? {
              ...t,
              columns: [...t.columns, { name: "extra_main_pc_col", type: "TEXT", pk: 0, notnull: 0 }],
            }
          : t,
      ),
      migrations: live.migrations,
    };
    const richerReport = inspectSchemaCompatibility(richer);
    expect(richerReport.status).not.toBe("INCOMPATIBLE");
    expect(richerReport.findings.some((f) => f.code === "RICHER_SUPERSET")).toBe(true);
  });
});
