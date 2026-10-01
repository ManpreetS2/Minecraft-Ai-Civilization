# Brain Persistence Map

**Pass:** Cloud Pass 4  
**Environment:** Cloud-only — tests use temporary SQLite files only.  
**Authoritative store (this public branch):** `CivilizationStore` (`packages/agent-core/src/store.ts`) via better-sqlite3.

| DATA TYPE | CURRENT STORAGE (pre-pass-4) | AUTHORITATIVE SOURCE | NEW TABLE NEEDED? | MIGRATION NEEDED? | WRITE EVENTS | READ PATH | RETENTION POLICY | MAIN-PC CONFLICT RISK |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Memories | `memories` | SQLite row per memory | No | No | `addMemory` / episodic writes | `getMemories(citizenId)` | Soft-cap via query LIMIT | MEDIUM if main-PC memory schema richer |
| Relationships (legacy scores) | `relationships` (citizen_id, other_id) | SQLite | No for legacy | No | `saveRelationship` | `getRelationship` / `listRelationships` | Keep | HIGH — main-PC may already evolve this |
| Relationship beliefs (Pass 3) | In-memory only | — | **Yes** `relationship_beliefs` | **Yes** v2 | belief apply / brain event txn | directional get/list | Keep; evidence counts | HIGH if main-PC has parallel belief store |
| Citizen state | `citizens` | SQLite | No | Optional cols for cognition metadata preferred in `cognition_state` | `upsertCitizen` | `getCitizen` | Keep | HIGH |
| Events | `events` | SQLite | No | No | `appendEvent` | `recentEvents` | Keep (append-only) | MEDIUM |
| Commitments | None | — | **Yes** `commitments` | **Yes** v2 | create/update/complete | by citizen / id | Keep ACTIVE+history | MEDIUM/HIGH |
| Learned behavior evidence | None | — | **Yes** `learned_behavior_evidence` | **Yes** v2 | insert evidence (idempotent by eventId+dimension) | list by citizen → derive summary | Keep; decay at read time | MEDIUM |
| Mood/affect | None | — | Stored on `cognition_state` | **Yes** v2 | mood update | load cognition state | Keep latest | MEDIUM |
| Current high-level goal | `citizens.current_goal` (mixed with planner) | citizens + cognition_state | Prefer `cognition_state.current_high_level_goal` | **Yes** v2 | deliberation result | restore after restart | Keep | HIGH — do not overwrite physical task fields blindly |
| Cognition cooldown metadata | Runtime maps only | — | **Yes** `cognition_state` | **Yes** v2 | after deliberation | adapter prepare | Keep | MEDIUM |
| Model usage counters | `llm_calls` log | SQLite append log | No new required; budgets derived from `llm_calls` + optional window counters | Optional helper views | `logLlmCall` | count per citizen/window | Keep log | LOW/MEDIUM |
| Brain event idempotency | None | — | **Yes** `brain_applied_events` | **Yes** v2 | mark applied in txn | exists check | Keep | LOW |

## Crash / reconciliation semantics

1. **Minecraft first:** physical verification (inventory delta, transfer event) is observed in-world.
2. **Then durable brain txn:** event append + commitment/relationship/learned/idempotency updates run inside one SQLite transaction.
3. **Not one global atomic txn with Minecraft:** if the process dies after Minecraft success but before SQLite commit, a later reconciler may re-observe inventory/events and apply once via event id idempotency.
4. **Never invent COMPLETE** without verified evidence markers / event ids.

## Forbidden during tests

- `data/civilization.sqlite`
- WORLD-LAB sqlite paths
- production migration against live DBs
