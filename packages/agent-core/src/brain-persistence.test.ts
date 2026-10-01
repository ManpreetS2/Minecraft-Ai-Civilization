import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { serializeCommitmentTarget } from "@civ/shared";
import { BRAIN_MIGRATION_V2, BRAIN_MIGRATION_V3, listAppliedMigrations } from "./brain-migrations.js";
import { BrainPersistence } from "./brain-persistence.js";
import { CivilizationStore } from "./store.js";

function tempStore(name: string): { path: string; store: CivilizationStore; brain: BrainPersistence } {
  const dir = mkdtempSync(join(tmpdir(), "civ-brain-"));
  const path = join(dir, `${name}.sqlite`);
  expect(path.includes("civilization.sqlite")).toBe(false);
  expect(path.toLowerCase().includes("world-lab")).toBe(false);
  const store = new CivilizationStore(path);
  return { path, store, brain: new BrainPersistence(store) };
}

describe("brain migrations (temp DB only)", () => {
  it("applies brain v2+v3 idempotently and preserves citizens", () => {
    const { path, store } = tempStore("mig");
    expect(listAppliedMigrations(store.db)).toContain(BRAIN_MIGRATION_V2);
    expect(listAppliedMigrations(store.db)).toContain(BRAIN_MIGRATION_V3);
    const before = store.getCitizens().map((c) => c.id);
    store.close();

    const again = new CivilizationStore(path);
    expect(listAppliedMigrations(again.db).filter((n) => n === BRAIN_MIGRATION_V2)).toHaveLength(1);
    expect(listAppliedMigrations(again.db).filter((n) => n === BRAIN_MIGRATION_V3)).toHaveLength(1);
    expect(again.getCitizens().map((c) => c.id)).toEqual(before);
    again.close();
  });
});

describe("commitment persistence", () => {
  it("Scenario A: ACTIVE commitment survives restart", () => {
    const { path, brain, store } = tempStore("commit-a");
    const c = brain.createCommitmentPersistent({
      ownerCitizenId: "citizen_atlas",
      counterpartyId: "citizen_maya",
      goal: "bring_food",
      payload: JSON.stringify({ item: "bread", qty: 1 }),
    });
    expect(c.status).toBe("ACTIVE");
    store.close();

    const restored = new CivilizationStore(path);
    const brain2 = new BrainPersistence(restored);
    const again = brain2.getCommitment(c.id);
    expect(again?.status).toBe("ACTIVE");
    expect(again?.ownerCitizenId).toBe("citizen_atlas");
    expect(again?.goal).toBe("bring_food");
    restored.close();
  });

  it("Scenario B: verified transfer completes commitment exactly once", () => {
    const { brain } = tempStore("commit-b");
    const c = brain.createCommitmentPersistent({
      ownerCitizenId: "citizen_maya",
      counterpartyId: "citizen_atlas",
      goal: "deliver_bread",
      payload: serializeCommitmentTarget({
        type: "item_transfer",
        item: "bread",
        quantity: 1,
        recipientCitizenId: "citizen_atlas",
      }),
    });
    const eventId = "evt-transfer-1";
    const first = brain.applyVerifiedTransfer({
      eventId,
      type: "ItemTransferred",
      timestamp: "2026-10-01T12:00:00.000Z",
      giverCitizenId: "citizen_maya",
      receiverCitizenId: "citizen_atlas",
      item: "bread",
      quantity: 1,
      candidateCommitmentIds: [c.id],
      learned: [
        {
          citizenId: "citizen_maya",
          dimension: "resource_sharing",
          direction: 1,
          weight: 1.2,
        },
      ],
    });
    expect(first.applied).toBe(true);
    expect(first.commitment?.status).toBe("COMPLETED");
    expect(first.commitment?.completionEvidenceEventId).toBe(eventId);

    const second = brain.applyVerifiedTransfer({
      eventId,
      type: "ItemTransferred",
      timestamp: "2026-10-01T12:00:00.000Z",
      giverCitizenId: "citizen_maya",
      receiverCitizenId: "citizen_atlas",
      item: "bread",
      quantity: 1,
      candidateCommitmentIds: [c.id],
    });
    expect(second.applied).toBe(false);
    expect(brain.getCommitment(c.id)?.status).toBe("COMPLETED");
  });

  it("expired commitment cannot silently become COMPLETED; bad evidence cannot fabricate completion", () => {
    const { brain } = tempStore("commit-exp");
    const c = brain.createCommitmentPersistent({
      ownerCitizenId: "citizen_atlas",
      goal: "old_promise",
      expiresAt: "2020-01-01T00:00:00.000Z",
    });
    brain.expireDueCommitments("2026-10-01T00:00:00.000Z");
    expect(brain.getCommitment(c.id)?.status).toBe("EXPIRED");
    const bad = brain.completeCommitmentPersistent(
      c.id,
      ["event:fake", "transfer:x"],
      "fake-event",
    );
    expect(bad.ok).toBe(false);
    expect(brain.getCommitment(c.id)?.status).toBe("EXPIRED");
  });
});

