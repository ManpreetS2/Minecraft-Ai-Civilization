# QA — evidence provenance negative controls

Base: integration candidate `1d9967f0020840fe091cbbc77fe27234a577381f`, cross-run on the PR #94 validator `da0e1ff9e7e84647467ac335a7ded698f5f8fdc3`. Uses the scientific-integrity specification of PR #119 (`qa/live-evidence-spec`, G1–G8). **No signer was built.** Keys are in-memory synthetic test keys; no Paper, no network, no paid call, no saved world touched. Nothing here upgrades any acceptance status.

```
pnpm exec vitest run -c qa/provenance-controls/vitest.config.ts           # 26 pass: defenses that exist + today's gaps characterized
pnpm exec vitest run -c qa/provenance-controls/vitest.defects.config.ts   # 9 red by design: the same gap scenarios asserted as PR #119 requires
```

## Result in one table

Identical on the PR #94 validator and the integration candidate: **26 pass / 9 red on both.** So none of the nine is a regression introduced by the integration or by PR #94; each is a defense PR #119 specifies that does not exist yet.

| Requested control | Class | Today |
| --- | --- | --- |
| Replay under a different session — attestation bound to a different experiment; journal relabelled; one row changed; window shorter than the journal | **Defense exists** (regression guard) | Rejected, never `real_minecraft/VERIFIED` |
| Replay under a different session — same genuine attestation + journal used for a second run | **Unimplemented (G2)** | Accepted both times: no used-session registry |
| Replay under a different session — caller states the expected session | **Unimplemented (G2)** | Not possible: `ValidatorInput` has no `expectedCaptureSessionId` (the internal `verifySourceAttestation` supports it, but `duration-verifier` does not pass it). Extra fields are silently ignored |
| Correct key, wrong world | **Unimplemented (G3)** | Accepted: the signed payload binds no world; a start row whose `worldSeed`/`worldFingerprint` contradicts the manifest is not compared; a caller-supplied world constraint is ignored |
| Plausible fabricated physical journal written by the harness | **Unimplemented (G1)** | 50 consistent actions (40 gathers, moves, continuity) signed by a trusted key → `real_minecraft/VERIFIED`. *Clumsy* fabrication **is** caught even when signed: phantom gather, broken inventory chain |
| Model-decision claims without provider receipts | **Unimplemented (G6)** | Every action `decisionSource: "model"` with no receipt anywhere → `real_minecraft/VERIFIED`, no not-proven item |
| Wrong UUID-to-citizen mapping | **Unimplemented (G8)** | Two citizens under one UUID, or ids swapped against join UUIDs → accepted. `join` rows and UUIDs are not a concept the validator has |
| Missing or interrupted witness checkpoints — gap in ticks, capture cut at 10 min and honestly signed, tick goes backwards, two runs spliced | **Defense exists** | Rejected (`DURATION_EVIDENCE_DEFICIT`, `DUPLICATE_ATTEMPT_ID`, continuity) |
| Missing witness checkpoints — no shutdown/seal row; one end-of-run signature only | **Unimplemented (G4)** | A crash-truncated journal re-signed at its digest, and a 60-minute run with no checkpoints, are both accepted |

Preserved distinction (first scripted Paper observation vs evidence-grade): `[FIRST-SMOKE]` tests show that the same scripted journal with no attestation is `offline_simulated`, never VERIFIED, and names `UNPROVEN_PAPER_AUTHENTICITY`; that a journal which *claims* live mode with 60 minutes of plausible ticks but is unsigned stays `offline_simulated`; that an empty trust root, or a trust entry that is not the signer's key, is never authentic; and that a signed 1-minute smoke is not 60-minute evidence. The first disposable smoke needs none of the missing defenses and must stay `NOT_PROVEN`; evidence-grade Gate A/B needs all of them (PR #119 §4–5). The Paper smoke code itself (PR #97) is not in this integration base, so its report constants were not re-tested here (Claude 1 owns Paper QA).

## Minimal implementation recommendations

Ordered by what unlocks the most while staying small. They match PR #119 §3 and do not weaken the PR #94 complete-row binding.

1. **Thread the expected provisioned values into `ValidatorInput`** (`expectedCaptureSessionId`, `expectedWorldFingerprint`, `expectedUuidMap`, `expectedProviderReceipts`) and pass them to `verifySourceAttestation`, which already accepts `expectedCaptureSessionId`. Reject unknown input keys so a silently ignored constraint can never look like a passed check. This alone closes the "caller cannot state the session" half of G2 and makes G3/G8 testable.
2. **Payload V2** (`gate_a_session_id`, `challenge_nonce`, `world_fingerprint`, `server_root_sha256`, `plugin_sha256`, `key_id`), each required to equal the provision record. Reject V1 for any run that claims evidence-grade; keep V1 for offline fixtures, which stay `offline_simulated`.
3. **A used-session ledger** (`{session_id, key_id, evidence_digest}`) checked by the wrapper, to refuse a replayed genuine attestation (G2).
4. **Witness stream + intent stream**: `VERIFIED` physical outcomes only where the server-side stream agrees; harness claims can only agree or disagree (G1). Until that exists, the validator cannot tell a plausible fabrication from a real run, and the report should say so with a standing `NOT_PROVEN: no server-side physical witness` item even when the signature verifies.
5. **Seal and checkpoint requirement** for runs over 5 minutes: absence of a `session_seal` is `NOT_PROVEN` for completeness (G4).
6. **Provider receipts**: a `decisionSource: "model"` with no joined receipt is reported as `NOT_PROVEN` model provenance (G6); a `join` record schema (UUID, name, tick) validated once per session (G8).

When any of these lands, move that scenario in `test/scenarios.ts` from the "unimplemented" group to an enforced one; its desired-behaviour test in `defects/` will turn green on its own.

## Limits

* Synthetic keys prove verifier logic only; there is no genuine signer, trust-root distribution or key custody in the repository.
* These tests characterize the offline library. They say nothing about a live Paper server, a real harness, or a modified server binary (G7), which stay documented limits.
