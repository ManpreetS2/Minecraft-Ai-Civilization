import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { buildManifest, validateBundle, type ActionType, type SourceReceipt } from "./manifest.js";
import { bundleFixture } from "./bundle-fixture.js";

describe("Claude e7e08e7 evidence-contract regressions (ordinary assertions)", () => {
  it("flags successful inventory production without a substantiating delta", () => {
    const run = bundleFixture();
    run.actions[0]!.inventoryDelta = {};
    const result = validateBundle(buildManifest(run));
    expect([...result.failures, ...result.unproven].join(" ")).toMatch(/delta|action type/i);
  });
  it("reports missing provider request usage", () => {
    const run = bundleFixture();
    run.providerUsage = { requests: null, costUsd: null, artifact: null };
    expect(validateBundle(buildManifest(run)).unproven.join(" ")).toMatch(/usage/i);
  });
  it("reports missing model identity", () => {
    const run = bundleFixture();
    run.citizens[0]!.model = null;
    expect(validateBundle(buildManifest(run)).unproven.join(" ")).toMatch(/model/i);
  });
  it("rejects an impossible negative inventory from an empty start", () => {
    const run = bundleFixture();
    run.actions[0]!.inventoryDelta = { oak_log: -3 };
    expect(validateBundle(buildManifest(run)).failures.join(" ")).toMatch(/inventory|delta/i);
  });
  it("retains and rejects foreign-run action attribution", () => {
    const run = bundleFixture();
    Object.assign(run.actions[0]!, { runId: "older-run" });
    expect(validateBundle(buildManifest(run)).failures.join(" ")).toMatch(/run/i);
  });
});

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function fixture(
  type: ActionType = "gather",
  before: Record<string, number> = {},
  after: Record<string, number> = { oak_log: 1 },
) {
  const root = mkdtempSync(join(tmpdir(), "v1-receipt-"));
  dirs.push(root);
  const run = bundleFixture();
  run.evidenceContractVersion = 2;
  run.citizens[0]!.model = "gpt-4o-mini";
  run.citizens[1]!.model = "claude-haiku-5-5";
  run.citizens[0]!.initialInventory = before;
  run.providerUsage = {
    requests: 0,
    paidRequests: 0,
    costUsd: 0,
    artifact: null,
    usageComplete: true,
  };
  const delta = Object.fromEntries(
    [...new Set([...Object.keys(before), ...Object.keys(after)])].map((k) => [
      k,
      (after[k] ?? 0) - (before[k] ?? 0),
    ]),
  );
  run.actions[0] = {
    ...run.actions[0]!,
    actionType: type,
    expectedDelta: delta,
    inventoryDelta: delta,
    runId: run.runId,
    sourceSha: run.sourceSha,
    eventId: "event-1",
    attemptId: "attempt-1",
    receiptId: "receipt-1",
  };
  const receipt: SourceReceipt = {
    id: "receipt-1",
    eventId: "event-1",
    attemptId: "attempt-1",
    runId: run.runId,
    sourceSha: run.sourceSha,
    repository: run.repository,
    citizenId: "gpt-a",
    family: "gpt",
    model: "gpt-4o-mini",
    sessionId: "gpt-session",
    actionType: type,
    observedSuccess: true,
    inventoryBefore: before,
    inventoryAfter: after,
    hungerBefore: 10,
    hungerAfter: 14,
    positionAfter: { x: 2, y: 64, z: 0 },
    targetPosition: { x: 2, y: 64, z: 0 },
    authorizedRecipients: ["claude-a"],
    worldChanges: [{ before: "air", after: "oak_planks" }],
  };
  const save = () => {
    const bytes = JSON.stringify(receipt);
    writeFileSync(join(root, "receipt.json"), bytes);
    run.sourceReceipts = [
      {
        id: receipt.id,
        eventId: receipt.eventId,
        attemptId: receipt.attemptId,
        runId: receipt.runId,
        sourceSha: receipt.sourceSha,
        repository: receipt.repository,
        citizenId: receipt.citizenId,
        reference: "receipt.json",
        sha256: createHash("sha256").update(bytes).digest("hex"),
      },
    ];
  };
  save();
  const check = () => validateBundle(buildManifest(run), run.sourceSha, { evidenceRoot: root });
  return { run, root, receipt, save, check };
}
function expectStructurallyComplete(result: ReturnType<typeof validateBundle>) {
  expect(result.failures).toEqual([]);
  expect(result.unproven).toEqual(["Independent evidence validator pending"]);
  expect(result.verdict).toBe("NOT PROVEN"); // Integrity is not external authenticity.
}