describe("relationship belief persistence", () => {
  it("Scenario C: directional beliefs reconstruct after restart; Atlas→Maya ≠ Maya→Atlas", () => {
    const { path, brain, store } = tempStore("rel-c");
    brain.applyBeliefEventPersistent("e1", {
      kind: "was_helped",
      observerId: "citizen_atlas",
      subjectId: "citizen_maya",
      firstPerson: true,
      at: "2026-10-01T10:00:00.000Z",
    });
    brain.applyBeliefEventPersistent("e2", {
      kind: "helped",
      observerId: "citizen_maya",
      subjectId: "citizen_atlas",
      firstPerson: true,
      at: "2026-10-01T10:01:00.000Z",
    });
    brain.applyBeliefEventPersistent("e3", {
      kind: "heard_about",
      observerId: "citizen_atlas",
      subjectId: "citizen_maya",
      firstPerson: false,
      at: "2026-10-01T10:02:00.000Z",
    });

    const atlasMaya = brain.getRelationshipBelief("citizen_atlas", "citizen_maya")!;
    const mayaAtlas = brain.getRelationshipBelief("citizen_maya", "citizen_atlas")!;
    expect(atlasMaya.trust).not.toBe(mayaAtlas.trust);
    expect(atlasMaya.trust).toBeGreaterThan(0.5);
    // heard_about is lower confidence impact than firsthand — familiarity bump only on rumor
    const beforeRumorTrust = atlasMaya.trust;
    expect(atlasMaya.evidenceCount).toBeGreaterThanOrEqual(2);

    // duplicate replay idempotent
    const dup = brain.applyBeliefEventPersistent("e1", {
      kind: "was_helped",
      observerId: "citizen_atlas",
      subjectId: "citizen_maya",
      firstPerson: true,
    });
    expect(dup.applied).toBe(false);
    expect(dup.belief.evidenceCount).toBe(atlasMaya.evidenceCount);

    // contradictory evidence adjusts rather than duplicating row
    brain.applyBeliefEventPersistent("e4", {
      kind: "conflict",
      observerId: "citizen_atlas",
      subjectId: "citizen_maya",
      firstPerson: true,
      at: "2026-10-01T11:00:00.000Z",
    });
    const afterConflict = brain.getRelationshipBelief("citizen_atlas", "citizen_maya")!;
    expect(afterConflict.trust).toBeLessThan(beforeRumorTrust);
    expect(afterConflict.recentNegative).toBeGreaterThan(0);

    store.close();
    const restored = new CivilizationStore(path);
    const brain2 = new BrainPersistence(restored);
    const snap = brain2.getRelationshipBelief("citizen_atlas", "citizen_maya")!;
    const rebuilt = brain2.reconstructBeliefFromEvidence("citizen_atlas", "citizen_maya");
    expect(snap.trust).toBeCloseTo(rebuilt.trust, 5);
    expect(snap.evidenceCount).toBe(rebuilt.evidenceCount);
    expect(brain2.getRelationshipBelief("citizen_maya", "citizen_atlas")?.observerId).toBe(
      "citizen_maya",
    );
    restored.close();
  });
});

