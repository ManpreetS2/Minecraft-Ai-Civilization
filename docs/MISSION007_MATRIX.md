# Mission 007 validation matrix

- **Repository:** `ManpreetS2/Minecraft-Ai-Civilization-windows-backup`
- **Branch:** `agents/cursor-v1-single-sha-integration`
- **Frozen SHA:** `a176fcaee0e4e72cf2d40a738d3bfcad5343cc80`
- **Gemini crypto input:** `fad541f2863473df8f9ffd119c09d631472eb37b`
- **Platform:** win32 / Node 22 / pnpm 10.13.1
- **Date:** 2026-11-05

No historical PASS inherited from another SHA.

## Commands and results

| Step | Command | Exit | Counts / notes |
| --- | --- | --- | --- |
| typecheck | `pnpm typecheck` | 0 | includes `@civ/evidence-validator` |
| typecheck:tools | `pnpm typecheck:tools` | 0 | clean |
| typecheck:evidence-validator | `pnpm typecheck:evidence-validator` | 0 | clean |
| lint | `pnpm lint` | 0 | clean |
| build | `pnpm build` | 0 | workspace Done |
| test:v1 | `pnpm test:v1` | 0 | **100** passed |
| test:evidence-validator | `pnpm test:evidence-validator` | 0 | **149** passed (incl. Ed25519 crypto + incomplete attestation) |
| test:security | `pnpm test:security` | 0 | **358** passed |
| test:ai | `pnpm test:ai` | 0 | **514** passed |
| test (root) | `pnpm test` | 0 | 198 files; **2257** passed; 2 skipped |
| chest adapter | integrated-chest-adapter.test.ts | 0 | **1** passed |
| qa/v1 | `pnpm exec vitest run --config qa/v1/vitest.config.ts` | 0 | **91** passed |
| offline 1v1 | `pnpm v1:offline 2 artifacts/v1/mission007-a176fcaee0e4/scenario-2` | 0 | structural **NOT PROVEN**; Gemini **NOT_PROVEN** |
| offline 2v2 | `pnpm v1:offline 4 …/scenario-4` | 0 | same |
| receipt tamper | mutate receipt bytes | FAIL | `Source receipt digest mismatch` |
| journal tamper | mutate operator.jsonl | FAIL | hash chain broken |
| signature digest mismatch | attested digest ≠ journal | proven=false | crypto verify fail-closed |

## Evidence artifact paths

- `artifacts/v1/mission007-a176fcaee0e4/scenario-2/`
- `artifacts/v1/mission007-a176fcaee0e4/scenario-4/`
- Per-step logs: `artifacts/v1/mission007-a176fcaee0e4/*.out.txt`

## NOT_PROVEN (expected for offline)

- Real Paper authenticity / live signature from Paper capture
- Autonomous paid GPT/Claude behavior
- OFF-13 / OFF-14 ownership integration
