import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createTestManifest, createValid2v2Journal, JournalBuilder } from "./helpers.js";

const baseDir = new URL(".", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");

// 1. Generate sample-2v2 (Valid)
const validDir = join(baseDir, "sample-2v2");
mkdirSync(validDir, { recursive: true });

const validManifest = createTestManifest({ stage: "2v2", durationMinutes: 60 });
writeFileSync(join(validDir, "manifest.json"), JSON.stringify(validManifest, null, 2), "utf8");

const { lines: validLines } = createValid2v2Journal();
writeFileSync(join(validDir, "operator-journal.jsonl"), validLines.join("\n"), "utf8");

const validEvents = [
  {
    id: "ev-start-1",
    type: "SimulationStarted",
    timestamp: "2026-11-01T12:00:00.000Z",
    payload: { stage: "2v2", mode: "offline", visibility: { class: "observer_only" } },
  },
  {
    id: "ev-gather-atlas",
    type: "ResourceCollected",
    timestamp: "2026-11-01T12:01:00.000Z",
    citizenId: "gpt_atlas",
    payload: {
      item: "oak_log",
      count: 1,
      visibility: {
        class: "settlement_public",
        audience: { scope: "community", communityId: "north_cove" },
      },
    },
  },
];
writeFileSync(join(validDir, "events.jsonl"), validEvents.map((e) => JSON.stringify(e)).join("\n"), "utf8");

const validFacts = [
  {
    id: "fact-atlas-1",
    citizenId: "gpt_atlas",
    factKey: "gathered_wood",
    content: "Gathered 1 oak log from natural tree",
    kind: "observed_fact",
    createdAt: "2026-11-01T12:01:05.000Z",
    sourceEventId: "ev-gather-atlas",
  },
];
writeFileSync(join(validDir, "facts.json"), JSON.stringify(validFacts, null, 2), "utf8");

const validInventories = {
  gpt_atlas: { oak_log: 1 },
  gpt_maya: { sweet_berries: 2 },
  claude_theo: { oak_planks: 4 },
  claude_ava: {},
};
writeFileSync(join(validDir, "inventories.json"), JSON.stringify(validInventories, null, 2), "utf8");

// 2. Generate sample-corrupted (Negative demonstration)
const corruptDir = join(baseDir, "sample-corrupted");
mkdirSync(corruptDir, { recursive: true });

const corruptManifest = createTestManifest({ stage: "2v2", durationMinutes: 60 });
writeFileSync(join(corruptDir, "manifest.json"), JSON.stringify(corruptManifest, null, 2), "utf8");

const bCorrupt = new JournalBuilder("exp-2v2-corrupt-demo");
bCorrupt.append({
  kind: "action_attempt",
  citizenId: "gpt_atlas",
  attemptId: "att-phantom-food",
  action: "gather",
  decisionSource: "model",
  decisionEventId: "dec-dishonest-1",
  expectedItem: "sweet_berries",
});
bCorrupt.append({
  kind: "action_observation",
  citizenId: "gpt_atlas",
  attemptId: "att-phantom-food",
  verified: false,
  successReported: true, // Lies about success!
  beforeInventory: {},
  afterInventory: {},
  worldChanges: [],
});
// Missing duration: only 2 ticks instead of 60
bCorrupt.append({ kind: "tick", durationMs: 60_000, measuredTps: 19.8 });
bCorrupt.append({ kind: "tick", durationMs: 60_000, measuredTps: 19.8 });
bCorrupt.append({ kind: "shutdown", completedDuration: true, mode: "offline" });

const { lines: corruptLines } = bCorrupt.build();
writeFileSync(join(corruptDir, "operator-journal.jsonl"), corruptLines.join("\n"), "utf8");

const corruptFacts = [
  {
    id: "fact-leaked-site",
    citizenId: "claude_theo",
    factKey: "rival_site",
    content: "Rival settlement is at x=100, z=100", // Unobserved rival location!
    kind: "observed_fact",
    createdAt: "2026-11-01T12:00:00.000Z",
  },
];
writeFileSync(join(corruptDir, "facts.json"), JSON.stringify(corruptFacts, null, 2), "utf8");

console.log("Sample fixtures generated successfully.");
