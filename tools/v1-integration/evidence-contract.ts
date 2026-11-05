import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import {
  isAllowedClaudeModel,
  isAllowedOpenAiModel,
} from "../../packages/cognition/src/cloud-prices.js";
import type { RunBundle } from "./manifest.js";

export type ActionType =
  "gather" | "eat" | "craft" | "place" | "withdraw" | "deposit" | "move" | "speech";
export interface ReceiptReference {
  id: string;
  eventId: string;
  attemptId: string;
  runId: string;
  sourceSha: string;
  repository: string;
  citizenId: string;
  reference: string;
  sha256: string;
}
export interface FactEvidence {
  id: string;
  citizenId: string;
  runId?: string;
  sourceSha?: string;
  sourceEventId?: string | null;
  receiptId?: string | null;
  authorizedKnowledge?: boolean;
}
export interface CitizenUsage {
  citizenId: string;
  family: "gpt" | "claude";
  model: string | null;
  sessionId: string | null;
  requests: number;
  retries: number;
}
export interface ValidationContext {
  expectedSourceSha?: string;
  evidenceRoot?: string;
}
export interface SourceReceipt extends Omit<ReceiptReference, "reference" | "sha256"> {
  family: "gpt" | "claude";
  model: string;
  sessionId: string;
  actionType?: ActionType;
  inventoryScope?: "citizen" | "container";
  observedSuccess?: boolean;
  inventoryBefore?: Record<string, number>;
  inventoryAfter?: Record<string, number>;
  positionAfter?: { x: number; y: number; z: number };
  targetPosition?: { x: number; y: number; z: number };
  hungerBefore?: number;
  hungerAfter?: number;
  authorizedRecipients?: string[];
  worldChanges?: { before: string; after: string }[];
}
const sha = /^[a-f0-9]{40}$/;
const count = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
const deltaValid = (v: Record<string, number>) =>
  Object.entries(v).every(([k, n]) => /^[a-z0-9_:]+$/.test(k) && Number.isSafeInteger(n));
const sameDelta = (a: Record<string, number>, b: Record<string, number>) =>
  [...new Set([...Object.keys(a), ...Object.keys(b)])].every((k) => (a[k] ?? 0) === (b[k] ?? 0));

