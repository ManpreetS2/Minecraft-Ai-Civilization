# Mission 007 — Offline release candidate integration map

**Publish tip:** `a176fcaee0e4e72cf2d40a738d3bfcad5343cc80`  
**Base:** Mission 006 tip `50940be26bcd2fa1ab5ee904ecc38f4229285e64`  
**Gemini crypto:** PR #47 @ `fad541f2863473df8f9ffd119c09d631472eb37b`  
**Claude QA tip available:** PR #54 @ `e7e08e7a0977fe812cc38a77e6653cf6d9b35ef0` (already on tip from prior missions)

## Owned inputs

| Owner | SHA | Integrated |
| --- | --- | --- |
| Cursor Mission 006 | `50940be…` | Offline civilization, Evidence V2, receipts, chest CAS |
| Gemini | `fad541f…` | Ed25519 `crypto.verify`, trust keys, crypto suite, Paper capture docs |
| Cursor Phase B | on tip | Fail-closed completeness gates (journal/digest/SHA/timestamps/ticks) |
| CODEX 1.2 | `bdfba74…` movement tip | **Not** integrated — ownership blocked |

## Pipeline

```
pnpm v1:offline [2|4]
  → ExperimentEvidenceJournal + SourceReceipts + provider-usage
  → Evidence Contract V2 validateBundle(sha, {evidenceRoot})
  → Gemini adaptRecorderJournal + bridge + validateExperimentEvidence
  → gemini-validator-report.json (NOT_PROVEN for Paper authenticity)
```

## Executable commands

```bash
pnpm v1:offline 2 artifacts/v1/mission007-offline-2
pnpm v1:offline 4 artifacts/v1/mission007-offline-4
pnpm test:evidence-validator
```
