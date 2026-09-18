# MechProbe and upstream libraries

MechProbe is the crash-test dummy. It is **not** a citizen.

## Identity (do not change)

| | |
| --- | --- |
| File | `apps/orchestrator/src/live-mechanics-test.ts` |
| Command | `pnpm --filter @civ/orchestrator mechanics` |
| Flags | `MECHANICS_PROBE_ENABLED=false`, `MECHANICS_PROBE_KEEP_ALIVE=false` |
| Username | `MechProbe` (reserved; filtered from `DEFAULT_CITIZENS`) |

Never: cognition, relationships, settlement population, ExperienceLedger as a person, planner careers.

It **does** mutate the live world (RCON give/setblock, mine, place, eat). Stop the five-citizen sim during destructive fixture runs.

## Do not replace MechProbe with MCP

[yuniko-software/minecraft-mcp-server](https://github.com/yuniko-software/minecraft-mcp-server) is **Apache-2.0** and drives a Mineflayer body from an LLM via MCP. That is the opposite of bounded skills.

Desired Cursor loop is already:

```
Cursor → pnpm --filter @civ/orchestrator mechanics → MechProbe → Paper → PASS/FAIL/SKIP
```

Adding MCP would add a second body, second pathfinder, and unconstrained tools (`build`, `explore`, chat-driven actions). **Not worth the complexity.** Optional later: a **thin** MechProbe-only HTTP/RCON helper that calls the same skills (`obtainItem`, `collectResource`) — not a public MCP that can puppeteer Atlas.

## Upstream plugins vs MechProbe

| Library | Load on MechProbe? | Why |
| --- | --- | --- |
| mineflayer-pathfinder | already via MinecraftBody | required |
| collectblock plugin | **no** | overwrites Movements; auto-chest dump |
| mineflayer-tool plugin | **no** | auto-chest tool pull |
| auto-eat `enableAuto()` | **no** | eat is an explicit case |
| mindcraft skills.js | **no** | LLM code exec + table dump |
| Phoenix createPhoenix() | **no** | second planner |

MechProbe should keep calling **our** `@civ/skills` so a PASS is evidence for citizens, not a parallel stack.

## Suggested fixture improvements (Cursor 1, optional)

- After walk, return to spawn origin before `setblock` (already done).
- Prefer `GoalNear` 8–16 blocks in several headings; treat 0 displacement + no broken solids as **nav limitation**, not a mining FAIL.
- Optional filters: `MECHANICS_TEST_FILTER=crafting|nav|doorway`.
- Sleep SKIP on `NO_INTERACTION_POSITION` is honest; do not mark LIVE sleep from SKIP.
- Optional RCON `clear MechProbe oak_door 0` as a 3x3 oracle — MechProbe-only.
- One-shot RCON: `pnpm --filter @civ/orchestrator rcon "list"`.

## Keep-alive

`MECHANICS_PROBE_KEEP_ALIVE=true` is for a human watching in-game. It must still disconnect without joining settlement state.
