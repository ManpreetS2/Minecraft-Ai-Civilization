import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EventBus } from "@civ/shared";
import { bindActionEvidence } from "./action-evidence.js";
import { executePlan } from "./executor.js";
import { ExperimentEvidenceJournal, type ExperimentObservation } from "./experiment-evidence.js";
import type { PlannedTask } from "./planner.js";
import { CivilizationStore } from "./store.js";
import { loadCraftFixture } from "./testing/load-craft-fixture.js";

const dirs: string[] = [];
const journals: ExperimentEvidenceJournal[] = [];
const plan = {
  goal: "gather_wood",
  task: "gather_wood",
  action: "mineBlock",
  source: "llm",
  reason: "scripted gather",
  priority: 0.8,
} as PlannedTask;

afterEach(() => {
  for (const journal of journals.splice(0)) journal.close(false);
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function openJournal(citizenId: string): ExperimentEvidenceJournal {
  const dir = mkdtempSync(join(tmpdir(), "gather-evidence-"));
  dirs.push(dir);
  const journal = new ExperimentEvidenceJournal(join(dir, "operator.jsonl"), "failgather", new Set([citizenId]), "offline", {
    decisionTransport: "scripted-in-process",
  });
  journals.push(journal);
  return journal;
}

describe("gather evidence is recorded per execution", () => {
  it("records a cancelled gather without inventing items or copying the empty delta into the plan", async () => {
    const citizenId = "citizen_atlas";
    const journal = openJournal(citizenId);
    const store = new CivilizationStore(":memory:");
    const events = new EventBus();
    const fx = await loadCraftFixture({ trees: [{ x: 2, z: 0, height: 4 }] });
    fx.ctx.citizenId = citizenId;
    fx.ctx.signal = AbortSignal.abort();
    let planned: Record<string, number> | undefined;
    let observed: ExperimentObservation | undefined;
    bindActionEvidence(events, {
      begin(input) {
        planned = { ...input.expectedDelta };
        return journal.forCitizen(citizenId).attempt({
          action: "gather",
          decisionSource: input.planSource === "llm" ? "scripted" : input.planSource,
          decisionEventId: input.eventId,
          ...(input.expectedItem ? { expectedItem: input.expectedItem } : {}),
          ...(input.originPosition ? { originPosition: input.originPosition } : {}),
        });
      },
      finish(attemptId, observation) {
        observed = {
          successReported: observation.successReported,
          beforeInventory: observation.beforeInventory,
          afterInventory: observation.afterInventory,
          worldChanges: observation.worldChanges,
          ...(observation.position ? { position: observation.position } : {}),
          ...(observation.failureCode ? { failureCode: observation.failureCode } : {}),
          ...(observation.hungerBefore !== undefined ? { hungerBefore: observation.hungerBefore } : {}),
          ...(observation.hungerAfter !== undefined ? { hungerAfter: observation.hungerAfter } : {}),
        };
        journal.forCitizen(citizenId).observe(attemptId, observed);
      },
    });
    try {
      const result = await executePlan(fx.ctx, plan, store, events);
      expect(result.success).toBe(false);
      if (result.success) throw new Error("cancelled gather must fail");
      expect(result.code === "INTERRUPTED" || result.code === "CANCELLED").toBe(true);
      expect(fx.count("oak_log")).toBe(0);
      expect(fx.totalItems()).toBe(0);
      expect(planned).toEqual({ oak_log: 1 });
      expect(observed?.successReported).toBe(false);
      expect(observed?.beforeInventory).toEqual({});
      expect(observed?.afterInventory).toEqual({});
      expect(observed?.failureCode).toBeTruthy();
      expect(journal.operatorSummary()).toMatchObject({ attempted: 1, failed: 1, verified: 0 });
    } finally {
      bindActionEvidence(events, undefined);
      store.close();
    }
  });
});
