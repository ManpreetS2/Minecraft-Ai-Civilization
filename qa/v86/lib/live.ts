import { createHash } from "node:crypto";
import { createTestManifest } from "../../../experiments/evidence-validator/fixtures/helpers.js";
import { validateExperimentEvidence } from "../../../experiments/evidence-validator/src/index.js";
import { buildLiveJournal, newKey, payloadOf, signWith, sixtyMinuteTicks, reseal, type AttParams, type Row, type TickSpec } from "./journal.js";

export const EXP = "exp-qa67-live";
export const SHA = "9945f02f38e14a7d63b3eed66279d191ad06ad3d";
export const AUTH = "paper-qa67-authority";
export const SESSION = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
export const T0 = Date.parse("2026-11-05T12:00:00.000Z");
export const key = newKey();

export function attemptObs(citizen = "gpt_atlas"): Array<Record<string, unknown>> {
  return [
    { kind: "action_attempt", citizenId: citizen, attemptId: "att-1", action: "gather", decisionSource: "scripted", decisionEventId: "d-1", expectedItem: "oak_log" },
    { kind: "action_observation", citizenId: citizen, attemptId: "att-1", verified: true, successReported: true, beforeInventory: {}, afterInventory: { oak_log: 1 }, worldChanges: [] },
  ];
}

export interface Live {
  rows: Row[]; lines: string[]; ticks: TickSpec[];
}
export function liveJournal(opts: { ticks?: TickSpec[]; sourceSha?: string; runId?: string; citizens?: string[]; experimentId?: string; extra?: Array<Record<string, unknown>> } = {}): Live {
  const ticks = opts.ticks ?? sixtyMinuteTicks(T0);
  const j = buildLiveJournal({ experimentId: opts.experimentId ?? EXP, sourceSha: opts.sourceSha ?? SHA, runId: opts.runId ?? EXP, citizens: opts.citizens,
    start: new Date(T0).toISOString(), ticks, extra: opts.extra ?? attemptObs(), shutdownAt: ticks[ticks.length - 1]!.at });
  return { ...j, ticks };
}
export const digestOf = (lines: string[]) => createHash("sha256").update(lines.join("\n")).digest("hex");

export function paramsFor(l: Live, o: Partial<AttParams> = {}): AttParams {
  const t = l.ticks.filter((x) => typeof x.serverGameTick === "number");
  const first = t[0]?.serverGameTick ?? 0, last = t[t.length - 1]?.serverGameTick ?? 0;
  return { experimentId: EXP, captureSessionId: SESSION, serverBuild: 142, serverVersion: "1.21.6", sourceSha: SHA, evidenceDigest: digestOf(l.lines),
    startedAt: new Date(T0).toISOString(), endedAt: new Date(T0 + 3600_000).toISOString(), firstServerTick: first, lastServerTick: last, totalServerTicks: last - first, ...o };
}
/** Server-side signing: the signer signs exactly `p` (so a test can model an inconsistent-but-validly-signed attestation). */
export function attest(p: AttParams, priv = key.privatePem, authority = AUTH) {
  return { sourceType: "paper_server_attested" as const, signingAuthority: authority, signature: `ed25519:${signWith(priv, payloadOf(p))}`, ...p };
}
export function validateLive(l: Live, att: unknown, extra: Record<string, unknown> = {}) {
  const manifest = createTestManifest({ experimentId: EXP, sourceSha: SHA, durationMinutes: 60 });
  return validateExperimentEvidence({
    manifest, rawJournalLines: l.lines, journalRows: l.rows as never,
    sourceAttestation: att as never, trustedKeys: { [AUTH]: key.publicPem }, ...extra,
  } as never);
}
export { reseal };
