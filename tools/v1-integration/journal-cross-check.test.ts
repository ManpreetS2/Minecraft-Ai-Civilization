import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { ExperimentEvidenceJournal } from "../../packages/agent-core/src/experiment-evidence.js";
import { bundleFixture } from "./bundle-fixture.js";
import { type SourceReceipt } from "./manifest.js";
import { checkJournal } from "./journal-cli.js";
import { validateBundleWithJournal } from "./journal-cross-check.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function fixture(type: "gather" | "eat" | "move" = "gather", count = 1) {
  const root = mkdtempSync(join(tmpdir(), "journal-cross-check-"));
  roots.push(root);
  const run = bundleFixture();
  run.evidenceContractVersion = 2;
  run.citizens[0]!.model = "gpt-4o-mini";
  run.citizens[1]!.model = "claude-haiku-5-5";
  run.providerUsage = { requests: 0, paidRequests: 0, costUsd: 0, artifact: null };
  const journal = new ExperimentEvidenceJournal(
    join(root, "operator.jsonl"),
    run.runId,
    new Set(["gpt-a"]),
    "offline",
    { sourceSha: run.sourceSha, runId: run.runId },
  );
  const actor = journal.forCitizen("gpt-a");
  run.citizens[0]!.initialInventory = type === "eat" ? { apple: count } : {};
  for (let i = 0; i < count; i++) {
    const attemptId = actor.attempt({
      action: type,
      expectedItem: type === "eat" ? "apple" : "oak_log",
      decisionSource: "model",
      decisionEventId: `decision-${i}`,
      ...(type === "move" ? { target: { x: 2, y: 64, z: 0 } } : {}),
    });
    actor.observe(attemptId, {
      successReported: true,
      beforeInventory:
        type === "eat" ? { apple: count - i } : type === "move" ? {} : { oak_log: i * 3 },
      afterInventory:
        type === "eat" ? { apple: count - i - 1 } : type === "move" ? {} : { oak_log: (i + 1) * 3 },
      ...(type === "eat" ? { hungerBefore: 10, hungerAfter: 14 } : {}),
      ...(type === "move" ? { position: { x: 2, y: 64, z: 0 } } : {}),
      worldChanges: [],
    });
  }
  journal.close(false);
  const rows = readFileSync(join(root, "operator.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const receipts: SourceReceipt[] = [];
  run.actions = [];
  run.expectedActionCount = count;
  for (let i = 0; i < count; i++) {
    const attempt = rows[1 + i * 2],
      observation = rows[2 + i * 2];
    const receipt: SourceReceipt = {
      id: `receipt-${i}`,
      eventId: observation.hash,
      attemptId: attempt.attemptId,
      runId: run.runId,
      sourceSha: run.sourceSha,
      repository: run.repository,
      citizenId: "gpt-a",
      family: "gpt",
      model: "gpt-4o-mini",
      sessionId: "gpt-session",
      actionType: type,
      observedSuccess: true,
      inventoryBefore: observation.beforeInventory,
      inventoryAfter: observation.afterInventory,
      worldChanges: [],
      hungerBefore: observation.hungerBefore,
      hungerAfter: observation.hungerAfter,
      positionAfter: observation.position,
      targetPosition: attempt.target,
      journal: { attemptSequence: attempt.seq, observationSequence: observation.seq },
    };
    receipts.push(receipt);
    const delta: Record<string, number> =
      type === "eat" ? { apple: -1 } : type === "move" ? {} : { oak_log: 3 };
    run.actions.push({
      sequence: i + 1,
      citizenId: "gpt-a",
      reportedSuccess: true,
      observedSuccess: true,
      authorizedKnowledge: true,
      actionType: type,
      expectedDelta: delta,
      inventoryDelta: delta,
      eventId: receipt.eventId,
      attemptId: receipt.attemptId,
      receiptId: receipt.id,
      runId: run.runId,
      sourceSha: run.sourceSha,
    });
  }
  const save = () => {
    run.sourceReceipts = receipts.map((receipt, i) => {
      const bytes = JSON.stringify(receipt);
      writeFileSync(join(root, `receipt-${i}.json`), bytes);
      return {
        id: receipt.id,
        eventId: receipt.eventId,
        attemptId: receipt.attemptId,
        runId: run.runId,
        sourceSha: run.sourceSha,
        repository: run.repository,
        citizenId: "gpt-a",
        reference: `receipt-${i}.json`,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      };
    });
  };
  save();
  const input = {
    expectedSourceSha: run.sourceSha,
    expectedRepository: run.repository,
    evidenceRoot: root,
    operatorJournal: {
      reference: "operator.jsonl",
      runId: run.runId,
      sourceSha: run.sourceSha,
      repository: run.repository,
    },
    manifest: run,
  };
  const rewrite = (edit: (rows: Record<string, unknown>[]) => Record<string, unknown>[]) => {
    const changed = edit(rows.map((row) => ({ ...row })));
    let previousHash = "";
    const lines = changed.map((row, i) => {
      const { hash: _hash, ...payload } = row;
      void _hash;
      payload.seq = i + 1;
      payload.previousHash = previousHash;
      const hash = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
      previousHash = hash;
      return JSON.stringify({ ...payload, hash });
    });
    writeFileSync(join(root, "operator.jsonl"), lines.join("\n") + "\n");
  };
  return {
    root,
    run,
    receipt: receipts[0]!,
    receipts,
    save,
    input,
    rewrite,
    check: () => validateBundleWithJournal(input),
  };
}
it("rejects a rehashed receipt and manifest claiming 30 logs against the unchanged three-log journal", () => {
  const f = fixture();
  f.receipt.inventoryAfter = { oak_log: 30 };
  f.run.actions[0]!.inventoryDelta = { oak_log: 30 };
  f.run.actions[0]!.expectedDelta = { oak_log: 30 };
  f.save();
  const result = f.check();
  expect(result.failures.join(" ")).toMatch(/journal.*inventory/i);
});
it.each(["gather", "eat", "move"] as const)("compares legitimate %s physical effects", (type) => {
  const f = fixture(type);
  const result = f.check();
  expect(result.failures).toEqual([]);
  expect(result.journalConsistent).toBe(true);
  expect(result.verdict).toBe("NOT PROVEN");
  expect(result.unproven.join(" ")).toMatch(/external anchor/);
});
it("matches three independent gathers", () => {
  const result = fixture("gather", 3).check();
  expect(result.failures).toEqual([]);
  expect(result.journalConsistent).toBe(true);
});
it("reports missing journal", () => {
  const f = fixture();
  expect(
    validateBundleWithJournal({ ...f.input, operatorJournal: undefined }).unproven.join(" "),
  ).toMatch(/journal missing/i);
});
it("reports unavailable journal", () => {
  const f = fixture();
  f.input.operatorJournal.reference = "missing.jsonl";
  expect(f.check().verdict).toBe("NOT PROVEN");
  expect(f.check().journalConsistent).toBe(false);
});
it("refuses to read without an explicit evidence root", () => {
  const f = fixture();
  expect(
    validateBundleWithJournal({ ...f.input, evidenceRoot: undefined }).unproven.join(" "),
  ).toMatch(/root missing/);
});
it.each(["action_attempt", "action_observation"])("reports missing %s as unproven", (kind) => {
  const f = fixture();
  f.rewrite((rows) => rows.filter((r) => r.kind !== kind));
  const result = f.check();
  expect(result.unproven.join(" ")).toMatch(/attempt missing|observation missing/);
  expect(result.journalConsistent).toBe(false);
});
it("rejects duplicate attempt IDs", () => {
  const f = fixture();
  f.rewrite((rows) => [rows[0]!, rows[1]!, rows[1]!, ...rows.slice(2)]);
  expect(f.check().failures.join(" ")).toMatch(/Duplicate journal/);
});
it("rejects incorrect citizen", () => {
  const f = fixture();
  f.rewrite((rows) =>
    rows.map((r) => (r.kind === "action_attempt" ? { ...r, citizenId: "claude-a" } : r)),
  );
  expect(f.check().failures.join(" ")).toMatch(/incorrect citizen/);
});
it("rejects incorrect receipt row sequence", () => {
  const f = fixture();
  f.receipt.journal!.observationSequence = 99;
  f.save();
  expect(f.check().failures.join(" ")).toMatch(/sequence contradiction/);
});
it("rejects replay from another run", () => {
  const f = fixture();
  f.rewrite((rows) => rows.map((r) => ({ ...r, experimentId: "foreign-run" })));
  expect(f.check().failures.join(" ")).toMatch(/Foreign run/);
});
it("reports a truncated journal without synthesizing shutdown", () => {
  const f = fixture();
  f.rewrite((rows) => rows.slice(0, -1));
  expect(f.check().unproven.join(" ")).toMatch(/truncated/);
});
it("keeps older receipts readable but unproven without row references", () => {
  const f = fixture();
  delete f.receipt.journal;
  f.save();
  expect(f.check().failures).toEqual([]);
  expect(f.check().journalConsistent).toBe(false);
});
it("rejects wrong full source SHA and repository", () => {
  const f = fixture();
  f.input.expectedSourceSha = "b".repeat(40);
  f.input.expectedRepository = "wrong/repository";
  expect(f.check().failures.join(" ")).toMatch(/source SHA/);
  expect(f.check().failures.join(" ")).toMatch(/repository mismatch/);
});
it("cannot authenticate a coordinated replacement of all artifacts", () => {
  const f = fixture();
  f.rewrite((rows) =>
    rows.map((r) =>
      r.kind === "action_observation" ? { ...r, afterInventory: { oak_log: 30 } } : r,
    ),
  );
  const row = JSON.parse(readFileSync(join(f.root, "operator.jsonl"), "utf8").split("\n")[2]!);
  f.receipt.eventId = row.hash;
  f.receipt.inventoryAfter = { oak_log: 30 };
  Object.assign(f.run.actions[0]!, {
    eventId: row.hash,
    inventoryDelta: { oak_log: 30 },
    expectedDelta: { oak_log: 30 },
  });
  f.save();
  const result = f.check();
  expect(result.failures).toEqual([]);
  expect(result.journalConsistent).toBe(true);
  expect(result.verdict).toBe("NOT PROVEN");
  expect(result.unproven.join(" ")).toMatch(/all artifacts can be replaced/);
});

it("rejects a journal path escaping the explicit root", () => {
  const f = fixture();
  f.input.operatorJournal.reference = "../";
  expect(f.check().failures.join(" ")).toMatch(/escapes explicit/);
});
it("rejects a modified receipt without a matching digest", () => {
  const f = fixture();
  writeFileSync(
    join(f.root, "receipt-0.json"),
    JSON.stringify({ ...f.receipt, inventoryAfter: { oak_log: 30 } }),
  );
  expect(f.check().failures.join(" ")).toMatch(/digest mismatch|hash contradiction/);
});
it("rejects broken journal sequence and hash chain", () => {
  const f = fixture();
  const path = join(f.root, "operator.jsonl");
  writeFileSync(path, readFileSync(path, "utf8").replace('"seq":2', '"seq":99'));
  expect(f.check().failures.join(" ")).toMatch(/Incorrect journal sequence/);
});
it("rejects reordered claimed actions", () => {
  const f = fixture("gather", 3);
  f.run.actions.reverse();
  f.run.actions.forEach((action, i) => {
    action.sequence = i + 1;
  });
  expect(f.check().failures.join(" ")).toMatch(/incorrect action sequence/);
});
it("reports partial final JSON as unproven", () => {
  const f = fixture();
  const path = join(f.root, "operator.jsonl");
  writeFileSync(path, readFileSync(path, "utf8").slice(0, -10));
  expect(f.check().unproven.join(" ")).toMatch(/truncated/);
});
it("rejects failed journal actions claimed as successful", () => {
  const f = fixture();
  f.rewrite((rows) =>
    rows.map((r) =>
      r.kind === "action_observation" ? { ...r, verified: false, successReported: false } : r,
    ),
  );
  expect(f.check().failures.join(" ")).toMatch(/outcome contradiction/);
});
it("rejects altered movement positions even with unchanged inventory", () => {
  const f = fixture("move");
  f.receipt.positionAfter = { x: 2.1, y: 64, z: 0 };
  f.save();
  expect(f.check().failures.join(" ")).toMatch(/journal position contradicts receipt/);
});
it("reports absent journal physical state instead of synthesizing it", () => {
  const f = fixture();
  f.rewrite((rows) =>
    rows.map((r) => {
      if (r.kind !== "action_observation") return r;
      const copy = { ...r };
      delete copy.beforeInventory;
      return copy;
    }),
  );
  expect(f.check().unproven.join(" ")).toMatch(/beforeInventory evidence missing/);
});

it("CLI preserves local-only outcomes and missing evidence exit codes", () => {
  const { input } = fixture();
  const path = join(input.evidenceRoot!, "manifest.json");
  writeFileSync(path, JSON.stringify(input.manifest));
  const args = [
    path,
    input.expectedSourceSha,
    input.expectedRepository,
    input.evidenceRoot!,
    "operator.jsonl",
  ];
  const result = checkJournal(args);
  expect(result.status).toBe("JOURNAL CONSISTENT");
  expect(result.exitCode).toBe(0);
  expect(result.verdict).toBe("NOT PROVEN");
  expect(result.authenticatedLiveExecution).toBe(false);
  expect(checkJournal(args.slice(0, 4)).exitCode).toBe(2);
  expect(checkJournal(args.slice(0, 3)).exitCode).toBe(2);
  expect(checkJournal([path, "f".repeat(40), ...args.slice(2)]).exitCode).toBe(1);
});
