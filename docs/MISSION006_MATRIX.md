# Mission 006 validation matrix

- **Repository:** `ManpreetS2/Minecraft-Ai-Civilization-windows-backup`
- **Branch:** `agents/cursor-v1-single-sha-integration`
- **Frozen SHA:** `90c3ba41000bacd2977ea0135585391e2c275f3d`
- **Platform:** win32 / Node 22 / pnpm 10.13.1
- **Date:** 2026-11-05

No historical PASS inherited from another SHA.

## Commands and results

| Step | Command | Exit | Counts / notes |
| --- | --- | --- | --- |
| typecheck | `pnpm typecheck` | 0 | workspace including `@civ/evidence-validator` |
| typecheck:tools | `pnpm typecheck:tools` | 0 | clean |
| typecheck:evidence-validator | `pnpm typecheck:evidence-validator` | 0 | clean |
| lint | `pnpm lint` | 0 | clean (`artifacts/**` ignored) |
| build | `pnpm build` | 0 | workspace Done |
| test:v1 | `pnpm test:v1` | 0 | **100** passed (includes Evidence Contract V2) |
| test:evidence-validator | `pnpm test:evidence-validator` | 0 | **127** passed |
| test:security | `pnpm test:security` | 0 | **358** passed |
| test:ai | `pnpm test:ai` | 0 | **514** passed |
| test (root) | `pnpm test` | 0 | 198 files; **2257** passed; 2 skipped |
| experiment-evidence | `pnpm exec vitest run packages/agent-core/src/experiment-evidence.test.ts` | 0 | **11** passed |
| independent-offline-runtime | `pnpm exec vitest run apps/orchestrator/src/independent-offline-runtime.test.ts` | 0 | **11** passed |
| chest adapter | `pnpm exec vitest run --config tools/vitest.config.ts tools/v1-integration/integrated-chest-adapter.test.ts` | 0 | **1** passed |
| qa/v1 | `pnpm exec vitest run --config qa/v1/vitest.config.ts` | 0 | **91** passed |
| offline 1v1 | `pnpm v1:offline 2 artifacts/v1/mission006-90c3ba41000b/scenario-2` | 0 | structural **NOT PROVEN**; Gemini **NOT_PROVEN**; hashChainValid true |
| offline 2v2 | `pnpm v1:offline 4 artifacts/v1/mission006-90c3ba41000b/scenario-4` | 0 | same |
| negative tamper | mutate receipt bytes; `validateBundle(..., {evidenceRoot})` | FAIL expected | `Source receipt digest mismatch` |

## Evidence paths

- `artifacts/v1/mission006-90c3ba41000b/scenario-2/` — 1v1 bundle, receipts, `operator.jsonl`, `gemini-validator-report.json`
- `artifacts/v1/mission006-90c3ba41000b/scenario-4/` — 2v2 bundle
- Per-step logs: `*.out.txt` beside this file

## Explicit non-claims

- Offline scripted rehearsal ≠ autonomous GPT/Claude behavior
- Offline fixture ≠ live Paper authenticity (Gemini source auth remains fail-closed)
- Codex prior **5/18** independent support on `ea4ada9…` is **not** transferred to this tip
