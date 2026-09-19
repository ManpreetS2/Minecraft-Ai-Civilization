# BLUE agriculture test plan — 3×3 physical farm

Date: 2026-09-19  
Companion: [BLUE_AGRICULTURE_AUDIT.md](./BLUE_AGRICULTURE_AUDIT.md)

This plan is for an **isolated Paper 1.21.11** world. It is **not** a live PASS. Do not run it on 25565 or 25566. Do not fabricate growth, harvest, bread, or chest contents.

---

## Target environment (Agent RED)

Use **world-lab** only:

| | |
| --- | --- |
| Path | `minecraft_ai_sim/world-lab` |
| Paper | 1.21.11-132 (same jar family as live, not upgraded) |
| Listen | **127.0.0.1:25567** |
| RCON | **25577** (password in `world-lab/server.properties`; do **not** use live 25575) |
| Seed | `20260919` |
| Spawn protection | 16 — farm pad must be outside that radius |

**Not this test:** live `server/` :25565; Mindcraft :25566 (1.21.4).

BLUE inspected lab logs: the world **has been generated** and a human operator joined. BLUE **did not** connect FarmProbe, start/stop Paper, or place blocks.

### RED must provide before a live run

1. Lab Paper **idle** (no construction session, operator not standing on the intended pad).
2. Confirm 25565 is not the destination. Confirm 25566 is not used “because a test server is up.”
3. Optional but useful: `FARM_TEST_ORIGIN=x,y,z` for 3×3 **soil** origin on plains, next to water, **outside spawn-protection 16**. If omitted, the harness offsets +20 X from probe spawn and RCON-fills a grass pad (logged as `TEST_CONTROL`, not citizen construction).
4. Explicit consent flags (both required or the process exits without connecting):

```
MECHANICS_FARM_TEST_ENABLED=true
FARM_TEST_ALLOW_WORLD_MUTATION=true
FARM_TEST_PORT=25567
FARM_TEST_RCON_PORT=25577
pnpm --filter @civ/orchestrator mechanics:farm
```

Optional: `FARM_TEST_GROWTH_MS` (default 180000), `FARM_TEST_RANDOM_TICK_SPEED` (only if you accept documented tick acceleration; restored to 3 afterward).

BLUE will not start `start.bat`, will not stop lab/live Paper, and will not run the command against 25565.

---

## Probe identity

| | |
| --- | --- |
| Username | `FarmProbe` (reserved; not a citizen) |
| Skills | production `@civ/skills` farm/inventory/craft |
| Food origin | **Finite test controls only**, logged: `/give wooden_hoe 1`, `/give wheat_seeds 16`, then `clear` first. **No** `/give wheat`, **no** `/give bread`, **no** `/give cooked_beef`. Harvested wheat and crafted bread must come from the field. |

---

## Scenario (must happen in-world)

1. **Access.** Probe has a hoe, wheat seeds, water, and a bounded 3×3 of dirt/grass (fixture or `findTillablePlot`).
2. **Till.** `tillAndPlantPlot` / `tillSoil` turns all nine soil cells into `farmland` (block names recorded).
3. **Plant + verify.** Each cell above farmland is `wheat` after plant; seed inventory decreases.
4. **Grow.** Wait on **Minecraft random ticks**. Do not `setblock wheat[age=7]` for this stage. Optional `randomTickSpeed` is a labeled test control, not a fake inventory.
5. **Harvest + pickup.** `harvestPlot` / `harvestCropAt` only if `inspectCrop` reports mature (age ≥ 7). Wheat and seed **inventory deltas** must rise. Immature cells must not be dug.
6. **Replant.** After harvest, farmland still present and wheat replanted where seeds remain.
7. **Bread.** `craftItem("bread")` only if harvested wheat ≥ 3. Wheat consumed by 3, bread count +1. Skip as **UNVERIFIED** if harvest yielded too little — do not `/give wheat`.
8. **Chest + eat.** Deposit bread into the fixture chest (container counts). Withdraw. Hunger test-control (`effect hunger`) then `eatFood`. Bread count down, hunger up. Skip eat if bread never existed.

Track: before/after block names for the 9 cells + water + chest; inventory deltas; chest contents; ActionResult failures; wall-clock `elapsedMs`.

---

## Pass / fail / unverified rules

| Result | Meaning |
| --- | --- |
| **PASS** | That stage’s world or inventory assertion succeeded on this Paper session |
| **FAIL** | Skill ran and the world/inventory contradicted the claim |
| **UNVERIFIED** | Stage not executed or timed out without fabricating (e.g. crops never reached age 7) |
| **SKIP** | Fixture missing (no RCON) |

A general historical farm gauntlet PASS must not be copied into this scorecard.

Timeout on growth → **UNVERIFIED**, not FAIL-with-fake-wheat.

---

## What the harness will not do

- Start or stop Paper (`AUTO_START_PAPER` forced off; no `ensurePaper`).
- Connect to 25565 or 25566 (`evaluateFarmTestLaunch`).
- Use live RCON 25575 for a lab port.
- `/give` harvest products or bread.
- Assign a farmer, equalize rations, or spawn food into citizen inventories.
- Touch live `server/world` or RED’s uncommitted compact-hut files.

---

## Unit coverage (always runnable, not live)

- `packages/skills/src/farm.test.ts` — maturity, tillable names, 3×3 cells, hydration, plot selection.
- `apps/orchestrator/src/farm-test-guard.test.ts` — refuse 25565/25566; require both flags.
- `packages/agent-core/src/planner.test.ts` — `experimentWorkAssignment` off/on; no `Assigned to obtain food` without a role.
- `packages/minecraft-knowledge/src/recipes-121.test.ts` — bread = 3 wheat.

Live 3×3 remains **UNVERIFIED** until RED’s lab is idle and the command above is actually run.
