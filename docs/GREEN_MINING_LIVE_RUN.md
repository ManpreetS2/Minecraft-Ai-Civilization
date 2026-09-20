# GREEN mining live run (MineProbe coal)

Date: 2026-09-19 (evening, local)  
Owner: Agent GREEN  
Harness: `pnpm mechanics:mine` → `apps/orchestrator/src/live-mine-test.ts`  
Guards: `apps/orchestrator/src/mine-test-guard.ts`  
Skill: `packages/skills/src/mine.ts` `mineKnownOre`  
This is a **live** result. Unit tests (81 targeted) are not this PASS.

## Verdict

**MINING LIVE TEST: PASS**

World and item evidence below. SEARCH_EXHAUSTED was not used. Ore was not `/setblock`. Coal was not `/give`. Hidden RED survey cells were not passed into MineProbe.

## Lab and exclusive access

| Check | Result |
| --- | --- |
| Paper | **1.21.11-132** `c5eb079` on **127.0.0.1:25567**, RCON **25577** |
| Ports 25565 / 25566 | Closed during preflight |
| `list` before launch | 1 player: **Shadowskiii1**. No HomeProbe / FarmProbe / MineProbe / MechProbe |
| BLUE | HomeProbe last joined **20:06:33** and disconnected **20:06:39** (movement pad ~200,67,400). Idle at MineProbe start **20:09:45** |
| `forceload query` after | **0** leftover chunks |
| `pnpm sim:start` | Not started |

Preflight spectator (RCON `data get entity Shadowskiii1 Pos`) was **[-954.48, 59.87, 928.22]** — outside the approved integer box X **-961..-945**, Y **56..62**, Z **937..953**.

At **20:09:26** the human ran `/tp @s -954 58 944` and entered the pocket **after** preflight and **before** MineProbe spawn. The run still completed. They later left; post-run Pos was **[-1046.8, 79.4, 816.1]** (village, not the pocket).

## Approved bound actually used

| Env | Value |
| --- | --- |
| `MINE_TEST_ORIGIN` | **-953,58,945** (standing cell; harness tp `-952.5 58 945.5`) |
| `MINE_TEST_RESOURCE` | coal |
| `MINE_TEST_RADIUS` | 8 |
| `MINE_TEST_MIN_Y` / `MAX_Y` | 56 / 62 |
| `MINE_TEST_CHEST` | **-954,58,944** |
| `MINE_TEST_PLACE_CHEST` | true (not exercised; chest already present) |
| `MINE_TEST_USER_APPROVED` | true (Task 03 listed this chest and origin) |
| `MINE_TEST_RED_APPROVED` | true (RED handoff) |
| `MINE_TEST_BLUE_IDLE` | true |
| Username | MineProbe |

## Chest

RED RCON at **20:09:06** changed **-954,58,944** (world-lab `latest.log`: `Changed the block at -954, 58, 944`) **before** MineProbe joined. GREEN `identifyBlock` then saw a container and **did not** `setblock` a chest in this run.

Post-run RCON:

- `execute if block -954 58 944 minecraft:chest` → **Test passed**
- `data get block -954 58 944 Items` → `[{Slot: 0b, id: "minecraft:coal", count: 1}]`

## MineProbe transcript (actual)

Connect spawn was village-adjacent `(-1026.5, 64.0, 834.5)`; TEST_CONTROL then:

1. `op MineProbe`
2. `tp MineProbe -952.5 58 945.5` → Teleported to **-952.5, 58.0, 945.5**
3. `clear` (empty)
4. `give MineProbe minecraft:wooden_pickaxe 1` — **one finite wooden pickaxe**, not silk-touch, not `/give coal`

Harness stdout:

```
- PASS server version 1.21.11  Paper 1.21.11-132-ver/1.21.11@c5eb079
- PASS mine visible natural ore (4760ms) mined coal_ore at -953,58,946 collected={"coal":1} deposited=1
- PASS ground-truth after discovery only (1ms) post-mine -953,58,946 is air
- PASS inventory or chest delta (0ms) coal inventory 0->0
discoveredAfterMine -953,58,946
elapsedMs=7996
exit_code: 0
```

Inventory 0→0 is expected: the coal was **deposited**, not left on the hotbar.

## Independent world evidence (after disconnect)

RCON, not citizen knowledge before the dig:

| Cell | After |
| --- | --- |
| **-953,58,946** (discovered ore) | **air** (`coal_ore` test failed) |
| **-953,58,945** origin stand | air on **stone** at `-953,57,945` |
| **-954,58,944** | **chest** with **1 coal** |
| Tannery **-1038,65,839** | still `chest` |
| Farm `20,68,240` | chunk **not loaded** this pass (no forceload used) |
| Site C H1 **bed** `-1097,69,728` | not a chest cell (expected; not overwritten) |

The discovered cell **-953,58,946** is inside radius 8 of origin and Y 56–62. It is **adjacent** to the standing origin. The probe selected it with Mineflayer `findBlocks` + exposed/LOS/reachable filters after teleport. RED's hidden survey listed this cell among pocket coal; those coordinates were **not** supplied as `MINE_TEST_ORIGIN` or planner input.

Drop `coal` (not `coal_ore`) matches a wooden pickaxe harvest without Silk Touch.

## Tool / pathing / failures

| Topic | Evidence |
| --- | --- |
| Tool | One wooden pickaxe given. Held at dig time (skill `equipToolForBlock` / harvest check). Offline MineProbe inventory not RCON-readable after disconnect; durability leftover **not** measured. |
| Pathing | Origin stand was already in reach of `-953,58,946`. No PATH_BLOCKED / HAZARD_BLOCKED / STUCK. Elapsed mine stage **4760 ms**. |
| Failures | None in harness stages. |
| Cheats unused | No `/setblock` ore, no `/give coal`, no `canDig` navigation, no teleport through hazards after origin tp. |

## Restore

| Control | Status |
| --- | --- |
| MineProbe | Disconnected **20:09:53** |
| `deop MineProbe` | Restored after the run |
| Forceload | 0 |
| Test chest **-954,58,944** | **Left in place** with 1 coal (approved fixture, not a temporary op flag) |
| Mined ore cell | Left as **air** (real dig) |
| Site C / H1 furniture / farm rectangle | Not edited by this harness |

## What this is not

- Not a unit-test PASS.
- Not a two-bot PASS. HomeProbe was offline. Concurrent HomeProbe+MineProbe was **not** run.
- Not a five-citizen civilization run.