describe("action semantics and locally bound source receipts", () => {
  it.each([
    ["gather", {}, { oak_log: 1 }],
    ["eat", { apple: 1 }, {}],
    ["craft", { oak_log: 1 }, { oak_planks: 4 }],
    ["place", { oak_planks: 1 }, {}],
    ["deposit", { bread: 1 }, {}],
    ["withdraw", {}, { bread: 1 }],
  ] as const)("allows legitimate %s effects with exact receipts", (type, before, after) => {
    const f = fixture(type, before, after);
    expectStructurallyComplete(f.check());
  });
  it.each(["move", "speech"] as const)("allows successful %s without inventory delta", (type) => {
    const f = fixture(type, {}, {});
    f.run.actions[0]!.inventoryDelta = null;
    f.run.actions[0]!.expectedDelta = null;
    delete f.receipt.inventoryBefore;
    delete f.receipt.inventoryAfter;
    f.save();
    expectStructurallyComplete(f.check());
  });
  it("allows an explicitly scoped container withdrawal's negative delta", () => {
    const f = fixture("withdraw", { bread: 2 }, { bread: 1 });
    f.run.actions[0]!.inventoryScope = "container";
    f.receipt.inventoryScope = "container";
    f.save();
    expectStructurallyComplete(f.check());
  });
  it("rejects empty typed gather, expected-effect mismatch and forged receipt inventory", () => {
    const f = fixture();
    f.run.actions[0]!.inventoryDelta = {};
    expect(f.check().failures.join(" ")).toMatch(/delta/);
    f.run.actions[0]!.inventoryDelta = { oak_log: 2 };
    f.run.actions[0]!.expectedDelta = { oak_log: 2 };
    expect(f.check().failures.join(" ")).toMatch(/physical receipt/);
  });
  it.each([Number.NaN, Infinity, 0.5])("rejects malformed inventory quantity %s", (n) => {
    const f = fixture();
    f.run.actions[0]!.inventoryDelta = { oak_log: n };
    expect(() => buildManifest(f.run)).toThrow(/inventory delta/);
    expect(validateBundle(f.run, f.run.sourceSha).failures.join(" ")).toMatch(
      /invalid inventory delta/,
    );
  });
  it("keeps unknown legacy negative effects unproven when initial stock is missing", () => {
    const f = fixture();
    f.run.citizens[0]!.initialInventory = null;
    delete f.run.actions[0]!.actionType;
    f.run.actions[0]!.inventoryDelta = { apple: -1 };
    const result = f.check();
    expect(result.unproven.join(" ")).toMatch(/negative inventory delta lacks starting/);
  });
  it("requires receipts even for claimed observed success and flags invented movement inventory", () => {
    const f = fixture("move", {}, {});
    f.run.actions[0]!.inventoryDelta = { diamond: 99 };
    f.run.actions[0]!.expectedDelta = { diamond: 99 };
    delete f.receipt.inventoryBefore;
    delete f.receipt.inventoryAfter;
    f.save();
    expect(f.check().unproven.join(" ")).toMatch(/physical inventory before\/after/);
    delete f.run.actions[0]!.receiptId;
    expect(f.check().unproven.join(" ")).toMatch(/source receipt reference missing/);
  });
  it.each([
    "wrong-sha",
    "short-sha",
    "missing-sha",
    "foreign-run",
    "duplicate-event",
    "duplicate-attempt",
    "citizen",
    "dangling-receipt",
    "receipt-source",
    "tamper",
    "missing-file",
    "missing-root",
    "outside-root",
  ])("fails closed for %s", (kind) => {
    const f = fixture();
    if (kind === "wrong-sha" || kind === "short-sha") {
      expect(validateBundle(f.run, kind === "wrong-sha" ? "b".repeat(40) : "abc").verdict).toBe(
        "FAIL",
      );
      return;
    }
    if (kind === "missing-sha") {
      expect(validateBundle(f.run).unproven.join(" ")).toMatch(/Expected candidate/);
      return;
    }
    if (kind === "foreign-run") f.run.actions[0]!.runId = "foreign";
    if (kind === "duplicate-event" || kind === "duplicate-attempt") {
      f.run.actions.push({
        ...f.run.actions[0]!,
        sequence: 2,
        eventId: kind === "duplicate-event" ? "event-1" : "event-2",
        attemptId: "attempt-1",
      });
      f.run.expectedActionCount = 2;
    }
    if (kind === "citizen") f.run.actions[0]!.citizenId = "claude-a";
    if (kind === "dangling-receipt") f.run.actions[0]!.receiptId = "missing";
    if (kind === "receipt-source") {
      f.receipt.sourceSha = "b".repeat(40);
      f.save();
    }
    if (kind === "tamper") writeFileSync(join(f.root, "receipt.json"), "{}");
    if (kind === "missing-file") f.run.sourceReceipts![0]!.reference = "absent.json";
    if (kind === "missing-root") {
      expect(validateBundle(f.run, f.run.sourceSha).unproven.join(" ")).toMatch(/evidenceRoot/);
      return;
    }
    if (kind === "outside-root") {
      const outside = mkdtempSync(join(tmpdir(), "v1-outside-"));
      dirs.push(outside);
      writeFileSync(join(outside, "external.json"), "{}");
      symlinkSync(join(outside, "external.json"), join(f.root, "external.json"), "file");
      f.run.sourceReceipts![0]!.reference = "external.json";
    }
    const result = f.check();
    if (kind === "missing-file") expect(result.unproven.join(" ")).toMatch(/artifact unavailable/);
    else expect(result.verdict).toBe("FAIL");
  });
  it("preserves valid persistent-fact links and never invents missing source-event IDs", () => {
    const f = fixture();
    f.run.persistentFacts = [
      {
        id: "fact-1",
        citizenId: "gpt-a",
        runId: f.run.runId,
        sourceSha: f.run.sourceSha,
        sourceEventId: "event-1",
        receiptId: "receipt-1",
        authorizedKnowledge: true,
      },
    ];
    expectStructurallyComplete(f.check());
    delete f.run.persistentFacts[0]!.sourceEventId;
    expect(buildManifest(f.run).persistentFacts![0]!.sourceEventId).toBeUndefined();
    expect(f.check().unproven.join(" ")).toMatch(/sourceEventId\/receiptId/);
    f.run.persistentFacts[0]!.sourceEventId = "foreign-event";
    expect(f.check().failures.join(" ")).toMatch(/source-event receipt mismatch/);
  });
  it("keeps restart without runtime fact-provenance export unproven", () => {
    const f = fixture();
    f.run.restarted = true;
    f.run.persistenceArtifact = "restart.json";
    expect(f.check().unproven.join(" ")).toMatch(/persistentFacts\/sourceEventId/);
  });
});

