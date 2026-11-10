// QA-owned helpers. Everything here is what an attacker WITHOUT the signing key can do:
// the operator journal hash chain is unkeyed (sha256 over JSON), so any edit can be re-sealed.
import { createHash, generateKeyPairSync, sign, createPrivateKey } from "node:crypto";
import { readFileSync } from "node:fs";

export type Row = Record<string, unknown> & { kind: string; seq: number; hash?: string; previousHash?: string };

export const sha = (s: string) => createHash("sha256").update(s).digest("hex");

export function readRows(path: string): Row[] {
  return readFileSync(path, "utf8").split(/\r?\n/).filter((l) => l.trim()).map((l) => JSON.parse(l) as Row);
}

/** Re-number seq and recompute previousHash/hash exactly the way the verifier does (key order preserved, hash last). */
export function reseal(rows: Row[]): { rows: Row[]; lines: string[] } {
  let prev = "";
  const out: Row[] = [];
  const lines: string[] = [];
  rows.forEach((r, i) => {
    const { hash: _h, previousHash: _p, seq: _s, ...rest } = r as Record<string, unknown>;
    // keep original key order: experimentId, seq, at, previousHash, kind, ...
    const ordered: Record<string, unknown> = {};
    for (const k of Object.keys(r)) {
      if (k === "hash") continue;
      if (k === "seq") ordered.seq = i + 1;
      else if (k === "previousHash") ordered.previousHash = prev;
      else ordered[k] = (rest as Record<string, unknown>)[k];
    }
    const hash = sha(JSON.stringify(ordered));
    const full = { ...ordered, hash } as Row;
    prev = hash;
    out.push(full);
    lines.push(JSON.stringify(full));
  });
  return { rows: out, lines };
}

export const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

// ---- synthetic live-like journal with explicit timestamps / server ticks ----
export interface TickSpec { at: string; serverGameTick?: number | null; measuredTps?: number | null; durationMs?: number }
export function buildLiveJournal(opts: {
  experimentId: string; sourceSha?: string; runId?: string; start: string; ticks: TickSpec[]; citizens?: string[];
  extra?: Array<Record<string, unknown>>; mode?: "offline" | "live"; shutdownAt?: string;
}): { rows: Row[]; lines: string[] } {
  const rows: Row[] = [];
  const startRow: Record<string, unknown> = {
    experimentId: opts.experimentId, seq: 1, at: opts.start, previousHash: "", kind: "start",
    recordingAudience: "operator_only", mode: opts.mode ?? "live",
  };
  if (opts.sourceSha) startRow.sourceSha = opts.sourceSha;
  if (opts.runId) startRow.runId = opts.runId;
  if (opts.citizens) startRow.citizens = opts.citizens;
  rows.push(startRow as Row);
  for (const t of opts.ticks) {
    const r: Record<string, unknown> = { experimentId: opts.experimentId, seq: 0, at: t.at, previousHash: "", kind: "tick", durationMs: t.durationMs ?? 1000 };
    if (t.measuredTps !== undefined) r.measuredTps = t.measuredTps;
    if (t.serverGameTick !== undefined) r.serverGameTick = t.serverGameTick;
    rows.push(r as Row);
  }
  for (const e of opts.extra ?? []) rows.push({ experimentId: opts.experimentId, seq: 0, at: opts.shutdownAt ?? opts.start, previousHash: "", ...e } as Row);
  rows.push({ experimentId: opts.experimentId, seq: 0, at: opts.shutdownAt ?? opts.ticks[opts.ticks.length - 1]!.at, previousHash: "", kind: "shutdown", completedDuration: true, mode: opts.mode ?? "live" } as Row);
  return reseal(rows);
}

/** A genuine-looking 60-minute Paper run: one sample per minute (61 samples), 1200 ticks apart, 20 TPS. */
export function sixtyMinuteTicks(startMs: number, firstTick = 5000, stepTicks = 1200, stepMs = 60_000, n = 61): TickSpec[] {
  return Array.from({ length: n }, (_, i) => ({ at: new Date(startMs + i * stepMs).toISOString(), serverGameTick: firstTick + i * stepTicks, measuredTps: 20 }));
}

export interface AttParams {
  experimentId: string; captureSessionId: string; serverBuild: number; serverVersion: string; sourceSha: string;
  evidenceDigest: string; startedAt: string; endedAt: string; firstServerTick: number; lastServerTick: number; totalServerTicks: number;
}
export function payloadOf(p: AttParams): Buffer {
  return Buffer.from([
    "AGY-PAPER-ATTESTATION-V1", `experiment_id:${p.experimentId}`, `capture_session_id:${p.captureSessionId}`, `server_version:${p.serverVersion}`,
    `server_build:${p.serverBuild}`, `source_sha:${p.sourceSha}`, `evidence_digest:${p.evidenceDigest}`, `started_at:${p.startedAt}`, `ended_at:${p.endedAt}`,
    `first_server_tick:${p.firstServerTick}`, `last_server_tick:${p.lastServerTick}`, `total_server_ticks:${p.totalServerTicks}`,
  ].join("\n"), "utf-8");
}
export const newKey = () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return { publicPem: publicKey.export({ type: "spki", format: "pem" }).toString(), privatePem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    rawHex: publicKey.export({ type: "spki", format: "der" }).subarray(12).toString("hex") };
};
export const signWith = (privatePem: string, payload: Buffer) => sign(null, payload, createPrivateKey(privatePem)).toString("hex");
