# Mission 006 — Claude independent QA handoff

**Candidate tip:** `90c3ba41000bacd2977ea0135585391e2c275f3d`  
**Branch / PR:** `agents/cursor-v1-single-sha-integration` / windows-backup PR #56  
**Integration map:** `docs/MISSION006_INTEGRATION_MAP.md`  
**Author matrix:** `artifacts/v1/mission006-90c3ba41000b/MATRIX.md` (author-reported only)

## What landed

1. Codex Evidence Contract V2 (`tools/v1-integration/evidence-contract.ts`, V2 `manifest.ts`).
2. Mission 005 offline 1v1/2v2 now emits per-attempt `SourceReceipt` JSON + memory fact receipts from executed journal events.
3. Gemini `experiments/evidence-validator` wired via workspace package + `offline-validator-report.ts`.
4. End-to-end: `pnpm v1:offline [2|4]` → journal → V2 bundle → Gemini adapter/bridge → `gemini-validator-report.json`.

## Reproduce

```bash
git fetch windows-backup agents/cursor-v1-single-sha-integration
git checkout 90c3ba41000bacd2977ea0135585391e2c275f3d
pnpm install
pnpm test:v1
pnpm test:evidence-validator
pnpm v1:offline 2 artifacts/v1/claude-qa-scenario-2
pnpm v1:offline 4 artifacts/v1/claude-qa-scenario-4
```

Inspect `verdict.json`, `receipts/`, `operator.jsonl`, `gemini-validator-report.json`.

## Ask Claude to verify independently

- Structural V2 failures/unproven lists on this SHA (not prior tips).
- Receipt digests bind to executed gather attempts (not end-state invention).
- Gemini report stays fail-closed on Paper authenticity (`UNPROVEN_PAPER_AUTHENTICITY`).
- Negative: mutate a receipt file without updating `sourceReceipts[].sha256` → digest mismatch FAIL.
- Do **not** grant `OFFLINE_PASS`; author matrix is not independent acceptance.
- OFF-13 / OFF-14 remain CODEX 1.2 blocked — do not rewrite movement/guard.

## Still blocked for Gate A

- Live Paper / paid APIs
- Real signature verification for Paper capture (Gemini-owned)
- Independent revalidation transferring Codex 5/18 onto this tip
