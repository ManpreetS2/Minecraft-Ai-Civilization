import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { runScenario } from "./scenario.js";
import { bundleFixture } from "./bundle-fixture.js";
import { validateBundleWithJournal } from "./journal-cross-check.js";
it.each([2, 4] as const)(
  "cross-checks %i citizens' actual recorded actions without replacing IDs",
  async (count) => {
    const root = mkdtempSync(join(tmpdir(), "combined-journal-"));
    try {
      const run = await runScenario({
        count,
        goal: "gather_wood",
        evidenceDirectory: root,
        experimentId: `experiment${count}`,
        runId: `run${count}`,
      });
      const manifest = {
        ...bundleFixture(),
        runId: run.runId,
        sourceSha: run.sourceSha,
        repository: run.repository,
        actions: run.actions,
        expectedActionCount: count * 3,
        sourceReceipts: run.sourceReceipts,
        evidenceContractVersion: 2 as const,
        citizens: run.providers.map((p) => ({
          id: p.citizenId,
          family: p.family,
          model: p.model,
          sessionId: p.sessionId,
          authentication: "synthetic" as const,
          initialInventory: {},
        })),
        persistentFacts: [],
      };
      const input = {
        manifest,
        expectedSourceSha: run.sourceSha,
        expectedRepository: run.repository,
        evidenceRoot: root,
        operatorJournal: {
          reference: "operator.jsonl",
          experimentId: `experiment${count}`,
          runId: run.runId,
          sourceSha: run.sourceSha,
          repository: run.repository,
        },
      };
      const result = validateBundleWithJournal(input);
      expect(result.failures).toEqual([]);
      expect(result.journalConsistent).toBe(true);
      expect(result.verdict).toBe("NOT PROVEN");
      expect(run.actions).toHaveLength(count * 3);
      for (const action of run.actions) {
        expect(action.expectedDelta).toEqual({ oak_log: 1 });
        expect(action.inventoryDelta).toEqual({ oak_log: 1 });
        expect(["scripted", "planner", "reflex"]).toContain(action.decisionSource);
      }
      // Rehash both the receipt and manifest claim while preserving the operator's original.
      const ref = manifest.sourceReceipts[0]!;
      const receipt = JSON.parse(readFileSync(join(root, ref.reference), "utf8"));
      receipt.inventoryAfter.oak_log = 30;
      const bytes = JSON.stringify(receipt);
      writeFileSync(join(root, ref.reference), bytes);
      ref.sha256 = createHash("sha256").update(bytes).digest("hex");
      manifest.actions[0]!.inventoryDelta = { oak_log: 30 };
      expect(validateBundleWithJournal(input).verdict).toBe("FAIL");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
  60_000,
);
