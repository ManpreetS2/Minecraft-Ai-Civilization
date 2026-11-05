import { describe, expect, it } from "vitest";
import { auditInventoryConservation } from "../src/inventory-verifier.js";
import { createTestManifest } from "../fixtures/helpers.js";
import type { ActionVerificationResult } from "../src/types.js";

describe("Inventory Conservation Verifier", () => {
  it("passes when all final items match verified physical deltas from empty start", () => {
    const manifest = createTestManifest();

    const actionVerifications: ActionVerificationResult[] = [
      {
        attemptId: "att-1",
        citizenId: "gpt_atlas",
        action: "gather",
        decisionEventId: "dec-1",
        decisionSource: "model",
        status: "VERIFIED",
        classification: "successful_action",
        chain: {
          worldEventProven: true,
          legitimatelyObserved: true,
          legitimateBelief: true,
          decisionDocumented: true,
          actionAttempted: true,
          physicalOutcomeVerified: true,
        },
        physicalDeltas: {
          inventoryDelta: { sweet_berries: 4 },
          worldChangesCount: 0,
        },
        reasons: [],
      },
    ];

    const finalInventories = {
      gpt_atlas: { sweet_berries: 4 },
      gpt_maya: {},
      claude_theo: {},
      claude_ava: {},
    };

    const audit = auditInventoryConservation({
      manifest,
      actionVerifications,
      citizenFinalInventories: finalInventories,
    });

    expect(audit.valid).toBe(true);
    expect(audit.discrepancies.length).toBe(0);
    expect(audit.totalItemsAcquired).toEqual({ sweet_berries: 4 });
  });

  it("detects spontaneous item gain (items appearing without verified actions)", () => {
    const manifest = createTestManifest();

    // Atlas gathered 2 logs, but final inventory suddenly has 64 diamonds!
    const actionVerifications: ActionVerificationResult[] = [
      {
        attemptId: "att-2",
        citizenId: "gpt_atlas",
        action: "gather",
        decisionEventId: "dec-2",
        decisionSource: "model",
        status: "VERIFIED",
        classification: "successful_action",
        chain: {
          worldEventProven: true,
          legitimatelyObserved: true,
          legitimateBelief: true,
          decisionDocumented: true,
          actionAttempted: true,
          physicalOutcomeVerified: true,
        },
        physicalDeltas: {
          inventoryDelta: { oak_log: 2 },
          worldChangesCount: 0,
        },
        reasons: [],
      },
    ];

    const finalInventories = {
      gpt_atlas: { oak_log: 2, diamond: 64 }, // Free 64 diamonds!
    };

    const audit = auditInventoryConservation({
      manifest,
      actionVerifications,
      citizenFinalInventories: finalInventories,
    });

    expect(audit.valid).toBe(false);
    expect(audit.discrepancies.length).toBe(1);
    expect(audit.discrepancies[0]?.type).toBe("SPONTANEOUS_GAIN");
    expect(audit.discrepancies[0]?.item).toBe("diamond");
    expect(audit.discrepancies[0]?.amount).toBe(64);
  });

  it("detects unverified starter inventory violation", () => {
    const manifest = createTestManifest();
    // Corrupt the manifest to have non-empty starter inventory
    manifest.citizens[0]!.inventory = [{ name: "bread", count: 5 }];

    const audit = auditInventoryConservation({
      manifest,
      actionVerifications: [],
    });

    expect(audit.valid).toBe(false);
    expect(audit.initialInventoriesEmpty).toBe(false);
    expect(audit.discrepancies[0]?.description).toContain("started with unverified non-empty inventory");
  });
});
