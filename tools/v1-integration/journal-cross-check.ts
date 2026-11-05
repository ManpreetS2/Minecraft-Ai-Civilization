import { createHash } from "node:crypto";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { validateBundle, type RunBundle, type SourceReceipt } from "./manifest.js";

export interface JournalValidationInput {
  expectedSourceSha: string;
  expectedRepository: string;
  evidenceRoot?: string;
  /** Caller-selected original journal, not a path supplied by a receipt. */
  operatorJournal?: { reference: string; runId: string; sourceSha: string; repository: string };
  manifest: RunBundle;
}
type Row = Record<string, unknown>;
const object = (v: unknown): v is Row => v !== null && typeof v === "object" && !Array.isArray(v);
const same = (a: unknown, b: unknown): boolean => {
  if (object(a) && object(b)) {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
    return keys.every((k) => same(a[k], b[k]));
  }
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((v, i) => same(v, b[i]));
  return a === b;
};
const bag = (v: unknown): v is Record<string, number> =>
  object(v) &&
  Object.entries(v).every(
    ([k, n]) => /^[a-z0-9_:]+$/.test(k) && Number.isSafeInteger(n) && Number(n) >= 0,
  );
const sameBag = (a: Record<string, number>, b: Record<string, number>) =>
  [...new Set([...Object.keys(a), ...Object.keys(b)])].every((k) => (a[k] ?? 0) === (b[k] ?? 0));

