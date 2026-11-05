# Mission 007 — OFF-13 / OFF-14 integration handoff

## Status

**BLOCKED** — ownership remains with **CODEX 1.2**. Mission 007 did **not** integrate movement or construction-guard subsystems.

## Published Codex refs (not folded)

| Requirement | Published tip | Notes |
| --- | --- | --- |
| OFF-14 Movement reliability | `windows-backup/agents/codex-movement-reliability` @ `bdfba7473d79487ffdcf467592e1f2328efabc4c` | Present on remote; absent from PR #56 tip |
| OFF-13 Construction/host-port guard | Local/partial only on tip; owned tip not authorized for Cursor rewrite | Do not copy guard files wholesale |

## Required handoff from CODEX 1.2

1. Explicit authorization to integrate named commits onto `agents/cursor-v1-single-sha-integration`.
2. Compatible patch set (or rebase onto current tip) that does not regress Mission 005/006 offline rehearsals, Evidence V2, or PR #42 provider faults.
3. Independent review note for construction guard child revision if still required by Issue #6.

Until then, ledger rows OFF-13 and OFF-14 stay `BLOCKED`.
