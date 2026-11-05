# V1 single-SHA offline 1v1 candidate

**Branch:** `agents/cursor-v1-single-sha-integration`  
**PR:** [#56](https://github.com/ManpreetS2/Minecraft-Ai-Civilization-windows-backup/pull/56)  
**Authority:** Offline engineering candidate only. Does **not** close live Gate A/B.

## Measurements (do not invent completion %)

| Measurement | Value | Notes |
| --- | --- | --- |
| Implementation coverage (author) | **13/18** | Present + author suites on tip |
| Independently supported (Codex audit of `ea4ada9`) | **5/18** | OFF-03,10,11,12,17 limited — **not** transferred to tip without revalidation |
| `OFFLINE_PASS` on tip | **0/18** | Needs non-author acceptance on tip |
| Live Gate A/B | **0/2** | Unauthorized |

Codex verdict on `ea4ada9`: **CHANGES REQUIRED**. 5/18 is not overall project completion.

## Matrix evidence SHA

`2384766185398cadb14f40f4b72ca4ab9d003b97` (win32 / node 22.17.1 / pnpm 10.13.1) — all listed matrix exits 0. See `docs/V1_ACCEPTANCE_LEDGER.md`.

## Combined sources

| Source | Role |
| --- | --- |
| PR #52 / #48 / #53 / #42 | Chest, deny, provider faults |
| PR #54 tip `1500087` | Corrected QA verdict + non-destructive `run-on-candidate.sh` + wrapper-safety (Windows uses Git Bash) |
| PR #55 tools | Codex tooling / chest adapter |
| Mission 004 audit corrections | Ledger rewrite to Codex findings; OFF-04/05/06–09/16 author re-runs |

## Independent QA handoff

1. **Revalidate on tip** (do not inherit `ea4ada9` support): OFF-03,10,11,12,17.
2. **Claude:** full chest ADV-03 + packages suites; keep BLOCKED freshness/ordering until policy agreed; optional `observedContainerProvenance`.
3. **Owner:** OFF-01 worktree/world/DB preservation confirmation.
4. **CODEX 1.2:** OFF-13/14 ownership integrate — local guard greens are not integrated evidence.
5. **Gemini #47 `60ed5ca`:** inspected; validator package **not** folded (workspace/Phase-1 readiness).
6. No Paper / paid calls.

## Gate A

**Not ready for authorization.** Tip `OFFLINE_PASS` is 0/18; blockers remain on OFF-01/02/13/14/15 and independent tip revalidation.
