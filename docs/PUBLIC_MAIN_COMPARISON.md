# Public GitHub `main` vs Cloud Branch Comparison

**Compared:** `origin/main` (`15c13c88…`) … `cursor/brain-persistence-07c8` (`73c04298…`)  
**Date context:** Cloud Pass 6 freeze preparation.

> ## WARNING
>
> **PUBLIC GITHUB MAIN COMPARISON IS NOT PROOF OF MAIN-PC COMPATIBILITY.**
>
> The local main-PC branch may contain unpushed LIVE fishing, home, movement-sync,
> cognition, and DB changes that never appear in public `main`. Always re-diff against
> the real main-PC SHA before transplanting.

---

## Summary

| Metric | Value |
| --- | --- |
| Commits on cloud not in public main | 15 (Passes 1–5; Pass 6 adds more) |
| Commits on public main not in cloud | 0 (cloud is ahead of public main) |
| Files changed vs public main | 76 |
| Net lines (approx) | +10955 / −51 |

---

## Files only in cloud (additive / new)

High-signal additions (not exhaustive):

- `docs/BRAIN_PERSISTENCE_MAP.md`, `CLOUD_TO_MAIN_TRANSPLANT.md`, `CLOUD_PASS_REPORT.md`
- `packages/cognition/src/{router,provider,gemini,openai-compatible,brain,input,decision-schema,commitments,cooldown,routing,psychology,model-budget,cognition-trace,errors}.ts`
- `packages/agent-core/src/{brain-migrations,brain-persistence,brain-reconciler,brain-replay,citizen-brain-adapter,commitment-predicate,durable-budget,event-provenance,schema-preflight,housing}.ts`
- `packages/skills/src/{property,fishing-cycle}.ts`
- `packages/minecraft-adapter/src/water-safety.ts`
- `packages/memory/src/{retrieve,learned-behavior}.ts`
- `packages/society/src/relationship-belief.ts`
- `packages/shared/src/{action-trace,brain-types,commitment-target}.ts`
- `apps/orchestrator/src/one-citizen.ts`

These are the **most likely safe additive** imports when absent on main-PC.

---

## Files modified in both (high-risk integration)

Assume conflict if main-PC evolved the same paths:

| File | Risk |
| --- | --- |
| `packages/agent-core/src/store.ts` | **HIGH** — DB schema / migrate |
| `packages/agent-core/src/executor.ts` | **HIGH** — live skills |
| `packages/agent-core/src/index.ts` | MEDIUM |
| `packages/cognition/src/index.ts` / `ollama.ts` / `heuristic.ts` | **HIGH** |
| `packages/shared/src/config.ts` / `events.ts` | **HIGH** |
| `packages/skills/src/gather.ts` / `inventory.ts` / `context.ts` | **HIGH** |
| `packages/minecraft-adapter/src/path-recovery.ts` / `index.ts` | **HIGH** |
| `packages/society/src/index.ts` | MEDIUM |
| `packages/memory/src/index.ts` | MEDIUM |
| `.env.example`, root / orchestrator `package.json` | MEDIUM |
| `pnpm-lock.yaml` | MEDIUM — regenerate after merge |

---

## Package / dependency changes

- `@civ/cognition` gained workspace deps on `@civ/memory`, `@civ/society` (Pass 3).
- No new npm runtime deps for providers (uses `fetch`).
- `better-sqlite3` already present (agent-core).
- `packageManager` field added in Pass 6 (`pnpm@10.33.3`).

---

## DB / schema changes (cloud only)

Migrations (versioned via `schema_migrations`):

- `brain_persistence_v2` — commitments, relationship_beliefs(+evidence), learned_behavior_evidence, cognition_state, brain_applied_events
- `brain_integrity_v3` — llm_calls budget columns, commitment_progress_events, pending_reconsideration, belief provenance columns

Legacy tables (`citizens`, `events`, `memories`, `relationships`, …) are **not** rebuilt.

---

## Integration recommendation

1. Treat this document as a **public baseline map** only.  
2. Re-run comparison against main-PC SHA.  
3. Follow `docs/TRANSPLANT_ORDER.md` + `docs/MAIN_PC_INTEGRATION_RUNBOOK.md`.  
4. Keep PR #3 draft; do not merge into public `main` as a substitute for main-PC integration.