describe("learned behavior persistence", () => {
  it("Scenario D: Theo cooperative tendency reconstructs; decay/contradiction/idempotency", () => {
    const { path, brain, store } = tempStore("learn-d");
    const t0 = Date.parse("2026-10-01T00:00:00.000Z");
    for (let i = 0; i < 4; i++) {
      expect(
        brain.insertLearnedEvidence({
          id: `lb-${i}`,
          eventId: `coop-${i}`,
          citizenId: "citizen_theo",
          dimension: "solo_vs_coop",
          direction: 1,
          weight: 1,
          observedAt: new Date(t0 + i * 3600_000).toISOString(),
          source: "joint_work",
          confidence: 0.7,
        }),
      ).toBe(true);
    }
    // duplicate event does not double-count
    expect(
      brain.insertLearnedEvidence({
        id: "lb-dup",
        eventId: "coop-0",
        citizenId: "citizen_theo",
        dimension: "solo_vs_coop",
        direction: 1,
        weight: 9,
        observedAt: new Date(t0).toISOString(),
        source: "joint_work",
        confidence: 0.9,
      }),
    ).toBe(false);

    const summary1 = brain.summarizeLearned("citizen_theo", t0 + 10_000);
    const coop = summary1.find((s) => s.dimension === "solo_vs_coop")!;
    expect(coop.evidenceCount).toBe(4);
    expect(coop.confidence).toBeGreaterThan(0);
    expect(coop.score).toBeGreaterThan(0);
    const unknown = summary1.find((s) => s.dimension === "risk_tolerance")!;
    expect(unknown.confidence).toBe(0);
    expect(unknown.evidenceCount).toBe(0);

    // contradiction shifts summary
    brain.insertLearnedEvidence({
      id: "lb-contra",
      eventId: "solo-1",
      citizenId: "citizen_theo",
      dimension: "solo_vs_coop",
      direction: -1,
      weight: 2,
      observedAt: new Date(t0 + 20_000).toISOString(),
      source: "solo_choice",
      confidence: 0.8,
    });
    const summary2 = brain.summarizeLearned("citizen_theo", t0 + 30_000);
    const coop2 = summary2.find((s) => s.dimension === "solo_vs_coop")!;
    expect(coop2.score).toBeLessThan(coop.score);

    store.close();
    const restored = new CivilizationStore(path);
    const brain2 = new BrainPersistence(restored);
    const summary3 = brain2.summarizeLearned("citizen_theo", t0 + 30_000);
    expect(summary3.find((s) => s.dimension === "solo_vs_coop")).toEqual(coop2);

    // old evidence decay still works
    const farFuture = brain2.summarizeLearned("citizen_theo", t0 + 30 * 24 * 60 * 60 * 1000);
    const decayed = farFuture.find((s) => s.dimension === "solo_vs_coop")!;
    expect(decayed.confidence).toBeLessThan(coop2.confidence);
    restored.close();
  });
});

describe("cognition state persistence", () => {
  it("Scenario E: high-level goal restored; physical execution NOT assumed", () => {
    const { path, brain, store } = tempStore("cog-e");
    brain.saveCognitionState({
      citizenId: "citizen_ava",
      currentHighLevelGoal: "seek_home",
      goalStartedAt: "2026-10-01T09:00:00.000Z",
      lastDeliberationAt: "2026-10-01T09:05:00.000Z",
      reconsiderAfter: "2026-10-01T09:06:00.000Z",
      lastDecisionCategory: "ROUTINE",
      updatedAt: "2026-10-01T09:05:00.000Z",
    });
    store.close();

    const restored = new CivilizationStore(path);
    const brain2 = new BrainPersistence(restored);
    const state = brain2.getCognitionState("citizen_ava");
    expect(state?.currentHighLevelGoal).toBe("seek_home");
    // Explicit: no path node / skill resumption fields exist on CognitionState
    expect(JSON.stringify(state)).not.toMatch(/path.?node|mineflayer|AbortController/i);
    expect(brain2.getCognitionState("citizen_kai")).toBeUndefined();
    restored.close();
  });

  it("Scenario G: citizen A state cannot load as citizen B", () => {
    const { brain } = tempStore("cog-g");
    brain.saveCognitionState({
      citizenId: "citizen_atlas",
      currentHighLevelGoal: "gather_wood",
      updatedAt: "2026-10-01T00:00:00.000Z",
    });
    expect(brain.getCognitionState("citizen_maya")).toBeUndefined();
    expect(brain.getCognitionState("citizen_atlas")?.citizenId).toBe("citizen_atlas");
  });
});

