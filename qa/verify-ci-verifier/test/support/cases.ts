import { createHash } from "node:crypto";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readJson, readRows, receiptPath, writeJson, writeRowsRehashed, type Count, type Row } from "./bundle.js";

const OTHER = "0123456789abcdef0123456789abcdef01234567";
const sha256File = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");
const attempt = (rows: Row[], citizen: string, n = 0) => rows.filter((r) => r.kind === "action_attempt" && r.citizenId === citizen)[n]!;
const observation = (rows: Row[], attemptId: unknown) => rows.find((r) => r.kind === "action_observation" && r.attemptId === attemptId)!;
const editReceipt = (d: string, receiptId: string, edit: (r: Record<string, any>) => void) => {
  const p = receiptPath(d, receiptId); const r = JSON.parse(readFileSync(p, "utf8")) as Record<string, any>; edit(r); writeFileSync(p, JSON.stringify(r, null, 2)); return p;
};

/**
 * Expectations were MEASURED against the real bundles (see evidence/), not assumed:
 *   l1 = PR #70's verifyOfflineScenario.   "detects" | "misses"
 *   l2 = PR #68's real journal cross-check (called with the correct experimentId).   "detects" | "consistent"
 * "by-design" = the forgery is coherent across every artifact; nothing offline can distinguish it from a genuine run.
 */
