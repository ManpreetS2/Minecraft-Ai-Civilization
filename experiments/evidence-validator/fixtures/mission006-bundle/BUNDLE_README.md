# Mission 006 Evidence Validation Bundle & Cursor Integration Handoff

**Validator Version:** 1.0.0  
**Source SHA:** `06b7e5038c11bf88d55d7870fbf155a0f12d4d8a`  
**Generated At:** 2026-11-05T21:09:04.075Z  

---

## 1. Artifact Verification & Checksums (SHA-256)

| Artifact | Path | SHA-256 |
| :--- | :--- | :--- |
| Positive Manifest | `positive-offline/manifest.json` | `4181dbb8e347d3f3bca638501009b6791fef7c4616802e62d154b2169b1ac206` |
| Positive Journal | `positive-offline/operator-journal.jsonl` | `5cdb2a8dd7a4d1dbee13e540db21813476ee70ffeff50cee5bf4cefd38ae973b` |
| Positive Events | `positive-offline/events.jsonl` | `f90c4b4000352eb7aefcb7706458f12f88e39ed0eefb3a6a3f5f98e7dbe3d71f` |
| Positive Facts | `positive-offline/facts.json` | `5bf61b1c25ede6bc5fed3eb18279e636855f6ba69d8af3ec8583042a19b387aa` |
| Positive Inventories | `positive-offline/inventories.json` | `ecea3d81c47e7fc8b39cedf37ff081ec8e1801d49d7df3e656cc984eaf7228ec` |
| Positive Report | `positive-offline/report.json` | `e1b413e113b61a40e971c9d56f3f91d4cf9f280230285b54fb70ff085cb8a36c` |
| Tampered Journal | `negative-tampered/tampered-hash-chain/operator-journal.jsonl` | `601a41beba7b2f078df9f00373225f91c13de7e27d04f586d25bd933fc3c5939` |
| Falsely Labeled Live Manifest | `negative-tampered/falsely-labeled-live/manifest.json` | `ac3a1c0482c61714c53223f2df1f8639f53c0f70841d51c8f42336d15c3147d8` |

---

## 2. Validation Execution Commands & Exit Codes

### A. Positive Offline Fixture
```bash
pnpm exec tsx experiments/evidence-validator/src/cli.ts \
  --manifest experiments/evidence-validator/fixtures/mission006-bundle/positive-offline/manifest.json \
  --journal experiments/evidence-validator/fixtures/mission006-bundle/positive-offline/operator-journal.jsonl \
  --events experiments/evidence-validator/fixtures/mission006-bundle/positive-offline/events.jsonl \
  --facts experiments/evidence-validator/fixtures/mission006-bundle/positive-offline/facts.json \
  --inventories experiments/evidence-validator/fixtures/mission006-bundle/positive-offline/inventories.json
```
- **Exit Code:** `0`
- **Status:** `VERIFIED` (internal offline consistency passed: actions verified, inventory conserved, hash chain valid)
- **Live Paper Authenticity Guarantee:** `NOT_PROVEN` (simulation mode correctly classified as `offline_simulated`)

### B. Tampered Hash Chain Negative Fixture
```bash
pnpm exec tsx experiments/evidence-validator/src/cli.ts \
  --manifest experiments/evidence-validator/fixtures/mission006-bundle/positive-offline/manifest.json \
  --journal experiments/evidence-validator/fixtures/mission006-bundle/negative-tampered/tampered-hash-chain/operator-journal.jsonl \
  --strict
```
- **Exit Code:** `2`
- **Status:** `VIOLATIONS_DETECTED` (`HASH_CHAIN_MISMATCH` at seq 2)

### C. Falsely Labeled Live Negative Fixture
```bash
pnpm exec tsx experiments/evidence-validator/src/cli.ts \
  --manifest experiments/evidence-validator/fixtures/mission006-bundle/negative-tampered/falsely-labeled-live/manifest.json \
  --journal experiments/evidence-validator/fixtures/mission006-bundle/positive-offline/operator-journal.jsonl \
  --strict
```
- **Exit Code:** `2`
- **Status:** `NOT_PROVEN` (`UNPROVEN_PAPER_AUTHENTICITY` emitted; path containing live rejected without server attestation)

---

## 3. Cursor & CODEX 1 Integration Handoff

The validator is completely integrated with fail-closed boundary adapters. To achieve live Gate B certification without `NOT_PROVEN`, Cursor/CODEX 1 must implement the following 5 runtime instrumentation fields:

1. `originPosition` in `packages/agent-core/src/experiment-evidence.ts` (`attemptSchema`)
2. `serverGameTick` in `packages/agent-core/src/experiment-evidence.ts` (`recordTick(durationMs, measuredTps, serverGameTick)`)
3. `toolDurabilityBefore/After` in `packages/agent-core/src/experiment-evidence.ts` (`observationSchema`)
4. `source_event_id` foreign key on all `citizen_persistent_facts` table writes in `packages/agent-core/src/store.ts`
5. `SourceAttestation` signed token exported by Paper server capture plugin for live demonstrations
