# V1 single-SHA offline 1v1 candidate

**Branch:** `agents/cursor-v1-single-sha-integration`  
**PR:** [#56](https://github.com/ManpreetS2/Minecraft-Ai-Civilization-windows-backup/pull/56)

## Measurements (no completion %)

| Measurement | Ratio | Notes |
| --- | --- | --- |
| Author-tested on matrix SHA | **13/18** | Cursor suites on tip matrix |
| Independently supported (Codex on `ea4ada9`) | **5/18** | OFF-03,10,11,12,17 limited — not transferred |
| Accepted (`OFFLINE_PASS` on tip) | **0/18** | Needs non-author on tip |
| Blocked | **5/18** | OFF-01,02,13,14,15 |
| Live Gate A/B | **0/2** | |

Claude harness `53602ba` vs `ea4ada9`: **CHANGES REQUIRED** (tools test load under root Vitest). Fixed on tip via shared `test-support/civ-package-aliases.mjs`.

## Matrix evidence SHA

`38f61ce1b2986e7bd16c38e3953dcbfb15548e71` — root `pnpm test` **2205 passed** / 2 skipped; QA **91 passed**; all matrix exits 0. See ledger.

## Independent QA handoff

1. Revalidate OFF-03/10/11/12/17 on tip (do not inherit `ea4ada9`).
2. Claude: re-run ADV suite including ADV-03 freshness (now implemented) + ADV-07.
3. Owner OFF-01; CODEX 1.2 OFF-13/14; Gemini #47 OFF-15 not folded.
4. No Paper / paid APIs.

## Gate A

**Not ready.**
