import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { CivilizationStore, ExperimentEvidenceJournal } from "../../packages/agent-core/src/index.js";
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

function bag(items: Array<{ name: string; count: number }>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items) out[item.name] = (out[item.name] ?? 0) + item.count;
  return out;
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
    const beforeBags = Object.fromEntries([...fixture.bodies].map(([id, body]) => [id, bag(body.items)]));
    const origins = Object.fromEntries(
      [...fixture.bodies].map(([id, body]) => {
        const p = body.bot.entity.position;
        return [id, { x: p.x, y: p.y, z: p.z }];
      }),
    );

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

    let sequence = 0;
    for (const [id, body] of fixture.bodies) {
      const afterBag = bag(body.items);
      const beforeBag = beforeBags[id]!;
      const origin = origins[id]!;
      const woodDelta = (afterBag.oak_log ?? 0) - (beforeBag.oak_log ?? 0);
      const assignment = fixture.assignments.find((a) => a.citizenId === id)!;
      const evidence = fixture.registry.evidenceLog().filter((e) => e.citizenId === id);
      const eventId = `scripted-${id}-gather`;
      const channel = journal.forCitizen(id);
      const attemptId = channel.attempt({
        action: "gather",
        decisionSource: "model",
        decisionEventId: eventId,
        expectedItem: "oak_log",
        originPosition: origin,
      });
      const success = woodDelta > 0;
      const positionAfter = {
        x: body.bot.entity.position.x,
        y: body.bot.entity.position.y,
        z: body.bot.entity.position.z,
      };
      channel.observe(attemptId, {
        successReported: success,
        beforeInventory: beforeBag,
        afterInventory: afterBag,
        position: positionAfter,
        hungerBefore: 20,
        hungerAfter: body.bot.food,
        worldChanges: [],
        failureCode: success ? undefined : "NOT_OBSERVED",
      });
      const receiptId = `receipt-${attemptId}`;
      const expectedDelta = { oak_log: woodDelta };
      sequence += 1;
      actions.push({
        sequence,
        citizenId: id,
        reportedSuccess: success,
        observedSuccess: success,
        inventoryDelta: expectedDelta,
        authorizedKnowledge: true,
        decisionTransport: "scripted-in-process",
        originPosition: origin,
        actionType: "gather",
        expectedDelta,
        inventoryScope: "citizen",
        eventId,
        attemptId,
        runId,
        sourceSha,
        receiptId,
        sourceEventId: eventId,
      });
      if (input.evidenceDirectory) {
        const model = evidence[0]?.model ?? assignment.model;
        const sessionId = evidence[0]?.sessionId;
        if (!model || !sessionId) {
          throw new Error(`Source receipt requires observed model/session for ${id}; refusing synthetic identity`);
        }
        const receipt: SourceReceipt = {
          id: receiptId,
          eventId,
          attemptId,
          runId,
          sourceSha,
          repository,
          citizenId: id,
          family: assignment.family,
          model,
          sessionId,
          actionType: "gather",
          inventoryScope: "citizen",
          observedSuccess: success,
          inventoryBefore: beforeBag,
          inventoryAfter: afterBag,
          positionAfter,
        };
        const bytes = JSON.stringify(receipt);
        const reference = `receipts/${receiptId}.json`;
        mkdirSync(join(input.evidenceDirectory, "receipts"), { recursive: true });
        writeFileSync(join(input.evidenceDirectory, reference), bytes);
        sourceReceipts.push({
          id: receiptId,
          eventId,
          attemptId,
          runId,
          sourceSha,
          repository,
          citizenId: id,
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
    await fixture.manager.stop();
    if (fixture.store.isOpen()) fixture.store.close();
    if (reopened?.isOpen()) reopened.close();
    fixture.restoreNavigation();
    fixture.cleanup();
  }
}
