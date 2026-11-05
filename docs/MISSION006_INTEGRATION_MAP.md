# Mission 006 — Source ownership and integration map

**Base tip:** PR #56 @ `502ed5903e44ec187d73f4058efd9fa005006569` (Mission 005 complete)  
**Publish tip:** `ac8871ea08ac6dca9470346eaf549d462646c91d`  
**Author matrix code SHA:** `90c3ba41000bacd2977ea0135585391e2c275f3d`  
**Repository:** `ManpreetS2/Minecraft-Ai-Civilization-windows-backup`  
**Branch:** `agents/cursor-v1-single-sha-integration`

## Owned inputs (inspect ancestry; do not blind-merge heads)

| Owner | PR / SHA | Integrate | Preserve / skip |
| --- | --- | --- | --- |
| Cursor (this tip) | #56 `502ed59…` | Mission 005 offline 1v1/2v2, `ExperimentEvidenceJournal`, ADV-03 chest CAS, civ aliases, PR #42 mixed-fault runtime | Do not rebuild Mission 005 scenarios |
| Codex | #55 `4c65ce7…` | `EVIDENCE_CONTRACT_V2.md`, `evidence-contract.ts` + tests, V2 `manifest.ts` surface | Older #55 runtime ancestry that would regress PR #42 / Mission 005 |
| Gemini | #47 `2156a0d…` | `experiments/evidence-validator/**` (adapter, bridge, authenticator stub, tests, CLI) | Do not claim Paper authenticity verified |
| Claude | #54 `e7e08e7…` | Already folded QA tips + five ordinary V2 regressions | No further unfinished worktree |

## Integration sequence executed

1. Checkout Codex V2 contract/tests/docs onto #56 tip without resetting runtime.
2. Replace `tools/v1-integration/manifest.ts` with Codex V2-capable validate/build (keeps V1 schemaVersion).
3. Checkout Gemini `experiments/evidence-validator` tree; add `experiments/*` to pnpm workspace; root scripts for typecheck/test/CLI.
4. Extend Mission 005 `scenario.ts` to emit per-attempt `SourceReceipt` JSON + `persistentFacts` from executed journal events (not aggregate end-state invention).
5. Extend `cli.ts` for `evidenceContractVersion: 2`, provider-usage receipt, `validateBundle(bundle, sha, { evidenceRoot })`, Gemini report writer.
6. Leave OFF-13 / OFF-14 blocked for CODEX 1.2 ownership (no authorized movement/guard rewrite).

## End-to-end evidence path

```
pnpm v1:offline [2|4]
  → createIndependentOfflineRuntime + ExperimentEvidenceJournal
  → receipts/*.json + operator.jsonl + provider-usage.json
  → manifest.json (V2) + validateBundle(…, { evidenceRoot })
  → adaptRecorderJournal + bridgeV1RunBundle + validateExperimentEvidence
  → gemini-validator-report.json / summary.md + acceptance ledger artifacts
```

## Explicit non-claims

- Scripted offline ≠ autonomous GPT/Claude behavior.
- Offline fixture ≠ live Paper survival.
- Gemini source authenticator remains fail-closed / `UNPROVEN_PAPER_AUTHENTICITY` until real signature verification and Paper capture exist.
- Codex historical **5/18** independent support on `ea4ada9…` is **not** transferred to this tip.
