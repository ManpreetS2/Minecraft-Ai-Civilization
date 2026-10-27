# BLUE physical-body acceptance test plan

Date: 2026-09-19  
Companion: `docs/BLUE_BODY_AUDIT.md`  
Constraint: run only on an **isolated** Paper 1.21.11 world. Do **not** reset, launch, or edit the shared human village. Do **not** start Astra. Do **not** spawn Atlas/Maya/Theo/Ava/Kai until the connect-only five-body step.

Never mark LIVE VERIFIED from unit tests.

---

## Equivalent conditions

All comparison runs must share:

| Knob | Value |
| --- | --- |
| Server | Paper **1.21.11** |
| Bind | `127.0.0.1` (not `localhost` on this machine) |
| Port | a **free** port, not the shared `:25565` world and not Mindcraft `:25566` |
| Auth | `online-mode=false` |
| Difficulty | easy (not Peaceful — hunger must work) |
| Navigation | `canDig=false` for ordinary walks |
| Probe names | `MechProbe` / `MechProbeB` only until five-citizen connect |
| World | throwaway superflat or a **copy** of a starter village, never the live human map |

MindcraftProbe on Paper **1.21.4 `:25566`** is **not** an equivalent run.

Dashboard: keep civ observer on a free port if 3000 is taken.

---

## Implementations under test

| ID | Body | How to invoke | When |
| --- | --- | --- | --- |
| **CIV** | `@civ` MechProbe | `pnpm --filter @civ/orchestrator mechanics` | **Required.** Production candidate. |
| MIND-BAKE | Mindcraft `5f3acc87` skills.js, no insecure coding | only if a second isolated 1.21.11 pad is available | Optional regression vs `docs/BODY-ENGINE-BAKEOFF.md`. Do not replace CIV. |
| MIND-PATCH | `mindcraft_body_test` MindcraftProbe | do **not** on the civ world | Different version; out of scope for this plan. |
| PHOENIX | PhoenixProbe | **skip** | Fake success; rejected. |
| ASTRA | minecraft-for-astra tools | **skip** | Different brain; do not start Astra. |

Winner of the existing bakeoff: **CIV**. This plan proves it still holds on an isolated server, then adds multi-body village steps CIV has not live-signed.

---

## Evidence format

Each step: PASS / FAIL / SKIP / NEEDS_HUMAN_VISUAL.

Record: timestamp, username, position, ActionResult code, inventory/world delta, process still connected (yes/no), unrelated blocks broken (must be 0 for walks).

Human-provided houses, chests, farms: tag `HUMAN_STRUCTURE`. Success is **use/avoid damage**, not “we built this.”

---

## Phase A — isolated MechProbe V1 (NEXT TEST)

**This is the next live Minecraft test once an isolated server exists.**

1. Start a throwaway Paper 1.21.11. Do not touch the shared world.
2. From `minecraft_ai_sim`:

```bat
set MECHANICS_TEST_FILTER=v1
pnpm --filter @civ/orchestrator mechanics
```

3. Expect the V1 chain in `docs/LIVE-MECHANICS-TEST.md`: pit escape, walks without mining, reject purposeless bed/door/table, door, inventory, craft wooden pickaxe, mine intended stone, stone pickaxe, chest, eat, sleep, pickup.
4. Citizens stay **offline**. No Astra. No MindcraftProbe.

**PASS if:** documented V1 steps PASS and the probe process stays connected.  
**FAIL if:** any walk breaks unrelated solids, craft reports success without the item, or the process dies.

If V1 FAIL, stop. Do not open five citizens.

---

## Phase B — V1.1 gauntlet on the same isolated pad

```bat
set MECHANICS_TEST_FILTER=gauntlet
pnpm --filter @civ/orchestrator mechanics
```

Honest expected FAILs (already known, do not “fix” by mining): **leave water**, **ladder up/down**.

PASS the rest (gate, combat pens, hunt, farm, furnace, armor, villager, 3×3 shelter, 5×5 enclosure) or record regressions vs `docs/MINECRAFT-BODY-CAPABILITY-MATRIX.md`.

Restore `doMobSpawning` if the course toggled it. That toggle is **test isolation**, not colony policy.