export interface TamperCase { id: string; name: string; counts: Count[]; l1: "detects" | "misses" | "by-design"; l2: "detects" | "consistent" | "by-design"; apply: (d: string, c: Count) => void }
// Note (T26): PR #68 adds worldChanges to receipts; PR #70's own bundles do not carry them, so the receipt edit is conditional.
export const CASES: TamperCase[] = [
  { id: "T01", name: "rehashed journal: observation worldChanges position moved", counts: [2, 4], l1: "detects", l2: "detects", apply: (d) => { const rows = readRows(d); (observation(rows, attempt(rows, "gpt-a").attemptId).worldChanges as any[])[0].position = { x: 99, y: 1, z: 99 }; writeRowsRehashed(d, rows); } },
  { id: "T02", name: "rehashed journal: attempt target changed", counts: [2], l1: "detects", l2: "detects", apply: (d) => { const rows = readRows(d); attempt(rows, "gpt-a").target = { x: 50, y: 70, z: 50 }; writeRowsRehashed(d, rows); } },
  { id: "T03", name: "rehashed journal: observation flipped to successReported=false, verified=false", counts: [2], l1: "detects", l2: "detects", apply: (d) => { const rows = readRows(d); const o = observation(rows, attempt(rows, "gpt-a").attemptId); o.successReported = false; o.verified = false; writeRowsRehashed(d, rows); } },
  { id: "T04", name: "rehashed journal: citizen identities swapped between gpt-a#1 and claude-a#1 (attempt and observation)", counts: [2, 4], l1: "detects", l2: "detects", apply: (d) => { const rows = readRows(d); const a = attempt(rows, "gpt-a"); const b = attempt(rows, "claude-a"); const oa = observation(rows, a.attemptId); const ob = observation(rows, b.attemptId); a.citizenId = "claude-a"; oa.citizenId = "claude-a"; b.citizenId = "gpt-a"; ob.citizenId = "gpt-a"; writeRowsRehashed(d, rows); } },
  { id: "T05", name: "manifest + receipt citizenIds swapped between two actions (journal untouched)", counts: [2, 4], l1: "detects", l2: "detects", apply: (d) => { const m = readJson(d, "manifest.json"); const [x, y] = [m.actions[0], m.actions[1]]; [x.citizenId, y.citizenId] = [y.citizenId, x.citizenId]; for (const a of [x, y]) editReceipt(d, a.receiptId, (r) => { r.citizenId = a.citizenId; }); writeJson(d, "manifest.json", m); } },
  { id: "T06", name: "receipt reference replaced with another existing receipt", counts: [2], l1: "detects", l2: "detects", apply: (d) => { const m = readJson(d, "manifest.json"); m.actions[0].receiptId = m.actions[1].receiptId; writeJson(d, "manifest.json", m); } },
  { id: "T07", name: "receipt CONTENT forged (ids kept; inventoryAfter=9, worldChanges emptied)", counts: [2, 4], l1: "detects", l2: "detects", apply: (d) => { const m = readJson(d, "manifest.json"); editReceipt(d, m.actions[0].receiptId, (r) => { r.inventoryAfter = { oak_log: 9 }; r.worldChanges = []; }); } },
  { id: "T08", name: "receipt sourceSha changed to a different SHA", counts: [2], l1: "detects", l2: "detects", apply: (d) => { const m = readJson(d, "manifest.json"); editReceipt(d, m.actions[0].receiptId, (r) => { r.sourceSha = OTHER; }); } },
  { id: "T09", name: "referenced receipt file deleted", counts: [2], l1: "detects", l2: "detects", apply: (d) => { const m = readJson(d, "manifest.json"); rmSync(receiptPath(d, m.actions[0].receiptId)); } },
  { id: "T10", name: "manifest.sourceReceipts[0].sha256 altered", counts: [2], l1: "detects", l2: "detects", apply: (d) => { const m = readJson(d, "manifest.json"); m.sourceReceipts[0].sha256 = "0".repeat(64); writeJson(d, "manifest.json", m); } },
  { id: "T11", name: "manifest action duplicated over another (new attemptId, same receipt)", counts: [2], l1: "detects", l2: "detects", apply: (d) => { const m = readJson(d, "manifest.json"); m.actions[2] = { ...m.actions[0], attemptId: "dup-" + m.actions[0].attemptId, sequence: m.actions[2].sequence }; writeJson(d, "manifest.json", m); } },
  { id: "T12", name: "rehashed journal: gpt-a#3 replaced by a clone of #1 (fresh attemptId, inventory 0->1)", counts: [2], l1: "detects", l2: "detects", apply: (d) => { const rows = readRows(d); const a1 = attempt(rows, "gpt-a", 0); const a3 = attempt(rows, "gpt-a", 2); const o1 = observation(rows, a1.attemptId); const o3 = observation(rows, a3.attemptId); const newId = "clone-" + String(a3.attemptId); Object.assign(a3, { ...a1, seq: a3.seq, attemptId: newId }); Object.assign(o3, { ...o1, seq: o3.seq, attemptId: newId }); writeRowsRehashed(d, rows); } },
  { id: "T13", name: "one action removed everywhere (manifest + journal pair)", counts: [2, 4], l1: "detects", l2: "detects", apply: (d) => { const m = readJson(d, "manifest.json"); const gone = m.actions.pop(); m.expectedActionCount = m.actions.length; writeJson(d, "manifest.json", m); writeRowsRehashed(d, readRows(d).filter((r) => r.attemptId !== gone.attemptId)); } },
  { id: "T14", name: "evidence sources disagree: manifest says delta=9, observedSuccess=false; journal says otherwise", counts: [2], l1: "detects", l2: "detects", apply: (d) => { const m = readJson(d, "manifest.json"); Object.assign(m.actions[0], { inventoryDelta: { oak_log: 9 }, observedSuccess: false, reportedSuccess: false }); writeJson(d, "manifest.json", m); } },
  { id: "T15", name: "source SHA differs: manifest only", counts: [2, 4], l1: "detects", l2: "detects", apply: (d) => { const m = readJson(d, "manifest.json"); m.sourceSha = OTHER; writeJson(d, "manifest.json", m); } },
  { id: "T16", name: "source SHA differs: original journal start row (rehashed) vs manifest", counts: [2], l1: "detects", l2: "detects", apply: (d) => { const rows = readRows(d); rows[0]!.sourceSha = OTHER; writeRowsRehashed(d, rows); } },
  { id: "T17", name: "source SHA differs: validator report only", counts: [2], l1: "detects", l2: "consistent", apply: (d) => { const r = readJson(d, "gemini-validator-report.json"); r.sourceSha = OTHER; writeJson(d, "gemini-validator-report.json", r); } },
  { id: "T18", name: "simulated presented as authenticated: verdict.json = PASS", counts: [2, 4], l1: "detects", l2: "consistent", apply: (d) => { const v = readJson(d, "verdict.json"); v.verdict = "PASS"; writeJson(d, "verdict.json", v); } },
  { id: "T19", name: "simulated presented as authenticated: validator overallStatus = VERIFIED", counts: [2], l1: "detects", l2: "consistent", apply: (d) => { const r = readJson(d, "gemini-validator-report.json"); r.overallStatus = "VERIFIED"; writeJson(d, "gemini-validator-report.json", r); } },
  { id: "T20", name: "simulated presented as authenticated: manifest.mode = paper-live", counts: [2], l1: "detects", l2: "detects", apply: (d) => { const m = readJson(d, "manifest.json"); m.mode = "paper-live"; writeJson(d, "manifest.json", m); } },
  { id: "T21", name: "simulated presented as authenticated: citizen authentication = microsoft", counts: [2], l1: "detects", l2: "consistent", apply: (d) => { const m = readJson(d, "manifest.json"); m.citizens[0].authentication = "microsoft"; writeJson(d, "manifest.json", m); } },
  { id: "T22", name: "simulated presented as authenticated: acceptance.json claims live 37/37 VERIFIED (a published artifact)", counts: [2], l1: "detects", l2: "consistent", apply: (d) => { const a = readJson(d, "acceptance.json"); a.outcome = "PASS"; a.live = { passed: 37, total: 37, percentage: 100, measurement: "VERIFIED" }; writeJson(d, "acceptance.json", a); } },
  { id: "T23", name: "simulated presented as authenticated: validator environment = 'Authenticated Paper live server'", counts: [2], l1: "detects", l2: "consistent", apply: (d) => { const r = readJson(d, "gemini-validator-report.json"); r.environment = "Authenticated Paper live server (microsoft login)"; writeJson(d, "gemini-validator-report.json", r); } },
  { id: "T24", name: "UNPROVEN_PAPER_AUTHENTICITY gap code silently removed from the validator report", counts: [2], l1: "detects", l2: "consistent", apply: (d) => { const r = readJson(d, "gemini-validator-report.json"); r.notProven = (r.notProven ?? []).filter((n: { code?: string }) => n.code !== "UNPROVEN_PAPER_AUTHENTICITY"); writeJson(d, "gemini-validator-report.json", r); } },
  { id: "T25", name: "journal row tampered WITHOUT recomputing the hash chain", counts: [2, 4], l1: "detects", l2: "detects", apply: (d) => { const lines = readFileSync(join(d, "operator.jsonl"), "utf8").split("\n"); const r = JSON.parse(lines[3]!); r.at = "1999-01-01T00:00:00.000Z"; lines[3] = JSON.stringify(r); writeFileSync(join(d, "operator.jsonl"), lines.join("\n")); } },
  { id: "T26", name: "COHERENT forgery: journal + receipt worldChanges edited, journal rehashed, receipt sha256 re-pinned", counts: [2], l1: "by-design", l2: "by-design", apply: (d) => { const rows = readRows(d); const a = attempt(rows, "gpt-a"); (observation(rows, a.attemptId).worldChanges as any[])[0].after = "stone"; writeRowsRehashed(d, rows); const m = readJson(d, "manifest.json"); const act = m.actions.find((x: any) => x.attemptId === a.attemptId); const p = editReceipt(d, act.receiptId, (r) => { if (r.worldChanges?.[0]) r.worldChanges[0].after = "stone"; else r.note = "edited"; }); m.sourceReceipts.find((x: any) => x.id === act.receiptId).sha256 = sha256File(p); writeJson(d, "manifest.json", m); } },
];

/**
 * Outcomes MEASURED in the original audit (PR #72) against PR #70's verifier, kept so the before/after table is mechanical.
 * These 13 classes were accepted by the verifier; PR #70 -> hardening branch turns every one into a rejection (T26 stays by-design).
 */
export const ORIGINAL_L1_MISSES = ["T01", "T02", "T03", "T04", "T05", "T07", "T08", "T10", "T12", "T14", "T22", "T23", "T24"] as const;