describe("provider identity and usage integrity", () => {
  it("accepts explicit zero synthetic requests without inventing paid usage", () => {
    expectStructurallyComplete(fixture().check());
  });
  it.each([
    "missing-model",
    "unknown-model",
    "family",
    "missing-requests",
    "negative-requests",
    "missing-paid",
    "synthetic-paid",
    "zero-but-nonzero-attribution",
  ])("classifies %s", (kind) => {
    const f = fixture();
    if (kind === "missing-model") f.run.citizens[0]!.model = null;
    if (kind === "unknown-model") {
      f.run.citizens[0]!.model = "unknown-provider-model";
      f.receipt.model = "unknown-provider-model";
      f.save();
    }
    if (kind === "family") f.run.citizens[0]!.model = "claude-haiku-5-5";
    if (kind === "missing-requests") f.run.providerUsage.requests = null;
    if (kind === "negative-requests") f.run.providerUsage.requests = -1;
    if (kind === "missing-paid") delete f.run.providerUsage.paidRequests;
    if (kind === "synthetic-paid") f.run.providerUsage.paidRequests = 1;
    if (kind === "zero-but-nonzero-attribution")
      f.run.providerUsage.perCitizen = [
        {
          citizenId: "gpt-a",
          family: "gpt",
          model: "gpt-4o-mini",
          sessionId: "gpt-session",
          requests: 1,
          retries: 0,
        },
      ];
    const result = f.check();
    if (
      ["family", "negative-requests", "synthetic-paid", "zero-but-nonzero-attribution"].includes(
        kind,
      )
    )
      expect(result.verdict).toBe("FAIL");
    else {
      expect(result.verdict).toBe("NOT PROVEN");
      expect(result.unproven.join(" ")).toMatch(/model|Model|usage/);
    }
  });
  it("binds actual usage files to run, source, citizen/session, counts and cancellation accounting", () => {
    const f = fixture();
    f.run.providerUsage = {
      requests: 1,
      paidRequests: 0,
      costUsd: 0,
      artifact: "usage.json",
      usageComplete: true,
      perCitizen: [
        {
          citizenId: "gpt-a",
          family: "gpt",
          model: "gpt-4o-mini",
          sessionId: "gpt-session",
          requests: 1,
          retries: 0,
        },
      ],
    };
    const bytes = JSON.stringify({
      ...f.run.providerUsage,
      runId: f.run.runId,
      sourceSha: f.run.sourceSha,
      repository: f.run.repository,
    });
    writeFileSync(join(f.root, "usage.json"), bytes);
    f.run.providerUsage.sha256 = createHash("sha256").update(bytes).digest("hex");
    expectStructurallyComplete(f.check());
    f.run.providerUsage.perCitizen![0]!.sessionId = "other-session";
    expect(f.check().failures.join(" ")).toMatch(/attribution/);
    f.run.providerUsage.perCitizen![0]!.retries = 2;
    expect(f.check().failures.join(" ")).toMatch(/retry\/request/);
  });
  it("never accepts incomplete paid usage as an established spending claim", () => {
    const f = fixture();
    f.run.mode = "isolated-live-test";
    f.run.tickSource = "paper";
    for (const c of f.run.citizens) c.authentication = "api";
    f.run.providerUsage = { requests: 2, paidRequests: 2, costUsd: null, artifact: null };
    expect(f.check().unproven.join(" ")).toMatch(/spending claim NOT PROVEN/);
  });
  it("classifies missing request totals as missing evidence even with per-citizen counts", () => {
    const f = fixture();
    f.run.providerUsage.requests = null;
    f.run.providerUsage.perCitizen = [
      {
        citizenId: "gpt-a",
        family: "gpt",
        model: "gpt-4o-mini",
        sessionId: "gpt-session",
        requests: 1,
        retries: 0,
      },
    ];
    expect(f.check().verdict).toBe("NOT PROVEN");
    expect(f.check().unproven.join(" ")).toMatch(/request usage missing/);
  });
  it("rejects malformed paid token quantities without weakening secret filtering", () => {
    const f = fixture();
    f.run.providerUsage.inputTokens = -1;
    expect(f.check().failures.join(" ")).toMatch(/token count/);
    f.run.providerUsage.inputTokens = 0;
    f.run.providerUsage.outputTokens = 0;
    expect(() => buildManifest(f.run)).not.toThrow();
    Object.assign(f.run.providerUsage, { accessToken: "forbidden" });
    expect(() => buildManifest(f.run)).toThrow(/Secret/);
  });
  it("requires a receipt for source-event references and rejects mismatched fact citizens", () => {
    const f = fixture();
    f.run.actions[0]!.sourceEventId = "absent-event";
    expect(f.check().failures.join(" ")).toMatch(/source-event provenance/);
    delete f.run.actions[0]!.sourceEventId;
    f.run.persistentFacts = [
      {
        id: "fact-1",
        citizenId: "claude-a",
        runId: f.run.runId,
        sourceSha: f.run.sourceSha,
        sourceEventId: "event-1",
        receiptId: "receipt-1",
        authorizedKnowledge: true,
      },
    ];
    expect(f.check().failures.join(" ")).toMatch(/source-event receipt mismatch/);
  });
  it("keeps a fabricated external PASS declaration unproven even for a structurally complete bundle", () => {
    const f = fixture();
    f.run.validator = { name: "forged", verdict: "PASS", artifact: "missing.json" };
    const result = f.check();
    expect(result.verdict).toBe("NOT PROVEN");
    expect(result.unproven.join(" ")).toMatch(/not independently verified/);
  });
});
