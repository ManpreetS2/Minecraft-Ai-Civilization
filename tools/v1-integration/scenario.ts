import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { CivilizationStore, ExperimentEvidenceJournal, type ExperimentObservation } from "../../packages/agent-core/src/index.js";
import { createEvent } from "../../packages/shared/src/index.js";
import { createIndependentOfflineRuntime } from "../../apps/orchestrator/src/independent-offline-runtime.js";
import { buildFixture } from "./fixtures.js";
import type { FactEvidence, ReceiptReference, SourceReceipt } from "./manifest.js";

export interface ScenarioInput {
  count: 2 | 4;
  goal: "observe" | "gather_wood";
  /** Absolute directory for operator.jsonl and V2 source receipts. */
  evidenceDirectory?: string;
  experimentId?: string;
  runId?: string;
  repository?: string;
}

type GatherObservation = {
  successReported: boolean;
  beforeInventory: Record<string, number>;
  afterInventory: Record<string, number>;
  position?: { x: number; y: number; z: number };
  hungerBefore?: number;
  hungerAfter?: number;
  worldChanges: ExperimentObservation["worldChanges"];
  failureCode?: string;
};

type CompletedGather = {
  attemptId: string;
  eventId: string;
  citizenId: string;
  decisionSource: "scripted" | "planner" | "reflex";
  expectedDelta: Record<string, number>;
  originPosition: { x: number; y: number; z: number } | null;
  observation: GatherObservation;
};

function journalObservation(input: GatherObservation): ExperimentObservation {
  const observation: ExperimentObservation = {
    successReported: input.successReported,
    beforeInventory: input.beforeInventory,
    afterInventory: input.afterInventory,
    worldChanges: input.worldChanges,
  };
  if (input.position) observation.position = input.position;
  if (input.hungerBefore !== undefined) observation.hungerBefore = input.hungerBefore;
  if (input.hungerAfter !== undefined) observation.hungerAfter = input.hungerAfter;
  if (input.failureCode) observation.failureCode = input.failureCode;
  return observation;
}

function inventoryChange(before: Record<string, number>, after: Record<string, number>): Record<string, number> {
  const delta: Record<string, number> = {};
  for (const name of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const change = (after[name] ?? 0) - (before[name] ?? 0);
    if (change !== 0) delta[name] = change;
  }
  return delta;
}

/**
 * Controlled fake-world exercise through the real manager/planner/executor path.
 * Decisions are **scripted-in-process** — not live GPT/Claude — and the journal declares that explicitly.
 */