/** Missing context never opens a file. Only canonical files below the explicit evidence root are read. */
export function validateContract(run: RunBundle, context: ValidationContext) {
  const failures: string[] = [],
    unproven: string[] = [];
  const fail = (reason: string) => {
    failures.push(reason);
  };
  const missing = (reason: string) => {
    unproven.push(reason);
  };
  if (!run.runId?.trim() || !run.repository?.trim()) fail("Run/repository attribution missing");
  if (run.evidenceContractVersion === undefined)
    missing("Legacy evidence contract: revision 2 attribution/receipts not declared");
  else if (run.evidenceContractVersion !== 2) fail("Unsupported evidence contract revision");
  if (!sha.test(run.sourceSha)) fail("Invalid bundle source SHA");
  if (context.expectedSourceSha === undefined) missing("Expected candidate source SHA missing");
  else if (!sha.test(context.expectedSourceSha) || context.expectedSourceSha !== run.sourceSha)
    fail("Expected candidate source SHA mismatch or invalid full SHA");
  const citizens = new Map(run.citizens.map((c) => [c.id, c]));
  if (citizens.size !== run.citizens.length) fail("Duplicate citizen ID");
  const sessions = run.citizens.map((c) => c.sessionId).filter((s) => s != null);
  if (new Set(sessions).size !== sessions.length) fail("Duplicate citizen session identity");
  for (const c of run.citizens) {
    if (!c.model) missing(`Model identity missing for ${c.id}`);
    else {
      const gpt = isAllowedOpenAiModel(c.model),
        claude = isAllowedClaudeModel(c.model);
      if (!gpt && !claude)
        missing(
          `Unknown model identity for ${c.id}; update the existing provider allowlist intentionally`,
        );
      else if ((c.family === "gpt" && !gpt) || (c.family === "claude" && !claude))
        fail(`Model family mismatch for ${c.id}`);
    }
    if (!c.sessionId) missing(`Session identity missing for ${c.id}`);
    if (c.initialInventory === null) missing(`Initial inventory missing for ${c.id}`);
    else if (Object.values(c.initialInventory).some((n) => !count(n)))
      fail(`Invalid initial inventory for ${c.id}`);
    if (c.authentication === null) missing(`Provider authentication method missing for ${c.id}`);
  }
  const load = (reference: string, digest: string): Record<string, unknown> | undefined => {
    if (!context.evidenceRoot) {
      missing("Source receipt evidenceRoot missing; artifact not read");
      return;
    }
    if (!/^[a-f0-9]{64}$/.test(digest)) {
      fail("Source receipt SHA256 missing or invalid");
      return;
    }
    try {
      const root = realpathSync(context.evidenceRoot),
        path = realpathSync(resolve(root, reference));
      const rel = relative(root, path);
      if (!rel || isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`)) {
        fail("Source receipt path escapes evidenceRoot");
        return;
      }
      const bytes = readFileSync(path);
      if (createHash("sha256").update(bytes).digest("hex") !== digest) {
        fail("Source receipt digest mismatch");
        return;
      }
      const value: unknown = JSON.parse(bytes.toString("utf8"));
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        fail("Invalid source receipt object");
        return;
      }
      return value as Record<string, unknown>;
    } catch (error) {
      if (error instanceof SyntaxError) fail("Invalid source receipt JSON");
      else missing("Source receipt artifact unavailable");
    }
  };
  const refs = new Map<string, ReceiptReference>(),
    events = new Set<string>(),
    receiptAttempts = new Set<string>(),
    receipts = new Map<string, SourceReceipt>();
  for (const ref of run.sourceReceipts ?? []) {
    if (
      !ref.id ||
      !ref.eventId ||
      !ref.attemptId ||
      refs.has(ref.id) ||
      events.has(ref.eventId) ||
      receiptAttempts.has(ref.attemptId)
    )
      fail("Duplicate or missing source receipt/event/attempt ID");
    refs.set(ref.id, ref);
    events.add(ref.eventId);
    receiptAttempts.add(ref.attemptId);
    if (
      ref.runId !== run.runId ||
      ref.sourceSha !== run.sourceSha ||
      ref.repository !== run.repository
    )
      fail("Source receipt run/source/repository mismatch");
    if (!citizens.has(ref.citizenId)) fail("Source receipt citizen mismatch");
    const data = load(ref.reference, ref.sha256);
    if (data) {
      if (
        ["id", "eventId", "attemptId", "runId", "sourceSha", "repository", "citizenId"].some(
          (k) => data[k] !== ref[k as keyof ReceiptReference],
        )
      ) {
        fail("Source receipt attribution mismatch");
        continue;
      }
      const citizen = citizens.get(ref.citizenId);
      if (data.model == null || data.sessionId == null || data.family == null)
        missing("Source receipt model/session/family identity missing");
      if (
        !citizen ||
        (data.family != null && data.family !== citizen.family) ||
        (citizen.model !== null && data.model != null && data.model !== citizen.model) ||
        (citizen.sessionId !== null &&
          data.sessionId != null &&
          data.sessionId !== citizen.sessionId)
      ) {
        fail("Source receipt model/session/citizen attribution mismatch");
        continue;
      }
      receipts.set(ref.id, data as unknown as SourceReceipt);
    }
  }
  const actionEvents = new Set<string>(),
    attempts = new Set<string>();
  const inventory = new Map(
    run.citizens.map((c) => [c.id, c.initialInventory === null ? null : { ...c.initialInventory }]),
  );
  for (const action of run.actions) {
    const label = `Action ${action.sequence}`;
    if (
      typeof action.reportedSuccess !== "boolean" ||
      (action.observedSuccess != null && typeof action.observedSuccess !== "boolean")
    )
      fail(`${label}: invalid success observation`);
    if (
      action.inventoryScope !== undefined &&
      !["citizen", "container"].includes(action.inventoryScope)
    )
      fail(`${label}: invalid inventory scope`);
    if (action.runId === undefined) missing(`${label}: run attribution missing`);
    else if (action.runId !== run.runId) fail(`${label}: foreign run replay`);
    if (action.sourceSha === undefined) missing(`${label}: source SHA missing`);
    else if (!sha.test(action.sourceSha) || action.sourceSha !== run.sourceSha)
      fail(`${label}: source SHA mismatch`);
    for (const [value, seen, kind] of [
      [action.eventId, actionEvents, "event"],
      [action.attemptId, attempts, "attempt"],
    ] as const) {
      if (!value) missing(`${label}: ${kind} ID missing`);
      else if (seen.has(value)) fail(`${label}: duplicate ${kind} ID`);
      else seen.add(value);
    }
    const type = action.actionType;
    if (!type) missing(`${label}: action type missing; inventory delta semantics unproven`);
    else if (
      !["gather", "eat", "craft", "place", "withdraw", "deposit", "move", "speech"].includes(type)
    )
      fail(`${label}: invalid action type`);
    const actual = action.inventoryDelta;
    if (actual && !deltaValid(actual)) fail(`${label}: invalid inventory delta`);
    const expected = action.expectedDelta;
    if (expected && !deltaValid(expected)) fail(`${label}: invalid expected inventory delta`);
    if (type && !["move", "speech"].includes(type) && expected == null)
      missing(`${label}: expected inventory delta missing`);
    if (actual && expected && !sameDelta(actual, expected))
      fail(`${label}: inventory delta contradicts expected effects`);
    if (action.observedSuccess === true && type && actual) {
      const positive = Object.values(actual).some((n) => n > 0),
        negative = Object.values(actual).some((n) => n < 0);
      const container = action.inventoryScope === "container";
      if (
        ((type === "gather" ||
          (type === "withdraw" && !container) ||
          (type === "deposit" && container)) &&
          !positive) ||
        ((type === "eat" ||
          type === "place" ||
          (type === "deposit" && !container) ||
          (type === "withdraw" && container)) &&
          !negative) ||
        (type === "craft" && (!negative || !positive))
      )
        fail(`${label}: inventory delta contradicts successful ${type}`);
    }
    const before = inventory.get(action.citizenId);
    const beforeSnapshot = before ? { ...before } : null;
    if (actual && deltaValid(actual) && action.inventoryScope !== "container") {
      if (before)
        for (const [item, change] of Object.entries(actual)) {
          const next = (before[item] ?? 0) + change;
          if (!count(next))
            fail(`${label}: inventory delta causes impossible negative/invalid stock`);
          before[item] = next;
        }
      else if (Object.values(actual).some((n) => n < 0))
        missing(`${label}: negative inventory delta lacks starting inventory evidence`);
    }
    if (!action.receiptId) missing(`${label}: source receipt reference missing`);
    else if (!refs.has(action.receiptId))
      fail(`${label}: source receipt reference has no matching receipt`);
    const ref = action.receiptId ? refs.get(action.receiptId) : undefined;
    if (
      ref &&
      (ref.citizenId !== action.citizenId ||
        ref.eventId !== action.eventId ||
        ref.attemptId !== action.attemptId)
    )
      fail(`${label}: event/attempt/citizen receipt mismatch`);
    const receipt = action.receiptId ? receipts.get(action.receiptId) : undefined;
    if (receipt) {
      if (receipt.actionType === undefined || receipt.observedSuccess === undefined)
        missing(`${label}: source receipt action type/physical observation missing`);
      if (
        (receipt.observedSuccess !== undefined && typeof receipt.observedSuccess !== "boolean") ||
        (receipt.actionType !== undefined && receipt.actionType !== type) ||
        (receipt.inventoryScope ?? "citizen") !== (action.inventoryScope ?? "citizen") ||
        (action.observedSuccess != null &&
          receipt.observedSuccess !== undefined &&
          receipt.observedSuccess !== action.observedSuccess)
      )
        fail(`${label}: physical receipt contradicts action record`);
      if (type === "move") {
        const a = receipt.positionAfter,
          b = receipt.targetPosition;
        if (!a || !b) missing(`${label}: movement position/target receipt missing`);
        else if (
          ![a.x, a.y, a.z, b.x, b.y, b.z].every(Number.isFinite) ||
          (action.observedSuccess && Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) > 1)
        )
          fail(`${label}: movement receipt contradicts success`);
      } else if (type === "speech") {
        if (!Array.isArray(receipt.authorizedRecipients) || !receipt.authorizedRecipients.length)
          missing(`${label}: authorized speech recipient receipt missing`);
      }
      if (
        (type !== "move" && type !== "speech") ||
        (actual && Object.values(actual).some((n) => n !== 0))
      ) {
        if (!receipt.inventoryBefore || !receipt.inventoryAfter)
          missing(`${label}: physical inventory before/after receipt missing`);
        else {
          const keys = [
            ...new Set([
              ...Object.keys(receipt.inventoryBefore),
              ...Object.keys(receipt.inventoryAfter),
            ]),
          ];
          if (
            keys.some(
              (k) =>
                !count(receipt.inventoryBefore![k] ?? 0) || !count(receipt.inventoryAfter![k] ?? 0),
            )
          )
            fail(`${label}: invalid inventory receipt counts`);
          const delta = Object.fromEntries(
            keys.map((k) => [
              k,
              (receipt.inventoryAfter![k] ?? 0) - (receipt.inventoryBefore![k] ?? 0),
            ]),
          );
          if (actual === null) missing(`${label}: inventory delta missing despite source receipt`);
          else if (!sameDelta(actual, delta))
            fail(`${label}: inventory delta contradicts physical receipt`);
          if (
            action.inventoryScope !== "container" &&
            beforeSnapshot &&
            !sameDelta(beforeSnapshot, receipt.inventoryBefore)
          )
            fail(`${label}: inventory receipt contradicts prior stock`);
        }
      }
      if (
        type === "eat" &&
        (receipt.hungerBefore === undefined || receipt.hungerAfter === undefined)
      )
        missing(`${label}: eating hunger receipt missing`);
      else if (
        type === "eat" &&
        (![receipt.hungerBefore!, receipt.hungerAfter!].every(
          (v) => Number.isFinite(v) && v >= 0 && v <= 20,
        ) ||
          (action.observedSuccess && !(receipt.hungerAfter! > receipt.hungerBefore!)))
      )
        fail(`${label}: eating receipt contradicts hunger recovery`);
      if (type === "place" && !receipt.worldChanges?.some((c) => c.before !== c.after))
        missing(`${label}: placement block-change receipt missing`);
    }
    if (
      action.sourceEventId &&
      !(run.sourceReceipts ?? []).some(
        (r) => r.eventId === action.sourceEventId && r.citizenId === action.citizenId,
      )
    )
      fail(`${label}: source-event provenance has no matching citizen receipt`);
  }
  const usage = run.providerUsage;
  if (usage.requests == null) missing("Provider request usage missing");
  else if (!count(usage.requests)) fail("Invalid provider request usage count");
  if (usage.costUsd !== null && (!Number.isFinite(usage.costUsd) || usage.costUsd < 0))
    fail("Invalid provider usage cost");
  if (usage.costUsd === null) missing("Provider usage cost missing");
  for (const key of ["inputTokens", "outputTokens"] as const)
    if (usage[key] != null && !count(usage[key])) fail("Invalid provider usage token count");
  if (usage.paidRequests == null)
    missing("Paid provider request usage missing (zero must be explicit)");
  else if (
    !count(usage.paidRequests) ||
    (usage.requests != null && usage.paidRequests > usage.requests)
  )
    fail("Invalid paid provider request usage count");
  const synthetic = run.citizens.every((c) => c.authentication === "synthetic");
  if (synthetic && ((usage.paidRequests ?? 0) > 0 || (usage.costUsd ?? 0) > 0))
    fail("Synthetic fixture contradicts paid provider usage claim");
  if (
    !synthetic &&
    (usage.requests ?? 0) > 0 &&
    (usage.usageComplete !== true ||
      usage.costUsd === null ||
      !count(usage.inputTokens) ||
      !count(usage.outputTokens))
  )
    missing("Paid/subscription provider usage incomplete; spending claim NOT PROVEN");
  if ((usage.requests ?? 0) > 0 || usage.perCitizen) {
    if (!usage.perCitizen) missing("Per-citizen provider usage attribution missing");
    else {
      const seen = new Set<string>();
      let total = 0;
      for (const row of usage.perCitizen) {
        const c = citizens.get(row.citizenId);
        if (
          seen.has(row.citizenId) ||
          !c ||
          row.family !== c.family ||
          (c.model !== null && row.model !== c.model) ||
          (c.sessionId !== null && row.sessionId !== c.sessionId)
        )
          fail("Provider usage citizen/model/session attribution mismatch");
        seen.add(row.citizenId);
        if (!count(row.requests) || !count(row.retries) || row.retries > row.requests)
          fail("Invalid provider retry/request accounting");
        total += row.requests;
      }
      if (usage.requests != null && total !== usage.requests)
        fail("Provider usage request totals disagree");
    }
  }
  if ((usage.requests ?? 0) > 0 || !synthetic) {
    if (!usage.artifact || !usage.sha256) missing("Provider usage source receipt missing");
    else {
      const data = load(usage.artifact, usage.sha256);
      if (
        data &&
        (data.runId !== run.runId ||
          data.repository !== run.repository ||
          data.sourceSha !== run.sourceSha ||
          [
            "requests",
            "paidRequests",
            "costUsd",
            "inputTokens",
            "outputTokens",
            "usageComplete",
          ].some(
            (key) =>
              usage[key as keyof typeof usage] != null &&
              data[key] !== usage[key as keyof typeof usage],
          ) ||
          JSON.stringify(data.perCitizen) !== JSON.stringify(usage.perCitizen))
      )
        fail("Provider usage receipt attribution/accounting mismatch");
    }
  }
  if (run.restarted && run.persistentFacts === undefined)
    missing(
      "Persistent fact provenance missing: persistentFacts/sourceEventId not supplied by runtime adapter",
    );
  const facts = new Set<string>();
  for (const fact of run.persistentFacts ?? []) {
    if (!fact.id || facts.has(fact.id)) fail("Duplicate or missing persistent fact ID");
    facts.add(fact.id);
    if (!citizens.has(fact.citizenId)) fail("Persistent fact citizen mismatch");
    if (fact.runId === undefined || fact.sourceSha === undefined)
      missing("Persistent fact run/source attribution missing");
    else if (fact.runId !== run.runId || fact.sourceSha !== run.sourceSha)
      fail("Persistent fact run/source mismatch");
    if (fact.authorizedKnowledge === false) fail("Unauthorized persistent fact knowledge");
    else if (fact.authorizedKnowledge !== true)
      missing("Persistent fact knowledge authorization missing");
    if (!fact.sourceEventId || !fact.receiptId)
      missing(
        "Persistent fact provenance missing: sourceEventId/receiptId required; never inferred",
      );
    else {
      const ref = refs.get(fact.receiptId);
      if (!ref || ref.eventId !== fact.sourceEventId || ref.citizenId !== fact.citizenId)
        fail("Persistent fact source-event receipt mismatch");
      else if (!receipts.has(ref.id)) missing("Persistent fact source-event receipt unavailable");
    }
  }
  return { failures, unproven };
}
