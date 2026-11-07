import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { isAbsolute, join, relative, resolve } from "node:path";

/**
 * Cross-source consistency and authenticity-claim checks for one offline scenario bundle.
 *
 * What this DOES establish: the bundle's artifacts agree with each other field by field, using the fields the recorder actually wrote
 * (original journal rows, manifest actions, receipt files and their SHA-256 pins, validator report, verdict, acceptance), and none of them
 * asserts real Paper authentication, live success or completed acceptance for a scripted offline fixture.
 *
 * What this CANNOT establish: that the bundle came from a real Minecraft run. Every digest here is computed from files the same job just
 * produced, so a forger who coherently regenerates ALL of them (journal, receipts, pins, reports) is indistinguishable offline. An external
 * trust anchor is out of scope and is not claimed.
 */
export interface ConsistencyInput {
  artifactDir: string;
  expectedCount: 2 | 4;
  testedSha: string;
  runId: string;
  manifest: Record<string, unknown>;
  rows: Record<string, unknown>[];
}

export interface CriterionVerdicts {
  passed: number;
  total: number;
  measurement: string;
}
export interface AcceptanceSummary {
  offline: CriterionVerdicts;
  live: CriterionVerdicts;
  notMeasurable: boolean;
  failingCriteria: string[];
  notProvenCriteria: string[];
}
export interface ConsistencyResult {
  /** Structural problems (missing or orphaned artifacts, unreadable files). */
  errors: string[];
  /** Assertions that contradict other recorded evidence, or claim live / authenticated / completed status for a scripted fixture. */
  contradictions: string[];
  acceptance?: AcceptanceSummary;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

/** Canonical JSON with sorted keys, so structurally equal values compare equal. */
function canon(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canon).join(",")}]`;
  if (isObj(v)) return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(",")}}`;
  return JSON.stringify(v) ?? "null";
}
const same = (a: unknown, b: unknown): boolean => canon(a) === canon(b);
const inv = (v: unknown): Record<string, number> => {
  const out: Record<string, number> = {};
  if (isObj(v)) for (const [k, n] of Object.entries(v)) if (typeof n === "number" && n !== 0) out[k] = n;
  return out;
};
const delta = (before: unknown, after: unknown): Record<string, number> => {
  const b = inv(before), a = inv(after), out: Record<string, number> = {};
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) { const d = (a[k] ?? 0) - (b[k] ?? 0); if (d !== 0) out[k] = d; }
  return out;
};
const SUCCESS_CLAIM = /^(pass(ed)?|verified|accepted|complete(d)?|success(ful)?|authenticated|proven|ok)$/i;
const readJson = (p: string): unknown => JSON.parse(readFileSync(p, "utf8"));