export async function runScenario(input: ScenarioInput) {
  if (
    !input ||
    ![2, 4].includes(input.count) ||
    !["observe", "gather_wood"].includes(input.goal) ||
    Object.keys(input).some((k) => !["count", "goal", "evidenceDirectory", "experimentId", "runId", "repository"].includes(k))
  ) {
    throw new Error("Only count, scripted goal, and optional evidenceDirectory/experimentId/runId/repository are accepted");
  }
  const sourceSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const fixture = buildFixture(input.count, input.goal);
  let restarted: ReturnType<typeof createIndependentOfflineRuntime> | undefined;
  let reopened: CivilizationStore | undefined;
  const experimentId = input.experimentId ?? `off${input.count}`;
  const runId = input.runId ?? `fixture-${input.count}-${sourceSha.slice(0, 12)}`;
  const repository = input.repository ?? "ManpreetS2/Minecraft-Ai-Civilization-windows-backup";
  if (input.evidenceDirectory) mkdirSync(input.evidenceDirectory, { recursive: true });
  const journalPath = input.evidenceDirectory
    ? join(input.evidenceDirectory, "operator.jsonl")
    : join(dirname(fixture.databasePath), "operator.jsonl");
  const journal = new ExperimentEvidenceJournal(
    journalPath,
    experimentId,
    new Set(fixture.assignments.map((a) => a.citizenId)),
    "offline",
    { decisionTransport: "scripted-in-process", sourceSha, runId },
  );
  let journalClosed = false;
  const actions: Array<{
    sequence: number;
    citizenId: string;
    reportedSuccess: boolean;
    observedSuccess: boolean | null;
    inventoryDelta: Record<string, number> | null;
    authorizedKnowledge: boolean | null;
    decisionTransport: "scripted-in-process";
    originPosition: { x: number; y: number; z: number } | null;
    actionType: "gather";
    expectedDelta: Record<string, number>;
    decisionSource: "scripted" | "model" | "planner" | "reflex";
    inventoryScope: "citizen";
    eventId: string;
    attemptId: string;
    runId: string;
    sourceSha: string;
    receiptId: string;
    sourceEventId: string;
  }> = [];
  const sourceReceipts: ReceiptReference[] = [];
  const persistentFacts: FactEvidence[] = [];

  try {
    await fixture.manager.start(undefined, { deferTicks: true });
    const citizens = fixture.manager.list().map((c) => ({ id: c.record.id, username: c.record.minecraftUsername }));
    for (const c of citizens) {
      const secret = `PRIVATE-${c.id}`;
      const event = createEvent("TaskCompleted", { summary: secret, visibility: { class: "actor_private" } }, c.id);
      fixture.manager.events.emit(event);
      fixture.store.addMemory(
        { id: `memory-${c.id}`, citizenId: c.id, kind: "episodic", content: secret, importance: 1, createdAt: new Date().toISOString() },
        { sourceEventId: event.id },
      );
      persistentFacts.push({
        id: `memory-${c.id}`,
        citizenId: c.id,
        runId,
        sourceSha,
        sourceEventId: event.id,
        receiptId: null,
        authorizedKnowledge: true,
      });
    }
    // Fact receipts are written after scripted provider ticks once model/session identities exist.

    const before = Object.fromEntries([...fixture.bodies].map(([id, body]) => [id, body.count("oak_log")]));
    const completed: CompletedGather[] = [];
    const pending = new Map<string, Omit<CompletedGather, "observation">>();
    fixture.manager.setActionEvidence({
      begin(input) {
        const decisionSource = input.planSource === "llm" ? "scripted" : input.planSource;
        const attemptId = journal.forCitizen(input.citizenId).attempt({
          action: "gather",
          decisionSource,
          decisionEventId: input.eventId,
          ...(input.expectedItem ? { expectedItem: input.expectedItem } : {}),
          ...(input.originPosition ? { originPosition: input.originPosition } : {}),
          ...(input.target ? { target: input.target } : {}),
        });
        pending.set(attemptId, {
          attemptId,
          eventId: input.eventId,
          citizenId: input.citizenId,
          decisionSource,
          expectedDelta: { ...input.expectedDelta },
          originPosition: input.originPosition ?? null,
        });
        return attemptId;
      },
      finish(attemptId, observation) {
        const started = pending.get(attemptId);
        if (!started) throw new Error(`gather observation has no attempt ${attemptId}`);
        pending.delete(attemptId);
        const recorded = journalObservation(observation);
        journal.forCitizen(started.citizenId).observe(attemptId, recorded);
        completed.push({ ...started, observation: recorded });
      },
    });

    for (let step = 0; step < 3; step++) {
      // Offline: no Paper tick — record unavailable provenance with a simulated rehearsal step only.
      journal.recordTick(10, undefined, undefined, { simulatedStep: step });
      await Promise.all(fixture.manager.list().map((c) => fixture.manager["tickCitizen"](c, fixture.store.getSettlement(), [], undefined)));
      const deadline = Date.now() + 20_000;
      while (fixture.manager.pendingOps() > 0) {
        if (Date.now() > deadline) throw new Error("offline scenario pending work did not settle");
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }

    if (pending.size > 0) throw new Error("gather attempts finished without an observation");
    // Link the recorder's actual rows, not action-order-derived sequence numbers.
    const originalRows = readFileSync(journalPath, "utf8").trim().split("\n").map(line => JSON.parse(line) as { kind: string; attemptId?: string; seq: number; decisionEventId?: string; target?: { x: number; y: number; z: number } });
    const original = (kind: string, attemptId: string) => {
      const rows = originalRows.filter(row => row.kind === kind && row.attemptId === attemptId);
      if (rows.length !== 1) throw new Error(`Missing or duplicate original ${kind} for ${attemptId}`);
      return rows[0]!;
    };
    completed.sort((a, b) => original("action_attempt", a.attemptId).seq - original("action_attempt", b.attemptId).seq);
    let sequence = 0;
    for (const record of completed) {
      const attempt = original("action_attempt", record.attemptId);
      const observation = original("action_observation", record.attemptId);
      if (attempt.decisionEventId !== record.eventId) throw new Error("Original action event ID mismatch");
      const assignment = fixture.assignments.find((a) => a.citizenId === record.citizenId)!;
      const evidence = fixture.registry.evidenceLog().filter((e) => e.citizenId === record.citizenId);
      const delta = inventoryChange(record.observation.beforeInventory, record.observation.afterInventory);
      const expectedNames = Object.keys(record.expectedDelta);
      const observedSuccess =
        expectedNames.length === 0 ? null : expectedNames.some((name) => (delta[name] ?? 0) > 0);
      const positionAfter = record.observation.position ?? null;
      const receiptId = `receipt-${record.attemptId}`;
      sequence += 1;
      actions.push({
        sequence,
        citizenId: record.citizenId,
        reportedSuccess: record.observation.successReported,
        observedSuccess,
        inventoryDelta: Object.keys(delta).length > 0 ? delta : null,
        authorizedKnowledge: true,
        decisionTransport: "scripted-in-process",
        originPosition: record.originPosition,
        actionType: "gather",
        expectedDelta: record.expectedDelta,
        decisionSource: record.decisionSource,
        inventoryScope: "citizen",
        eventId: record.eventId,
        attemptId: record.attemptId,
        runId,
        sourceSha,
        receiptId,
        sourceEventId: record.eventId,
      });
      if (input.evidenceDirectory) {
        const model = evidence[0]?.model ?? assignment.model;
        const sessionId = evidence[0]?.sessionId;
        if (!model || !sessionId) {
          throw new Error(`Source receipt requires observed model/session for ${record.citizenId}; refusing synthetic identity`);
        }
        const receipt: SourceReceipt = {
          id: receiptId,
          eventId: record.eventId,
          attemptId: record.attemptId,
          runId,
          sourceSha,
          repository,
          citizenId: record.citizenId,
          family: assignment.family,
          model,
          sessionId,
          actionType: "gather",
          inventoryScope: "citizen",
          observedSuccess: observedSuccess === true,
          journal: { attemptSequence: attempt.seq, observationSequence: observation.seq },
          worldChanges: record.observation.worldChanges,
          ...(record.observation.hungerBefore !== undefined ? { hungerBefore: record.observation.hungerBefore } : {}),
          ...(record.observation.hungerAfter !== undefined ? { hungerAfter: record.observation.hungerAfter } : {}),
          ...(attempt.target ? { targetPosition: attempt.target } : {}),
          inventoryBefore: record.observation.beforeInventory,
          inventoryAfter: record.observation.afterInventory,
          ...(positionAfter ? { positionAfter } : {}),
        };
        const bytes = JSON.stringify(receipt);
        const reference = `receipts/${receiptId}.json`;
        mkdirSync(join(input.evidenceDirectory, "receipts"), { recursive: true });
        writeFileSync(join(input.evidenceDirectory, reference), bytes);
        sourceReceipts.push({
          id: receiptId,
          eventId: record.eventId,
          attemptId: record.attemptId,
          runId,
          sourceSha,
          repository,
          citizenId: record.citizenId,
          reference,
          sha256: createHash("sha256").update(bytes).digest("hex"),
        });
      }
    }

    const after = Object.fromEntries([...fixture.bodies].map(([id, body]) => [id, body.count("oak_log")]));
    const routing = fixture.assignments.map((a) => {
      const calls =
        a.family === "gpt"
          ? fixture.openai.calls.filter((call) => call.apiKey === `synthetic-${a.credential.env}`).map((call) => call.body)
          : (fixture.claude.get(a.citizenId)?.calls ?? []).map((call) => JSON.stringify(call));
      const evidence = fixture.registry.evidenceLog().filter((e) => e.citizenId === a.citizenId);
      return {
        citizenId: a.citizenId,
        family: a.family,
        model: evidence[0]?.model ?? null,
        sessionId: evidence[0]?.sessionId ?? null,
        requests: calls.length,
        ownMemorySeen: calls.some((call) => call.includes(`PRIVATE-${a.citizenId}`)),
        leakedMemoryIds: citizens
          .filter((other) => other.id !== a.citizenId && calls.some((call) => call.includes(`PRIVATE-${other.id}`)))
          .map((other) => other.id),
        accounting: fixture.registry.accounting().citizens[a.citizenId] ?? null,
      };
    });

    if (input.evidenceDirectory) {
      for (const fact of persistentFacts) {
        const provider = routing.find((p) => p.citizenId === fact.citizenId);
        const assignment = fixture.assignments.find((a) => a.citizenId === fact.citizenId);
        if (!provider?.model || !provider.sessionId || !assignment || !fact.sourceEventId) {
          throw new Error(`Fact receipt requires observed model/session for ${fact.citizenId}`);
        }
        const receiptId = `receipt-fact-${fact.id}`;
        const receipt: SourceReceipt = {
          id: receiptId,
          eventId: fact.sourceEventId,
          attemptId: `fact-attempt-${fact.id}`,
          runId,
          sourceSha,
          repository,
          citizenId: fact.citizenId,
          family: assignment.family,
          model: provider.model,
          sessionId: provider.sessionId,
        };
        const bytes = JSON.stringify(receipt);
        const reference = `receipts/${receiptId}.json`;
        mkdirSync(join(input.evidenceDirectory, "receipts"), { recursive: true });
        writeFileSync(join(input.evidenceDirectory, reference), bytes);
        sourceReceipts.push({
          id: receiptId,
          eventId: fact.sourceEventId,
          attemptId: receipt.attemptId,
          runId,
          sourceSha,
          repository,
          citizenId: fact.citizenId,
          reference,
          sha256: createHash("sha256").update(bytes).digest("hex"),
        });
        fact.receiptId = receiptId;
      }
    }

    fixture.manager.setActionEvidence(undefined);
    journal.recordIntervention("operator_stop");
    await fixture.manager.stop();
    await fixture.manager.stop();
    journal.close(true);
    journalClosed = true;
    const evidenceJournalSha256 = createHash("sha256").update(readFileSync(journalPath)).digest("hex");
    const evidenceSummary = journal.operatorSummary();

    reopened = new CivilizationStore(fixture.databasePath);
    restarted = createIndependentOfflineRuntime({ ...fixture.args, store: reopened });
    await restarted.manager.start(undefined, { deferTicks: true });
    const restart = {
      citizens: restarted.manager.list().map((c) => ({ id: c.record.id, username: c.record.minecraftUsername })),
      memoryPreserved: citizens.every((c) => reopened!.getMemories(c.id).some((m) => m.content === `PRIVATE-${c.id}`)),
      storage: "reopened disposable SQLite database; in-memory session store not process-durable",
      sessionDurability: "not_claimed_across_process_restart" as const,
    };

    return {
      sourceSha,
      mode: "offline-fixture" as const,
      decisionTransport: "scripted-in-process" as const,
      citizens,
      providers: routing,
      inventoryBefore: before,
      inventoryAfter: after,
      actions,
      sourceReceipts,
      persistentFacts,
      runId,
      repository,
      restart,
      evidenceJournalPath: input.evidenceDirectory ? journalPath : null,
      evidenceJournalSha256,
      evidenceSummary,
      unproven: [
        "real model decisions",
        "session persistence across process restart",
        "respawn",
        "live Minecraft",
        "Paper serverGameTick",
        "tool durability (fixture does not expose damage counts)",
        "actual API charges",
      ],
    };
  } finally {
    if (!journalClosed) {
      try {
        journal.close(false);
        journalClosed = true;
      } catch {
        /* already closed */
      }
    }
    if (restarted) await restarted.manager.stop();
    fixture.manager.setActionEvidence(undefined);
    await fixture.manager.stop();
    if (fixture.store.isOpen()) fixture.store.close();
    if (reopened?.isOpen()) reopened.close();
    fixture.restoreNavigation();
    fixture.cleanup();
  }
}
