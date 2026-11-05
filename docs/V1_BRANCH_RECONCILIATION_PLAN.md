# V1 Branch Reconciliation Plan

**Companion:** `docs/V1_ACCEPTANCE_LEDGER.md`  
**Date:** 2026-11-05  
**Constraint:** Isolated integration branch only. No force-push, no `git clean`, no protected merges, no whole-file transplant on conflicts.

## Workspace audit snapshot

| Item | Finding |
| --- | --- |
| Primary remotes | `origin` = Minecraft-Ai-Civilization; `windows-backup` = Minecraft-Ai-Civilization-windows-backup |
| Local `main` | `15c13c8`, clean, behind `origin/main` by 10 docs commits (`63d1b97`) |
| Active worktrees | 20+ agent worktrees under `C:\Users\sh1ft\…` and `.t3\worktrees\…` — **all preserved** |
| Worlds/DBs in root checkout | No production SQLite/world artifacts found in root tree search |
| Tracking | windows-backup issue [#51](https://github.com/ManpreetS2/Minecraft-Ai-Civilization-windows-backup/issues/51); coordination issue [#6](https://github.com/ManpreetS2/Minecraft-Ai-Civilization-windows-backup/issues/6) |

## Dependency / conflict map

```text
origin/main (docs charter) 63d1b97
    │
    └─ (NOT a runtime base)

windows-backup offline candidate
    agents/t3-provider-hardening-integration @ 9945f02  ← PR #37 "best raw offline baseline"
         │
         ├─ PR #32 GPT retry guard @ 8bd0941 (Claude2) — needs non-author review
         ├─ PR #42 mixed faults @ 1a690f6 (Claude2) — needs non-author review
         └─ PR #48 offline default-deny @ ae784fd (Claude2) — needs NON-Claude2 review

Mission 013 stack (origin draft PRs; also mirrored on windows-backup)
    9945f02
      → 55d5a86  PR #12 executor community isolation
        → 7b1bd98  PR #13 per-community construction
          → dbbb7c4  PR #14 chest contents
            → f443bb3  windows-backup PR #50 QA (test-only; CHANGES REQUIRED)
              → agents/cursor-v1-acceptance-ledger  ← THIS branch (ledger + P0 fixes)

CODEX-owned (do not overwrite)
    agents/codex-cross-platform-isolation @ 7cb4bf4  (guard)
    agents/codex-movement-reliability @ bdfba74
    agents/codex-baseline-stabilization @ e3ef01e

Validator
    agents/antigravity-evidence-validator @ f8f4506  PR #43 Phase1
    agents/antigravity-phase2 (PR #47) — WRONG compare base vs Windows WIP; fix ancestry

Other WIP (preserve; do not auto-merge)
    SEC-001 / manager / startup / housing / storage / YC eval / Claude2 QA suite branches
```

## File-level hotspots (expect manual reconcile)

| Area | Heads touching it | Conflict risk | Owner |
| --- | --- | --- | --- |
| `packages/agent-core/src/executor.ts` | #12/#14, candidate `9945f02`, movement, survival | **High** | Coordinate; hunk-level merge only |
| `community-physical-state.ts` | #8/`fc6f9fc` → #12–#14 | Medium | Mission 013; Cursor P0 on chest access |
| `community-construction.ts` | #13 + QA #49 | Medium | Stack with #12 |
| Provider transports / cognition | #32/#42/#48/#37 | High | Claude2 authored; independent review |
| Construction guard / FS isolation | `7cb4bf4` | Medium | CODEX 1.2 |
| Movement / follow | `bdfba74` | Medium | CODEX 1.2 |
| Evidence validator | #43/#47 | Medium | Gemini; correct #47 base |
| `manager.ts` | SEC-001 / routing / shutdown | **High** | Avoid dual writers |

## Reconciliation sequence (authorized offline)

1. **Land chest P0** on tip of `dbbb7c4`+`f443bb3` (this branch) → draft PR → independent re-QA.  
2. **Review-only** #48, #32, #42 (non-authors). Record verdicts in ledger.  
3. Create **new** isolated integrate branch from chosen parent (likely `9945f02` or refreshed weekly), **not** from protected `main`.  
4. Cherry-pick / replay Mission 013 stack **commit-by-commit** (`55d5a86` → `7b1bd98` → chest fix SHA), resolving executor hunks manually against movement/survival.  
5. Fold reviewed provider/deny commits without replacing transport files wholesale.  
6. Add CODEX guard/movement only after ownership ack and QA evidence.  
7. Run matrix on the single SHA: `pnpm test`, `test:security`, `test:ai`, typecheck, lint, build, original isolation reproducers, scripted 1v1 offline.  
8. Update ledger numerators only when evidence cites that SHA.  
9. **Stop** before live Paper / paid calls pending explicit owner authorization.

## Explicit non-goals for V1 reconcile

- Economy, government, large construction fulfillment, CoreProtect production dependency, PIANO rewrite, 3v3, permadeath experiment mode.

## Immediate ownership decision (chest P0)

Issue #51 assigns Cursor to implement the QA #50 defects after ownership audit. No unpublished commits exist atop `dbbb7c4` for the affected files. Fix proceeds on `agents/cursor-v1-acceptance-ledger` without overwriting other worktrees.
