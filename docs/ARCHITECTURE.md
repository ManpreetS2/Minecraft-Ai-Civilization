# Architecture

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
- memories, relationships, history

Identity survives orchestrator restart.

### Cognition

Decision-making in three layers:

1. **Reflex** — no LLM (starve, flee, deposit, seek shelter)
2. **Deterministic skills / planner** — verified Minecraft actions and settlement work
3. **LLM deliberation** — occasional high-level choices only

The LLM must never steer movement every tick.

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

## Security

Agents may act inside Minecraft through skills. They must not receive:

- shell / filesystem / arbitrary JS or Python
- host credentials
- unrestricted internet
- execution of model-generated code