describe("event idempotency + transactions", () => {
  it("Scenario F: duplicate verified event after restart does not double-update", () => {
    const { path, brain, store } = tempStore("idem-f");
    const c = brain.createCommitmentPersistent({
      ownerCitizenId: "citizen_maya",
      counterpartyId: "citizen_atlas",
      goal: "deliver_bread",
      payload: serializeCommitmentTarget({
        type: "item_transfer",
        item: "bread",
        quantity: 1,
        recipientCitizenId: "citizen_atlas",
      }),
    });
    const eventId = "evt-restart-dup";
    brain.applyVerifiedTransfer({
      eventId,
      type: "ItemTransferred",
      timestamp: "2026-10-01T12:00:00.000Z",
      giverCitizenId: "citizen_maya",
      receiverCitizenId: "citizen_atlas",
      item: "bread",
      quantity: 1,
      candidateCommitmentIds: [c.id],
      learned: [
        { citizenId: "citizen_maya", dimension: "help_tendency", direction: 1 },
      ],
    });
    const memCount = store.getMemories("citizen_maya", 100).length;
    const evidenceCount = brain.listLearnedEvidence("citizen_maya").length;
    store.close();

    const restored = new CivilizationStore(path);
    const brain2 = new BrainPersistence(restored);
    const again = brain2.applyVerifiedTransfer({
      eventId,
      type: "ItemTransferred",
      timestamp: "2026-10-01T12:00:00.000Z",
      giverCitizenId: "citizen_maya",
      receiverCitizenId: "citizen_atlas",
      item: "bread",
      quantity: 1,
      candidateCommitmentIds: [c.id],
      learned: [
        { citizenId: "citizen_maya", dimension: "help_tendency", direction: 1 },
      ],
    });
    expect(again.applied).toBe(false);
    expect(restored.getMemories("citizen_maya", 100).length).toBe(memCount);
    expect(brain2.listLearnedEvidence("citizen_maya").length).toBe(evidenceCount);
    expect(brain2.getCommitment(c.id)?.status).toBe("COMPLETED");
    restored.close();
  });

  it("transaction rolls back brain writes if a mid-txn write throws", () => {
    const { brain, store } = tempStore("txn");
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
    expect(() =>
      brain.withTransaction(() => {
        brain.completeCommitmentPersistent(
          c.id,
          [`transfer:bread:maya->atlas`, `event:evt-tx`],
          "evt-tx",
        );
        throw new Error("simulated failure");
      }),
    ).toThrow(/simulated failure/);
    expect(brain.getCommitment(c.id)?.status).toBe("ACTIVE");
    expect(brain.hasAppliedEvent("evt-tx", "composite", "citizen_maya")).toBe(false);
    store.close();
  });

  it("ignores events for wrong citizen when loading cognition", () => {
    const { brain } = tempStore("wrong-citizen");
    brain.saveCognitionState({
      citizenId: "citizen_atlas",
      currentHighLevelGoal: "seek_home",
      lastMajorEventId: "evt-atlas-only",
      updatedAt: "2026-10-01T00:00:00.000Z",
    });
    expect(brain.getCognitionState("citizen_theo")?.lastMajorEventId).toBeUndefined();
  });
});