export function crossCheckEvidence(input: ConsistencyInput): ConsistencyResult {
  const errors: string[] = [];
  const contradictions: string[] = [];
  const E = (m: string) => errors.push(m);
  const C = (m: string) => contradictions.push(m);
  const { artifactDir, manifest, rows, testedSha, runId, expectedCount } = input;
  const repository = str(manifest.repository);

  const manifestCitizens = arr(manifest.citizens).filter(isObj);
  const citizenById = new Map(manifestCitizens.map((c) => [String(c.id), c]));

  // ---- Journal identity: experiment, run, source, citizens -------------------------------------------------------------------------
  const experimentId = str(isObj(manifest.configuration) ? manifest.configuration.experimentId : undefined);
  if (!experimentId) E("manifest.configuration.experimentId is missing; the original journal cannot be bound to this run");
  const start = rows[0];
  if (start && experimentId) {
    const foreign = rows.filter((r) => r.experimentId !== experimentId);
    if (foreign.length > 0) C(`Journal experiment id disagrees with manifest: ${foreign.length} row(s) are not '${experimentId}' (first: seq ${String(foreign[0]!.seq)} has '${String(foreign[0]!.experimentId)}')`);
  }
  if (start && Array.isArray(start.citizens)) {
    const startIds = new Set(start.citizens.map(String));
    if (startIds.size !== citizenById.size || [...startIds].some((id) => !citizenById.has(id)))
      C(`Journal start-row citizens [${[...startIds].join(", ")}] disagree with manifest citizens [${[...citizenById.keys()].join(", ")}]`);
  }
  for (const r of rows) {
    if ((r.kind === "action_attempt" || r.kind === "action_observation") && !citizenById.has(String(r.citizenId)))
      C(`Journal ${String(r.kind)} seq ${String(r.seq)} belongs to unknown citizen '${String(r.citizenId)}'`);
    if (r.kind === "tick" && (r.tickProvenance !== "unavailable" || (r.serverGameTick !== null && r.serverGameTick !== undefined)))
      C(`Journal tick seq ${String(r.seq)} claims server tick provenance ('${String(r.tickProvenance)}') in a scripted offline run`);
  }

  // ---- Journal <-> manifest actions -------------------------------------------------------------------------------------------------
  const attempts = rows.filter((r) => r.kind === "action_attempt");
  const obsByAttempt = new Map<string, Obj>();
  for (const o of rows.filter((r) => r.kind === "action_observation")) if (!obsByAttempt.has(String(o.attemptId))) obsByAttempt.set(String(o.attemptId), o);
  const attemptById = new Map<string, Obj>();
  for (const a of attempts) if (!attemptById.has(String(a.attemptId))) attemptById.set(String(a.attemptId), a);

  const actions = arr(manifest.actions).filter(isObj);
  const manifestIds = actions.map((a) => String(a.attemptId));
  for (const id of manifestIds) if (!attemptById.has(id)) C(`Manifest action ${id} has no original journal attempt`);
  for (const id of attemptById.keys()) if (!manifestIds.includes(id)) C(`Original journal attempt ${id} is absent from the manifest actions`);
  const journalOrder = attempts.map((a) => String(a.attemptId)).filter((id) => manifestIds.includes(id));
  const manifestOrder = manifestIds.filter((id) => attemptById.has(id));
  if (!same(journalOrder, manifestOrder)) C("Manifest action order disagrees with the original journal attempt order");

  const sourceReceipts = arr(manifest.sourceReceipts).filter(isObj);
  const pins = new Map(sourceReceipts.map((s) => [String(s.id), s]));

  for (const a of actions) {
    const id = String(a.attemptId);
    const att = attemptById.get(id);
    const ob = obsByAttempt.get(id);
    if (!att || !ob) continue;
    const label = `action ${id} (${String(a.citizenId)})`;
    if (a.citizenId !== att.citizenId) C(`Manifest ${label}: citizen '${String(a.citizenId)}' disagrees with original journal attempt citizen '${String(att.citizenId)}'`);
    if (ob.citizenId !== att.citizenId) C(`Journal observation for ${id} belongs to '${String(ob.citizenId)}', its attempt to '${String(att.citizenId)}'`);
    if (a.runId !== undefined && a.runId !== runId) C(`Manifest ${label}: runId '${String(a.runId)}' disagrees with manifest runId '${runId}'`);
    if (a.sourceSha !== undefined && a.sourceSha !== testedSha) C(`Manifest ${label}: sourceSha '${String(a.sourceSha)}' disagrees with manifest sourceSha`);
    if (a.decisionSource !== undefined && a.decisionSource !== att.decisionSource) C(`Manifest ${label}: decisionSource '${String(a.decisionSource)}' disagrees with journal '${String(att.decisionSource)}'`);
    if (att.decisionEventId !== undefined && a.eventId !== att.decisionEventId) C(`Manifest ${label}: eventId '${String(a.eventId)}' disagrees with journal decisionEventId '${String(att.decisionEventId)}'`);
    if (a.actionType !== undefined && a.actionType !== att.action) C(`Manifest ${label}: actionType '${String(a.actionType)}' disagrees with journal action '${String(att.action)}'`);
    if (a.reportedSuccess !== ob.successReported) C(`Manifest ${label}: reportedSuccess ${String(a.reportedSuccess)} disagrees with journal successReported ${String(ob.successReported)}`);
    if (a.observedSuccess !== ob.verified) C(`Manifest ${label}: observedSuccess ${String(a.observedSuccess)} disagrees with journal verified ${String(ob.verified)}`);
    const journalDelta = delta(ob.beforeInventory, ob.afterInventory);
    if (!same(inv(a.inventoryDelta), journalDelta)) C(`Manifest ${label}: inventoryDelta ${canon(a.inventoryDelta)} disagrees with journal before/after delta ${canon(journalDelta)}`);
    if (typeof att.expectedItem === "string" && isObj(a.expectedDelta) && a.expectedDelta[att.expectedItem] !== 1)
      C(`Manifest ${label}: expectedDelta ${canon(a.expectedDelta)} disagrees with journal expectedItem '${att.expectedItem}'`);

    // ---- Receipt: pin, identity and content against the original journal ---------------------------------------------------------
    const receiptId = str(a.receiptId);
    const pin = receiptId ? pins.get(receiptId) : undefined;
    if (!receiptId || !pin) { E(`Manifest ${label} has no sourceReceipts pin for its receipt`); continue; }
    const path = resolve(artifactDir, str(pin.reference) ?? `receipts/${receiptId}.json`);
    const rel = relative(artifactDir, path);
    if (!rel || isAbsolute(rel) || rel.startsWith("..")) { C(`sourceReceipts pin ${receiptId} points outside the evidence root`); continue; }
    if (!existsSync(path)) { E(`Pinned receipt file is missing: ${rel}`); continue; }
    const bytes = readFileSync(path);
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (digest !== pin.sha256) C(`Receipt ${receiptId}: file SHA-256 ${digest} does not match its manifest pin ${String(pin.sha256)}`);
    for (const k of ["attemptId", "citizenId", "runId", "sourceSha", "repository"] as const) {
      const expected = k === "runId" ? runId : k === "sourceSha" ? testedSha : k === "repository" ? repository : a[k];
      if (pin[k] !== undefined && expected !== undefined && pin[k] !== expected) C(`sourceReceipts pin ${receiptId}: ${k} '${String(pin[k])}' disagrees with the manifest`);
    }
    let receipt: Obj;
    try { const parsed = JSON.parse(bytes.toString("utf8")) as unknown; if (!isObj(parsed)) throw new Error("not an object"); receipt = parsed; }
    catch (e) { E(`Receipt ${receiptId} is not valid JSON: ${String(e)}`); continue; }
    const R = `Receipt ${receiptId}`;
    if (receipt.id !== receiptId) C(`${R}: id '${String(receipt.id)}' disagrees with its reference`);
    if (receipt.runId !== undefined && receipt.runId !== runId) C(`${R}: runId '${String(receipt.runId)}' disagrees with the manifest`);
    if (receipt.sourceSha !== testedSha) C(`${R}: sourceSha '${String(receipt.sourceSha)}' disagrees with the manifest sourceSha`);
    if (repository !== undefined && receipt.repository !== undefined && receipt.repository !== repository) C(`${R}: repository '${String(receipt.repository)}' disagrees with the manifest`);
    if (a.eventId !== undefined && receipt.eventId !== undefined && receipt.eventId !== a.eventId) C(`${R}: eventId disagrees with the manifest action`);
    const citizen = citizenById.get(String(a.citizenId));
    if (citizen) for (const k of ["family", "model", "sessionId"] as const) if (receipt[k] !== undefined && receipt[k] !== citizen[k]) C(`${R}: ${k} '${String(receipt[k])}' disagrees with manifest citizen '${String(a.citizenId)}'`);
    if (receipt.actionType !== undefined && receipt.actionType !== att.action) C(`${R}: actionType disagrees with the original journal action`);
    if (receipt.observedSuccess !== undefined && receipt.observedSuccess !== ob.verified) C(`${R}: observedSuccess disagrees with the original journal observation`);
    if (!isObj(receipt.journal)) E(`${R} lacks the original journal coordinates (journal.attemptSequence / observationSequence)`);
    else if (receipt.journal.attemptSequence !== att.seq || receipt.journal.observationSequence !== ob.seq)
      C(`${R}: journal coordinates ${canon(receipt.journal)} disagree with original rows attempt seq ${String(att.seq)} / observation seq ${String(ob.seq)}`);
    if (!same(inv(receipt.inventoryBefore), inv(ob.beforeInventory))) C(`${R}: inventoryBefore ${canon(receipt.inventoryBefore)} disagrees with the original journal observation`);
    if (!same(inv(receipt.inventoryAfter), inv(ob.afterInventory))) C(`${R}: inventoryAfter ${canon(receipt.inventoryAfter)} disagrees with the original journal observation`);
    if (receipt.worldChanges !== undefined || ob.worldChanges !== undefined) if (!same(receipt.worldChanges ?? [], ob.worldChanges ?? [])) C(`${R}: worldChanges disagree with the original journal observation`);
    for (const [rk, jk, src] of [["hungerBefore", "hungerBefore", ob], ["hungerAfter", "hungerAfter", ob], ["targetPosition", "target", att], ["positionAfter", "position", ob]] as const)
      if (receipt[rk] !== undefined || src[jk] !== undefined) if (!same(receipt[rk], src[jk])) C(`${R}: ${rk} disagrees with the original journal`);
  }

  // ---- Every pin (including persistent-fact receipts) must resolve to its pinned bytes; no orphans ------------------------------------
  const referenced = new Set(actions.map((a) => String(a.receiptId)));
  const factReceipts = new Set(arr(manifest.persistentFacts).filter(isObj).map((f) => String(f.receiptId)));
  for (const pin of sourceReceipts) {
    const id = String(pin.id);
    if (!referenced.has(id) && !factReceipts.has(id)) E(`Orphan sourceReceipts pin ${id}: no manifest action or persistent fact references it`);
    if (referenced.has(id)) continue; // already pinned-and-hashed above
    const path = resolve(artifactDir, str(pin.reference) ?? `receipts/${id}.json`);
    const rel = relative(artifactDir, path);
    if (!rel || isAbsolute(rel) || rel.startsWith("..")) { C(`sourceReceipts pin ${id} points outside the evidence root`); continue; }
    if (!existsSync(path)) { E(`Pinned receipt file is missing: ${rel}`); continue; }
    const digest = createHash("sha256").update(readFileSync(path)).digest("hex");
    if (digest !== pin.sha256) C(`Receipt ${id}: file SHA-256 ${digest} does not match its manifest pin ${String(pin.sha256)}`);
  }
  for (const f of factReceipts) if (!pins.has(f)) E(`Persistent fact references receipt ${f} with no sourceReceipts pin`);

  // ---- Inventory continuity across a citizen's original observations ---------------------------------------------------------------
  const finalInventory = new Map<string, Record<string, number>>();
  for (const [citizenId, citizen] of citizenById) {
    let prior = inv(citizen.initialInventory);
    for (const o of rows.filter((r) => r.kind === "action_observation" && r.citizenId === citizenId)) {
      if (!same(inv(o.beforeInventory), prior)) C(`Inventory continuity broken for ${citizenId} at observation seq ${String(o.seq)}: before ${canon(inv(o.beforeInventory))} != previous after ${canon(prior)}`);
      prior = inv(o.afterInventory);
    }
    finalInventory.set(citizenId, prior);
  }

  // ---- Validator report, verdict, acceptance: agreement and authenticity claims ---------------------------------------------------
  const read = (name: string): Obj | undefined => { try { const v = readJson(join(artifactDir, name)); return isObj(v) ? v : undefined; } catch { return undefined; } };
  const report = read("gemini-validator-report.json");
  if (report) {
    if (report.mode !== undefined && report.mode !== "offline_simulated") C(`Validator report mode is '${String(report.mode)}', must be 'offline_simulated' for a scripted fixture`);
    const env = str(report.environment);
    if (env !== undefined && (!/offline/i.test(env) || !/simulat|fixture/i.test(env) || /authenticated paper|microsoft|online[- ]mode|live paper server/i.test(env)))
      C(`Validator report environment '${env}' presents a scripted fixture as other than an offline simulation`);
    if (report.mode === undefined && env === undefined) E("Validator report declares neither mode nor environment");
    const att = isObj(report.sourceAttestationAudit) ? report.sourceAttestationAudit : undefined;
    if (att && att.proven === true) C("Validator report claims a proven source attestation (Paper authenticity) for a scripted fixture");
    const dur = isObj(report.durationAudit) ? report.durationAudit : undefined;
    if (dur && (dur.serverTickProven === true || (isObj(dur.sourceAttestationAudit) && dur.sourceAttestationAudit.proven === true))) C("Validator report claims proven server ticks / source attestation for a scripted fixture");
    const codes = arr(report.notProven).filter(isObj).map((n) => String(n.code));
    if (!codes.includes("UNPROVEN_PAPER_AUTHENTICITY")) C("Validator report omits UNPROVEN_PAPER_AUTHENTICITY; absence of the gap code is not evidence of authenticity");
    if (arr(report.violations).length > 0) E(`Validator report lists ${arr(report.violations).length} violation(s)`);
    const attribution = isObj(report.attribution) ? report.attribution : undefined;
    if (attribution) {
      if (attribution.runId !== undefined && attribution.runId !== runId) C(`Validator attribution runId '${String(attribution.runId)}' disagrees with the manifest`);
      if (Array.isArray(attribution.citizens) && (attribution.citizens.length !== citizenById.size || attribution.citizens.some((c) => !citizenById.has(String(c))))) C("Validator attribution citizens disagree with the manifest");
    }
    if (report.experimentId !== undefined && report.experimentId !== runId && report.experimentId !== experimentId) C(`Validator experimentId '${String(report.experimentId)}' disagrees with the manifest run`);
    const verifications = arr(report.actionVerifications).filter(isObj);
    if (verifications.length > 0) {
      const ids = verifications.map((v) => String(v.attemptId));
      if (!same([...ids].sort(), [...attemptById.keys()].sort())) C("Validator actionVerifications attempt ids disagree with the original journal attempts");
      for (const v of verifications) { const jat = attemptById.get(String(v.attemptId)); if (jat && v.citizenId !== jat.citizenId) C(`Validator actionVerification ${String(v.attemptId)} credits '${String(v.citizenId)}' but the journal attempt belongs to '${String(jat.citizenId)}'`); }
    }
    const inventoryAudit = isObj(report.inventoryAudit) ? report.inventoryAudit : undefined;
    if (inventoryAudit && isObj(inventoryAudit.citizenFinalInventories))
      for (const [cid, fin] of Object.entries(inventoryAudit.citizenFinalInventories)) if (finalInventory.has(cid) && !same(inv(fin), finalInventory.get(cid))) C(`Validator final inventory for ${cid} disagrees with the original journal`);
  }

  const verdict = read("verdict.json");
  if (verdict) {
    if (arr(verdict.failures).length > 0) E(`verdict.json lists ${arr(verdict.failures).length} failure(s)`);
    if (arr(verdict.unproven).length === 0) C("verdict.json lists nothing as unproven; a scripted offline run always has unproven items");
    if (verdict.journalConsistent !== undefined && verdict.journalConsistent !== true) C("verdict.json records the original journal as inconsistent");
    for (const [k, v] of Object.entries(verdict)) if (/authenticat|live|paper/i.test(k) && v === true) C(`verdict.json asserts '${k}': true for a scripted fixture`);
  }

  if (isObj(manifest.validator) && manifest.validator.verdict !== undefined && manifest.validator.verdict !== "NOT PROVEN")
    C(`Manifest validator verdict is '${String(manifest.validator.verdict)}', must stay 'NOT PROVEN'`);
  if (isObj(manifest.providerUsage)) {
    const u = manifest.providerUsage;
    if ((typeof u.paidRequests === "number" && u.paidRequests !== 0) || (typeof u.costUsd === "number" && u.costUsd !== 0)) C("Manifest providerUsage records paid inference in an offline fixture");
  }

  // ---- acceptance.json: never a live success or a completed acceptance for synthetic evidence ----------------------------------
  const acceptance = read("acceptance.json");
  let summary: AcceptanceSummary | undefined;
  if (!acceptance) E("acceptance.json is missing or not a JSON object");
  else {
    if (acceptance.candidateSha !== testedSha) C(`acceptance.json candidateSha '${String(acceptance.candidateSha)}' disagrees with the manifest sourceSha`);
    if (repository !== undefined && acceptance.repository !== undefined && acceptance.repository !== repository) C(`acceptance.json repository '${String(acceptance.repository)}' disagrees with the manifest`);
    const tally = (v: unknown, name: string): CriterionVerdicts => {
      if (!isObj(v) || typeof v.passed !== "number" || typeof v.total !== "number") { E(`acceptance.json '${name}' has no numeric passed/total`); return { passed: 0, total: 0, measurement: "UNKNOWN" }; }
      return { passed: v.passed, total: v.total, measurement: String(v.measurement ?? "UNKNOWN") };
    };
    const offline = tally(acceptance.offline, "offline");
    const live = tally(acceptance.live, "live");
    const results = arr(acceptance.results).filter(isObj);
    const verdictOf = (r: Obj, side: "offline" | "live") => (isObj(r[side]) ? String((r[side] as Obj).verdict ?? "") : "");
    const idOf = (r: Obj) => String(isObj(r.criterion) ? r.criterion.id : "?");
    if (live.passed !== 0 || live.measurement !== "NOT MEASURABLE" || (isObj(acceptance.live) && acceptance.live.percentage != null)) C(`acceptance.json claims live acceptance (${live.passed}/${live.total}, measurement '${live.measurement}') from a scripted offline fixture`);
    const liveWins = results.filter((r) => SUCCESS_CLAIM.test(verdictOf(r, "live")));
    if (liveWins.length > 0) C(`acceptance.json marks live criteria ${liveWins.map(idOf).join(", ")} as '${verdictOf(liveWins[0]!, "live")}' for a scripted offline fixture`);
    const offlineWins = results.filter((r) => SUCCESS_CLAIM.test(verdictOf(r, "offline"))).length;
    if (offline.passed !== offlineWins) C(`acceptance.json offline tally ${offline.passed}/${offline.total} disagrees with its own per-criterion verdicts (${offlineWins} passing)`);
    if (offline.passed > offline.total || live.passed > live.total) C("acceptance.json tally is impossible (passed exceeds total)");
    for (const m of arr(acceptance.milestones).filter(isObj)) if (m.accepted === true) C(`acceptance.json marks milestone '${String(m.gate)}' accepted for a scripted offline fixture`);
    if (isObj(acceptance.milestoneCount) && acceptance.milestoneCount.passed !== 0) C(`acceptance.json counts ${String(acceptance.milestoneCount.passed)} accepted milestone(s) for a scripted offline fixture`);
    for (const [k, v] of Object.entries(acceptance)) if (/^(outcome|status|verdict|accepted|passed|result)$/i.test(k) && (v === true || (typeof v === "string" && SUCCESS_CLAIM.test(v)))) C(`acceptance.json asserts ${k}='${String(v)}' for a scripted offline fixture`);
    summary = {
      offline, live,
      notMeasurable: offline.measurement === "NOT MEASURABLE" && live.measurement === "NOT MEASURABLE",
      failingCriteria: [...new Set(results.filter((r) => verdictOf(r, "offline") === "FAIL" || verdictOf(r, "live") === "FAIL").map(idOf))],
      notProvenCriteria: [...new Set(results.filter((r) => verdictOf(r, "offline") === "NOT PROVEN" || verdictOf(r, "live") === "NOT PROVEN").map(idOf))],
    };
  }

  void expectedCount;
  return { errors, contradictions, acceptance: summary };
}