/** Cross-artifact consistency only. Neither rehashable journals nor receipts authenticate execution. */
export function validateBundleWithJournal(input: JournalValidationInput) {
  const run = input.manifest;
  const result = validateBundle(run, input.expectedSourceSha, { evidenceRoot: input.evidenceRoot });
  const { failures, unproven } = result;
  const finish = () => ({
    ...result,
    verdict: failures.length ? ("FAIL" as const) : ("NOT PROVEN" as const),
    journalConsistent: failures.length === 0 && journalMissing.length === 0,
    failures,
    unproven,
  });
  const journalMissing: string[] = [];
  const missing = (s: string) => {
    journalMissing.push(s);
    unproven.push(s);
  };
  if (!input.expectedRepository || run.repository !== input.expectedRepository)
    failures.push("Journal validation expected repository mismatch");
  unproven.push(
    "External authenticity NOT PROVEN: all artifacts can be replaced consistently without an independently verified external anchor; journal matching does not authenticate Paper execution",
  );
  const load = (reference: string): Buffer | undefined => {
    if (!input.evidenceRoot) {
      missing("Journal evidence root missing; no artifact read");
      return;
    }
    try {
      const root = realpathSync(input.evidenceRoot),
        path = realpathSync(resolve(root, reference));
      const rel = relative(root, path);
      if (
        !rel ||
        isAbsolute(reference) ||
        isAbsolute(rel) ||
        rel === ".." ||
        rel.startsWith(`..${sep}`)
      ) {
        failures.push("Journal/receipt path escapes explicit evidence root");
        return;
      }
      if (!statSync(path).isFile() || statSync(path).size > 16 * 1024 * 1024) {
        failures.push("Journal/receipt must be a bounded regular file");
        return;
      }
      return readFileSync(path);
    } catch {
      missing("Journal/receipt artifact unavailable");
      return;
    }
  };
  const descriptor = input.operatorJournal;
  if (!descriptor) {
    missing("Original operator journal missing");
    return finish();
  }
  if (
    descriptor.runId !== run.runId ||
    descriptor.sourceSha !== run.sourceSha ||
    descriptor.repository !== run.repository
  )
    failures.push("Original journal run/source/repository attribution mismatch");
  const bytes = load(descriptor.reference);
  if (!bytes) return finish();
  const text = bytes.toString("utf8");
  if (!text.endsWith("\n")) missing("Journal truncated or final newline missing");
  const rows: Row[] = [];
  let previousHash = "";
  for (const line of text.trimEnd().split("\n")) {
    let row: unknown;
    try {
      row = JSON.parse(line);
    } catch {
      missing("Journal truncated or malformed JSON row");
      break;
    }
    if (!object(row)) {
      failures.push("Invalid journal row");
      break;
    }
    if (row.seq !== rows.length + 1) failures.push("Incorrect journal sequence");
    if (row.experimentId !== run.runId) failures.push("Foreign run journal event replay");
    if (row.sourceSha !== undefined && row.sourceSha !== input.expectedSourceSha)
      failures.push("Journal row source mismatch");
    if (row.repository !== undefined && row.repository !== input.expectedRepository)
      failures.push("Journal row repository mismatch");
    const { hash, ...payload } = row;
    const calculated = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
    if (hash !== calculated || row.previousHash !== previousHash)
      failures.push("Journal hash/sequence chain contradiction");
    previousHash = String(hash);
    rows.push(row);
  }
  if (rows[0]?.kind !== "start") missing("Journal start record missing");
  if (rows.at(-1)?.kind !== "shutdown") missing("Journal truncated: shutdown record missing");
  if (
    rows.some(
      (r, i) => (r.kind === "start" && i !== 0) || (r.kind === "shutdown" && i !== rows.length - 1),
    )
  )
    failures.push("Journal contains events outside run start/shutdown boundaries");
  if (rows[0]?.mode !== (run.mode === "offline-fixture" ? "offline" : "live"))
    failures.push("Journal mode mismatch");
  if (rows.some((r) => r.sourceSha === undefined || r.repository === undefined))
    unproven.push(
      "Original journal lacks embedded source/repository attribution; caller descriptor is a binding declaration, not an independent source anchor",
    );
  const attempts = new Map<string, Row>(),
    observations = new Map<string, Row>();
  const ordered: string[] = [];
  for (const row of rows) {
    if (row.kind !== "action_attempt" && row.kind !== "action_observation") continue;
    if (typeof row.attemptId !== "string" || !row.attemptId) {
      failures.push("Journal attempt ID missing");
      continue;
    }
    const map = row.kind === "action_attempt" ? attempts : observations;
    if (map.has(row.attemptId)) failures.push(`Duplicate journal ${row.kind} attempt ID`);
    map.set(row.attemptId, row);
    if (row.kind === "action_attempt") ordered.push(row.attemptId);
    else if (!attempts.has(row.attemptId)) missing("Journal observation has no preceding attempt");
  }
  if (ordered.length !== run.actions.length) missing("Journal/manifest action coverage incomplete");
  for (const action of run.actions) {
    const label = `Journal action ${action.sequence}`;
    const attempt = attempts.get(action.attemptId ?? ""),
      observation = observations.get(action.attemptId ?? "");
    if (!attempt) {
      missing(`${label}: attempt missing`);
      continue;
    }
    if (!observation) {
      missing(`${label}: observation missing`);
      continue;
    }
    if (ordered[action.sequence - 1] !== action.attemptId)
      failures.push(`${label}: incorrect action sequence`);
    if (attempt.citizenId !== action.citizenId || observation.citizenId !== action.citizenId)
      failures.push(`${label}: incorrect citizen`);
    if (attempt.action === undefined) missing(`${label}: journal action type missing`);
    else if (attempt.action !== action.actionType)
      failures.push(`${label}: action type contradiction`);
    if ((observation.seq as number) <= (attempt.seq as number))
      failures.push(`${label}: observation sequence precedes attempt`);
    if (action.eventId !== (observation.eventId ?? observation.hash))
      failures.push(`${label}: event ID contradiction`);
    if (
      typeof observation.successReported !== "boolean" ||
      typeof observation.verified !== "boolean"
    )
      missing(`${label}: journal observed/reported outcome missing`);
    else if (
      observation.successReported !== action.reportedSuccess ||
      (action.observedSuccess != null && observation.verified !== action.observedSuccess)
    )
      failures.push(`${label}: observed/reported outcome contradiction`);
    const ref = run.sourceReceipts?.find((r) => r.id === action.receiptId);
    if (!ref) {
      missing(`${label}: receipt reference missing`);
      continue;
    }
    const receiptBytes = load(ref.reference);
    if (!receiptBytes) continue;
    if (createHash("sha256").update(receiptBytes).digest("hex") !== ref.sha256) {
      failures.push(`${label}: receipt hash contradiction`);
      continue;
    }
    let receipt: SourceReceipt;
    try {
      const value: unknown = JSON.parse(receiptBytes.toString("utf8"));
      if (!object(value)) throw new Error();
      receipt = value as unknown as SourceReceipt;
    } catch {
      failures.push(`${label}: invalid receipt JSON`);
      continue;
    }
    if (!receipt.journal) missing(`${label}: receipt journal row references missing`);
    else if (
      receipt.journal.attemptSequence !== attempt.seq ||
      receipt.journal.observationSequence !== observation.seq
    )
      failures.push(`${label}: receipt journal sequence contradiction`);
    for (const [journalKey, receiptKey] of [
      ["beforeInventory", "inventoryBefore"],
      ["afterInventory", "inventoryAfter"],
      ["position", "positionAfter"],
      ["hungerBefore", "hungerBefore"],
      ["hungerAfter", "hungerAfter"],
      ["authorizedRecipients", "authorizedRecipients"],
      ["worldChanges", "worldChanges"],
    ] as const) {
      const original = observation[journalKey],
        claimed = receipt[receiptKey];
      if (original === undefined && claimed !== undefined)
        missing(`${label}: journal ${journalKey} evidence missing`);
      else if (original !== undefined && claimed === undefined)
        missing(`${label}: receipt ${receiptKey} evidence missing`);
      else if (
        original !== undefined &&
        !(journalKey.includes("Inventory") && bag(original) && bag(claimed)
          ? sameBag(original, claimed)
          : same(original, claimed))
      )
        failures.push(`${label}: journal ${journalKey} contradicts receipt`);
    }
    if (attempt.target !== undefined && !same(attempt.target, receipt.targetPosition)) {
      if (receipt.targetPosition === undefined)
        missing(`${label}: journal target missing in receipt`);
      else failures.push(`${label}: journal target contradictory in receipt`);
    }
    const before = observation.beforeInventory,
      after = observation.afterInventory;
    if (!bag(before) || !bag(after)) {
      missing(`${label}: valid journal before/after inventory missing`);
      continue;
    }
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
    const delta = Object.fromEntries(
      keys.map((key) => [key, (after[key] ?? 0) - (before[key] ?? 0)]),
    );
    if (action.inventoryDelta == null) {
      if (keys.some((k) => delta[k] !== 0) || !["move", "speech"].includes(action.actionType ?? ""))
        missing(`${label}: claimed inventory delta missing`);
    } else if (!sameBag(delta, action.inventoryDelta))
      failures.push(`${label}: journal inventory delta contradicts manifest`);
    if (action.expectedDelta && !sameBag(delta, action.expectedDelta))
      failures.push(`${label}: journal inventory contradicts expected effects`);
  }
  return finish();
}
