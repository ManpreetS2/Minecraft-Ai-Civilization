# Brain Persistence Map

**Pass:** Cloud Pass 4 + Pass 5 integrity  
**Environment:** Cloud-only — tests use temporary SQLite files only.  
**Authoritative store (this public branch):** `CivilizationStore` (`packages/agent-core/src/store.ts`) via better-sqlite3.  
**PR base:** PR #3 targets `cursor/cloud-dev-skeleton-07c8`, **not** main-PC `main`. Do not blindly merge the entire PR into main-PC.

| DATA TYPE | CURRENT STORAGE | AUTHORITATIVE SOURCE | NEW TABLE NEEDED? | MIGRATION NEEDED? | WRITE EVENTS | READ PATH | RETENTION POLICY | MAIN-PC CONFLICT RISK |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Memories | `memories` | SQLite | No | No | `addMemory` / idempotent transfer memories | `getMemories` | Soft-cap via LIMIT | MEDIUM |
| Relationships (legacy scores) | `relationships` | SQLite | No | No | `saveRelationship` | get/list | Keep | HIGH |
| Relationship beliefs | `relationship_beliefs` + `relationship_belief_evidence` | SQLite evidence + snapshot | Pass 4 | v2 + v3 provenance cols | belief apply | directional get / reconstruct | Keep | HIGH |
| Citizen state | `citizens` | SQLite | No | death cols only | `upsertCitizen` | `getCitizen` | Keep | HIGH |
| Events | `events` | SQLite append-only | No | No | `appendEventIdempotent` | `recentEvents` / reconciler | Keep | MEDIUM |
| Commitments | `commitments` | SQLite | Pass 4 | v2 | create/update/complete | by citizen / id | Keep | MEDIUM/HIGH |
| Commitment progress | `commitment_progress_events` | Verified event ledger | Pass 5 | **v3** | credit transfer qty | sum ledger | Keep | MEDIUM |
| Learned behavior evidence | `learned_behavior_evidence` | SQLite | Pass 4 | v2 | insert evidence | derive summary | Keep; decay at read | MEDIUM |
| Mood/affect | `cognition_state` | SQLite | Pass 4 | v2 | mood update | load cognition | Keep latest | MEDIUM |
| High-level goal | `cognition_state` | SQLite | Pass 4 | v2 | deliberation | restore | Keep | HIGH |
| Cognition cooldown | `cognition_state` | SQLite | Pass 4 | v2 | after deliberation | adapter | Keep | MEDIUM |
| Pending reconsideration | `pending_reconsideration` | SQLite | Pass 5 | **v3** | classifyGate signals | list/clear | Clear after handle | MEDIUM |
| Model usage / budgets | `llm_calls` (+ budget cols) | SQLite **only** durable authority | Additive cols | **v3** | `logLlmCall` with `counts_toward_budget` | `listBudgetConsumingLlmCalls` | Keep log | MEDIUM |
| Brain event idempotency | `brain_applied_events` | SQLite | Pass 4 | v2 | mark applied | exists check | Keep | LOW |

## Durable budget semantics (Pass 5)

- Authority: `llm_calls` rows where `counts_toward_budget=1` AND `ok=1` AND `decision_category != 'NO_LLM'`.
- `NO_LLM` never consumes budget.
- Failed provider calls (`ok=0`) are logged but do **not** consume budget by default.
- Retries/fallbacks share `decision_id`; only one counted row per decision.
- Per-citizen MC-day, DEEP_REFLECTION/day, optional global/day, and ROUTINE rolling window all reconstruct from durable timestamps + `mc_day`.
- Process restart must not reset allowances (no in-memory authoritative history).

## Commitment predicate semantics

- Structured payload required (`item_transfer` or `verified_event_match`).
- Verified event is necessary but not sufficient.
- `candidateCommitmentIds` / deprecated `completesCommitmentId` are hints only — never force COMPLETE.
- Match requires: correct giver (= owner), item, recipient, positive integer quantity.
- Progress = sum of ledger quantities for distinct `source_event_id`s; complete when delivered ≥ required.

## Verified quantity semantics

- `VerifiedTransferBrainEvent.quantity` must be a positive integer.
- Persisted in `events.payload.quantity`.
- Memories use concise human text (`Gave 5 bread to …`).
- Never inferred from narration.

## Reconciliation flow

```
verified durable events (verified=true)
        ↓
brain_applied_events check
        ↓
BrainReconciler.apply missing effects once (bounded batch, deterministic order)
```

- Idempotent; citizen-filterable; unsupported/malformed → explicit failure entries (never silent drop).
- Does not invent Minecraft success.

## Replay guarantees

- `replayBrainState` rebuilds commitments/progress/beliefs/learned/idempotency from ordered verified events into a TEMP DB.
- Snapshot equality excludes nondeterministic UUIDs/clocks by using deterministic effect/memory/progress ids derived from source event ids.
- Replaying complete history twice yields the same snapshot.

## Adapter reconsideration precedence

1. Lethal reflex → `NO_LLM` safety  
2. Task failure / goal invalidation → reconsider now (even mid-skill)  
3. Important direct request / commitment conflict / major relationship → reconsider now, **or queue** if mid long-running skill until skill boundary  
4. Otherwise valid deterministic skill continues without LLM  
5. Ambient speech does not interrupt  

Pending signals: `REQUEST_PENDING`, `COMMITMENT_CONFLICT`, `TASK_FAILURE`, `GOAL_INVALIDATED`, `SURVIVAL_CHANGED`, `MAJOR_RELATIONSHIP` (durable, deduped).

## Event provenance

- One Minecraft transfer → multiple directional belief effects.
- All share `source_event_id` = verified event id.
- `effect_role` distinguishes giver/receiver/direct.
- Effect-row keys may be synthetic (`eventId#transfer_receiver`); `isSyntheticEffectId` must be used — never treat as independent MC events.

## Crash / reconciliation semantics

1. **Minecraft first:** physical verification observed in-world.  
2. **Then durable brain txn:** event append + commitment/relationship/learned/idempotency.  
3. **Not one global atomic txn with Minecraft.**  
4. **Never invent COMPLETE** without predicate match + ledger evidence.

## Schema preflight

Use `inspectSchemaCompatibility(snapshotSqliteSchema(db))` on a **COPY** of main-PC DB:

- `COMPATIBLE` / `MANUAL_RECONCILE_REQUIRED` / `INCOMPATIBLE`
- Read-only — never mutates.

## Forbidden during tests

- `data/civilization.sqlite`
- WORLD-LAB sqlite paths
- production migration against live DBs
