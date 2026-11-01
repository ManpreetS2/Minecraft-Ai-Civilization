# Architecture

> **Current-first-demo note (Nov 1, 2026):** The code and architecture text below still reflect legacy five-citizen, single-settlement, and colony configurations. The approved demo is **1v1 then 2v2**, with **per-citizen private cognition and per-community information boundaries**, world-verifiable survival and no forced roles. The `@civ/session-isolation` package currently has mock GPT/Claude adapters; SEC-001 manager routing remains a separate, unmerged proposal. Do not treat the diagrams or historical `three_citizen` profile here as a tested 2v2 architecture. See [current status](CURRENT_STATUS_2026-11-01.md) and the [public charter](https://github.com/ManpreetS2/Minecraft-Ai-Civilization/blob/main/project.md).


## North star

Give persistent people needs, memory, communication, physical capabilities, limited information, and meaningful decision freedom. Then watch what civilization they create.

The system **enables** civilization. It does not script one.

## Separation of concerns

```
Minecraft body  !=  citizen identity  !=  citizen cognition
```

### Minecraft body

Temporary Mineflayer runtime:

- connect / disconnect / reconnect
- movement, pathfinding, perception
- inventory, mining, crafting, building, combat, chat, containers, sleeping

A body can die, lag, or disconnect. That is not identity death.

### Citizen identity

Persistent simulation entity stored in SQLite:

- id, name, minecraft username
- status, last known position, health, hunger
- occupation, home, current goal
- seeded personality traits (optional JSON; restart/respawn safe)
- memories, relationships, history
- per-citizen authorized event delivery checkpoints

Identity survives orchestrator restart.

### Cognition

Decision-making in three layers:

1. **Reflex** — no LLM (starve, flee, deposit, seek shelter)
2. **Deterministic skills / planner** — verified Minecraft actions and settlement work
3. **LLM deliberation** — occasional high-level choices only

The LLM must never steer movement every tick.

**Single model-goal dispatch contract:** validated cognition goals (`@civ/cognition` `GOALS`) are mapped to executor actions only through `dispatchCognitionGoal` / `GOAL_ACTION_MAP` in `@civ/agent-core` (`goal-dispatch.ts`). The planner must not keep a second `LLM_MAP` or treat raw goal strings as action names. Deferred goals (`help_citizen`, `rest`, `socialize`, …) execute `deferCapability` and cannot report success. Internal planner actions (`fishShore`, `mineOre`, `claimHome`, …) remain deterministic and are outside the LLM goal contract. See [MISSION009_GOAL_DISPATCH.md](./MISSION009_GOAL_DISPATCH.md).

**Runtime integrity (Mission 010):** `source === "llm"` plans are enforced at planner exit and again at `executePlan` via `enforceModelOriginatedPlan`. Action events record `dispatchIntegrity` (`allowlisted` | `rewritten_fail_closed`). Reflex, human-directive and construction-resume plans are not rewritten. See [MISSION010_DISPATCH_INTEGRITY.md](./MISSION010_DISPATCH_INTEGRITY.md).

**Autonomy precedence (Mission 010B):** Allowlisted model proposals are accepted before routine daytime housing and before night-default shelter when no immediate hostile threat exists. Safety reflexes, construction resume, and curfew still win when applicable. `modelProvenance` records accept / safety-override / reject / backoff / absent. See [MISSION010B_AUTONOMY_PRECEDENCE.md](./MISSION010B_AUTONOMY_PRECEDENCE.md).

**Cloud cognition (Mission 011):** Optional OpenAI Responses API adapter implements the same `CognitionProvider` interface. Enabled only when `LLM_PROVIDER=openai` **and** `LLM_ENABLED=true` **and** `CLOUD_LLM_ENABLED=true` with a non-empty `OPENAI_API_KEY`. `OLLAMA_ENABLED` never enables cloud billing. See [MISSION011_CLOUD_PROVIDER.md](./MISSION011_CLOUD_PROVIDER.md).

**Demo identity & perspective bulletin (Mission 012):** Opt-in `DEMO_PROFILE=three_citizen` selects Atlas/Maya/Theo with shared survival objective, seeded eight-axis personalities (persistent, never silently rerolled), and a deterministic visibility-gated public bulletin (~150–250 tokens). Unknown event visibility fails closed. Delivery checkpoints are per-citizen event IDs. Traits influence cognition context as tendencies only — they never force planner actions. See [MISSION012_DEMO_IDENTITY_AND_BULLETIN.md](./MISSION012_DEMO_IDENTITY_AND_BULLETIN.md).

## Scaling (architected, not implemented at population scale)

Persistent citizen count is independent of:

- graphical Minecraft windows
- permanent Mineflayer connections
- LLM instances

Example later: 100 identities, 30 active bodies. Distant people can run at lower simulation detail. Do not block that future.

## One shared world

One Paper server. Human + AI join the same world. Mineflayer bots are protocol clients, not graphical game instances.

### Colony spawn rules (not Peaceful)

Natural **MONSTER** spawning is disabled. Keep survival hunger, passive animals, villagers, and normal day/night.

- `spawn-monsters=false` in `server.properties` (requires Paper restart)
- Bukkit/Paper monster spawn limits and ticks = 0
- Difficulty stays **easy** (or at least not Peaceful)
- Do **not** use `gamerule doMobSpawning false` as the colony lever — that also stops animals
- Existing hostiles may be purged **once** when enabling colony mode (`enableColonyMode`)
- Hostile-mob **body** support stays: controlled combat tests, optional expeditions, scripted/emergent events via `/summon`

Stale entity targeting is generic: if a tracked entity dies, despawns, or is removed, the body records `TARGET_DEAD` or `ENTITY_REMOVED`, clears the target, cancels actions that need that entity, refreshes perception, and does **not** describe it as merely "out of range".

## Action verification

Never trust a claimed success.

```
goal -> plan -> execute -> observe -> verify -> retry / recover / fail
```

Every skill returns a structured `ActionResult`. Failures emit events and can be retried or replanned. Silent success is a bug.

## Packages

| Package | Role |
| --- | --- |
| `@civ/shared` | Types, config, events, result helpers |
| `@civ/minecraft-adapter` | Mineflayer body, reconnect, locks |
| `@civ/skills` | Verified skills with timeouts and cancellation |
| `@civ/agent-core` | Identity, persistence, survival, settlement, orchestrator |
| `@civ/cognition` | LLM provider abstraction + validation |
| `@civ/memory` | Typed citizen memory, objective event log, retrieval, optional embeddings |
| `@civ/psychology` | Appraisal, affect, local social beliefs, habits, cognition context |
| `@civ/society` | Relationships and conversation triggers |
| `@civ/orchestrator` | CLI, simulation loop, HTTP/WS dashboard API |
| `@civ/dashboard` | Local observer UI |

## Persistence

SQLite (`data/civilization.sqlite`) for the MVP. Citizen identity migrations live in `@civ/agent-core`. Cognitive history (memories, appraisal, associations, local social evidence) lives in `@civ/memory` as `CognitiveStore`, which can attach to the same Database later. See [COGNITIVE-FOUNDATION.md](./COGNITIVE-FOUNDATION.md).

## Events

Structured events (`CitizenConnected`, `TaskFailed`, `LLMDecisionMade`, …) are stored and streamed to the dashboard. This is the debugging spine of the project.

Event payloads may include `visibility` metadata. The observer receives the full audit log; citizens receive only authorized bulletin lines. Missing/unknown visibility is never treated as world-public for citizens.

## Security

Agents may act inside Minecraft through skills. They must not receive:

- shell / filesystem / arbitrary JS or Python
- host credentials
- unrestricted internet
- execution of model-generated code