---

## Phase C — two bodies, keepalive, cancel

Same isolated server.

1. Inventory transfer: MechProbe → MechProbeB (`MECHANICS_TEST_FILTER=inventory` or the documented transfer step). Both stay connected ≥ 60s after toss+pickup.
2. Cancel: start a long `moveTo`, abort, assert `INTERRUPTED` / path stopped, **no process exit**, a later skill still runs.
3. Stale entity: summon a chicken, kill it, `huntAnimal` / attack must return `TARGET_DEAD` or `ENTITY_REMOVED`, not “out of range.”

**FAIL if:** MechProbeB keepalive dropout, or the killer process restarts.

---

## Phase D — five-citizen connect-only

Still isolated. Copy of a small village **or** empty pad plus one human-built hut tagged HUMAN_STRUCTURE.

```
SIM_CITIZEN_COUNT=5
SIM_PERMADEATH_ENABLED=false
LLM_ENABLED=false
```

Start five identities Atlas, Maya, Theo, Ava, Kai. **No** construction mandate. **No** preset “Atlas is the builder” as a success criterion.

**PASS if:**

- five distinct usernames online
- SQLite ids `citizen_atlas` … `citizen_kai` unchanged across an orchestrator restart
- `/kill Kai` with permadeath **false**: same id reconnects/respawns; status is not terminal `dead`
- no probe names in the citizen table
- unrelated village blocks not mined during the first 3 minutes of idle/wander

**FAIL if:** one disconnect kills the orchestrator, identities merge, or the hut is broken for wood.

Do **not** score “they assigned themselves jobs” as success. `assignWorkRoles` currently maps roster order → wood/food/stone/tools/build; that is a policy bug to watch, not a feature to require.

---

## Phase E — village mechanics (five bodies, still isolated)

Run only after D PASS. One citizen at a time, then two, then five.

| ID | Setup | Directive / skill | PASS |
| --- | --- | --- | --- |
| E1 door | Closed wooden door in HUMAN hut | walk inside | opens once, crosses, stays online |
| E2 blocked door | Door that cannot open | approach | `DOOR`/`PATH` failure, stays online |
| E3 wood | Known log count | collect +8 | inventory +~8, stop, no village plank theft |
| E4 tools | Junk in hand, pickaxe in bag, stone | mine stone | pickaxe equipped, cobble gained |
| E5 chest | Village chest HUMAN_STRUCTURE | deposit 1 log | inventory/chest deltas; do not empty the chest |
| E6 eat | Hunger low, food in inv | eatFood | hunger up, food down |
| E7 sleep | Night, bed in hut | sleep | `isSleeping` |
| E8 cancel | Long path | cancel | path stops |
| E9 death loot | Known inventory, `/kill` one citizen | respawn | identity same; loot recovery is **optional** and must be recorded honestly if missing |
| E10 occupancy | Two path to same door | — | yield or sequential; no process death |

Shelter blueprint / compact hut: **SKIP** until working-tree blueprint unit tests are green. Do not treat a human house as `starterHut` success.

---

## Phase F — optional Mindcraft bakeoff replay

Only on the **same** isolated 1.21.11 pad, username `MindcraftProbe`, `allow_insecure_coding=false`, skills.js direct calls (no LLM).

Replay bakeoff A–H. Expect craft wooden_pickaxe still weaker than CIV. Do not merge Mindcraft into `@civ` because a walk PASSed.

---

## What this plan does not do

- Paper plugin installs
- Shared world reset or Agent RED world edits
- Economy, government, marriage, reproduction
- Full autonomous city construction
- Starting Astra
- Swapping the production body for Mindcraft/Astra because they look more capable in isolation

---

## Operator checklist (isolated server)

1. Confirm `:25565` shared world is **not** the target (or is stopped and unused).
2. Isolated Paper 1.21.11 up.
3. Phase A (`MECHANICS_TEST_FILTER=v1`).
4. Stop if V1 FAIL.
5. Phase B gauntlet; accept water/ladder FAIL.
6. Phase C two-body.
7. Phase D five connect-only.
8. Phase E village list.
9. File results next to this plan; do not update the capability matrix to PASS from units.
