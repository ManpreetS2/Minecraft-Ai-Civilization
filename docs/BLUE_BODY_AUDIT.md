# BLUE body audit

Date: 2026-09-19  
Auditor: Agent BLUE  
Repo: `<WORKSPACE>`  
Branch: `integration/first-settlement-v2`  
HEAD: `77e5c67` — *Prove Body Engine V1.1 survival skills on live Paper without replacing V1.*  
Working tree: **dirty** (colony-world / structures / compact-hut / entity-target WIP). BLUE did **not** edit those files.

This is an inspection report. It is **not** a live Minecraft pass. Unit tests are not live Paper verification.

---

## 1. Architecture (preserved)

```
Minecraft body  !=  citizen identity  !=  citizen cognition
```

- Mind decides WHAT / WHY.
- Body executes HOW through bounded skills and `ActionResult` verification.
- One production body stack: `@civ/minecraft-adapter` + `@civ/skills` + Mineflayer 4.x + mineflayer-pathfinder 2.4.5 + mineflayer-tool 1.2.0, Paper **1.21.11** at `127.0.0.1:25565`.
- MechProbe is a disposable mechanics dummy. It is **not** a citizen. Reserved names include `MechProbe`, `MechProbeB`, `MindcraftProbe`, `PhoenixProbe`.
- `pnpm sim:start` must not spawn probes. Citizens are Atlas, Maya, Theo, Ava, Kai (`DEFAULT_CITIZENS`: name + id only).

Do not replace this stack with Mindcraft, Phoenix, Astra, collectblock-as-plugin, or Baritone.

---

## 2. Implementations that actually exist

| Implementation | Path | Role | Paper | Live evidence |
| --- | --- | --- | --- | --- |
| **MechProbe / Body Engine V1 + V1.1** | this repo `apps/orchestrator/src/live-mechanics-test.ts`, `@civ/skills`, `@civ/minecraft-adapter` | **Production body** | 1.21.11 `:25565` | Documented PASS/FAIL in `docs/LIVE-MECHANICS-TEST.md` and `docs/MINECRAFT-BODY-CAPABILITY-MATRIX.md` (2026-09-17/18). BLUE did not re-run live. |
| **Five-citizen orchestrator** | `@civ/agent-core` `manager.ts`, `pnpm sim:start` | Identity + planner + body attach | same | Code exists. **No BLUE-confirmed live 5-bot run.** Docs still say citizens stayed offline during MechProbe gauntlets. |
| **Mindcraft (bakeoff)** | `<LOCAL_MINDCRAFT_UPSTREAM>` @ `5f3acc87` | Bakeoff only | 1.21.11 `:25565` | Walk/logs/chest/door/place PASS; wooden_pickaxe FAIL (lost table). **Not adopted as runtime.** |
| **MindcraftProbe (later body patches)** | `<LOCAL_MINDCRAFT_BODY>` | Separate experiment | **1.21.4 `:25566`** | Unit 57/57; visual gates unsigned; INCIDENT-001 `TASK_STATE_DEADLOCK`. **Not equivalent conditions. Not production.** |
| **PhoenixProbe** | `<LOCAL_PHOENIX>` @ `91618523` | Bakeoff only | 1.21.11 | Connects; fake `completed` with 0 items; default `canDig=true`. **Rejected.** |
| **minecraft-for-astra** | `<LOCAL_ASTRA_BODY>` | AIRI/mineflayer tools for Astra LLM | claims 1.8.8–1.21.11 | README + `npm test` without Minecraft. **Astra was not started. Not a civilization body.** |
| **Mindcraft QA harness** | `<LOCAL_MINDCRAFT_QA>` | Localhost observability for MindcraftProbe | n/a | Observes `:8080` Mindcraft, not `@civ` skills. |
| **minecraft_agent_swarm_fork** | Desktop sibling | Unrelated swarm fork | — | Not the production body. |

Neither Mindcraft nor Astra trees are vendored into this repo. Bakeoff decision: keep **ours**.

---

## 3. Claimed vs unit vs live

Statuses below are from **repo documents and code**, not a new Paper session. BLUE ran Vitest only (see §9).

### Production body (MechProbe), documented live Paper 1.21.11

**LIVE PASS (do not inflate):** walk with `canDig=false`, 1-block pit escape, stairs/slabs/gates/sprint, wooden door open+walk, inventory snapshot, equip, drop/pickup, chest deposit/withdraw, probe-to-probe toss transfer, log→planks→sticks→table→wooden pickaxe, mine stone + cobble pickup, stone/iron pickaxe, axe/sword, eat (hunger delta), sleep (`isSleeping`), zombie/skeleton/spider, creeper flee, hunt cow/pig/chicken, wheat harvest+replant+till, cook beef, smelt iron, iron armor equip, villager trade, 3×3 shelter + doorway + roof, 5×5 enclosure.

**LIVE FAIL (honest):** leave water; ladder up; ladder down. Bounded `climbLadder` exists; prismarine-physics on 1.21.11 did not produce usable Y displacement.

**LIVE PARTIAL:** swim/enter water.

**Not live-verified for five concurrent citizens:** occupancy under five pathfinders, village door loops, shared chests, keepalive with five Mineflayer clients, death-drop recovery, using a human village without mining it.

### Unit-only (not live)

Path recovery/blacklist, occupancy maps, placement purpose rejection, recipe parser, inventory reservations, death `DEAD` reconnect refuse, keepalive classified as reconnect not death, shelter classify, planner reflexes.

### Later MindcraftProbe (1.21.4) — not a civ live claim

Tool/placement/collect ActionResult, doors, containers UNKNOWN until open, hybrid vision. Visual gates **NEEDS VISUAL**. Stuck incident: primary `BUILD_STRUCTURE` ACTIVE, ActionManager idle, self-prompter Thinking.

---

## 4. Physical capability inspection (code + documented live)

| Capability | Production code | Unit | Documented live | Gap for a starter village |
| --- | --- | --- | --- | --- |
| Navigation `canDig=false` | `pathing.ts` `SAFE_NAVIGATION` | PASS | PASS open/uneven | Deep wells fail-fast (village hole ~223,60,184). Correct: do not excavate. |
| Local unstuck | `local-escape.ts` | PASS | PASS 1-block pit | 1.0 full lip jump unreliable |
| Door | `doors.ts` `openDoor` + pathfinder `canOpenDoors` | PASS | PASS | Iron doors rejected. `closeDoor` toggles via activate; not a village soak. |
| Gate | `openFenceGate` | PASS | PASS | — |
| Resource collect + drop pickup | `collectResource` + `pickupDroppedItem` | PASS | PASS wood/stone | Collectblock **not** loaded (would `canDig=true`) |
| Tool selection | `mineflayer-tool` `equipForBlock` + knowledge fallback | PASS | PASS | — |
| Container inspect | `openContainer` approaches chest; deposit/withdraw verify counts | PASS | PASS deposit/withdraw | No UNKNOWN-until-open curiosity layer like MindcraftProbe. Contents after open are Mineflayer truth. |
| Deposit | `depositItem` / `depositItems` | PASS | PASS | Five citizens sharing one village chest: **not live** |
| Eat | `eatFood` | PASS | PASS | Planner times it; auto-eat plugin not loaded |
| Sleep | `world.ts` `sleep` | PASS | PASS `isSleeping` | Needs valid night + bed; open-field bed rejected |
| Cancel | `AbortController` per citizen tick; skills check `ctx.signal`; `stopPathfinding` | unit/partial | not a dedicated live cancel suite | Must prove STALE/INTERRUPTED under five bots |
| Path recovery | `path-recovery.ts` y±1, blacklist, occupancy | PASS | pit + PATH_FAILED well | Occupancy is in-process; five clients not live-proven |
| Craft 2×2 / 3×3 | `obtainItem` named recipe | PASS | PASS | Do not import Mindcraft/Phoenix craft |
| Combat/hunt/farm/smelt | skills + gauntlet | mixed | PASS on pad | Colony mode disables natural monster spawn; hunger stays on |
| Death identity | `SIM_PERMADEATH_ENABLED` default **false**; `allowRespawn: true`; `CitizenBodyDied` + respawn | unit | **not live-signed for citizens** | No death-drop walk-back/pickup in this repo |
| Vision screenshots | not in `@civ` body | — | — | Structured Mineflayer observation only |

---

## 5. Smallest remaining gaps for five citizens in a starter village

Ordered by what actually blocks “five bodies in one human village” — not economy, government, or full autonomous cities.

1. **Five concurrent Mineflayer clients on Paper 1.21.11.** MechProbeB already caused a keepalive disconnect during transfer. Five citizens is unproven. This is the first multi-body risk.
2. **Village terrain, not the sky pad.** Wells, water, fences, doors, slabs, human houses. Pad PASS does not equal village PASS. Water exit and ladders are already live FAIL.
3. **Do not mine or claim human-provided structures as AI construction.** `SAFE_NAVIGATION` helps. `getNearestFreeSpace` / Phoenix dump-at-feet are banned. Existing-shelter use is planner-level (`seekSafety` when `shelterComplete`); live “enter the human house through the door, do not dismantle it” is **not** a signed five-citizen test.
4. **Shared containers.** Deposit/withdraw works for one probe. Concurrent inspect/loot/deposit needs occupancy + reservations live.
5. **Action cancel / generation.** Abort exists in code. A live “start path, cancel, old completion is stale, stay online” for a citizen is missing.
6. **Death: identity vs loot.** Development permadeath is **off**. Identity should survive respawn (`applyTemporaryBodyDeath` / `applyBodyRespawn`). Dropped items are **not** recovered by a skill. `death.test.ts` still documents a **permanent** `/kill Kai` experiment — that is permadeath-on, not the development default.
7. **Preset work roles.** `assignWorkRoles` maps citizen index → wood/food/stone/tools/build. Identities are not seeded with occupations, but the planner **does** assign jobs by roster order. That conflicts with “do not assign initial jobs.” Survival reflexes still override.
8. **Compact-hut / blueprint WIP** on the dirty tree currently **fails unit tests** (hut width, missing crafting_table in materials). Do not ship five-citizen building until HEAD or a finished RED patch is green. BLUE did not change blueprints.

Non-blockers for a first village day: vines, scaffolding, LLM, marriage, economy, vision.

---

## 6. Policy already in code (do not regress)

- `NORMAL_NAVIGATION_CAN_DIG=false`.
- Placement requires purpose (`doorway`, `household_storage`, `shelter_blueprint`). Open-field bed/door/table rejected.
- World/inventory verify; timeout ≠ success if counts did not change.
- Keepalive timeout ≠ citizen death.
- Village chest observation does not imply ownership (`villageChestImpliesOwnership() === false`).
- Probe names never enter `DEFAULT_CITIZENS`.
- Do not enable insecure coding / model-generated JS.

---

## 7. Working tree (not BLUE)

Uncommitted at audit time includes: `colony-world.ts`, `structures.ts`, `blueprint-build.ts`, `entity-target.ts`, compact hut in `blueprint.ts`/`construction.ts`, combat/trade/pathing tweaks, `live-mechanics-demo.ts`.

Treat as **in-progress, not accepted**. Four Vitest failures are in that WIP (see §9). BLUE did not fix them (would interfere with Agent RED).

---

## 8. Other sandboxes — do not mix servers

| Server | Use |
| --- | --- |
| `127.0.0.1:25565` Paper 1.21.11 | Civilization + MechProbe |
| `127.0.0.1:25566` Paper 1.21.4 | MindcraftProbe experiment only |
| Astra plugin | Do not start for this civilization |

Dashboard port **3000** is the civ observer. Mindcraft/prismarine have also used 3000/8080. Do not collide.

---

## 9. Unit tests BLUE actually ran

Command: `pnpm test` in `minecraft_ai_sim` on 2026-09-19 (working tree, no Paper).

```
Test Files  3 failed | 40 passed (43)
Tests       4 failed | 232 passed (236)
```

Failures (all uncommitted WIP):

| File | Failure | Note |
| --- | --- | --- |
| `packages/agent-core/src/blueprint.test.ts` | `materials.crafting_table` undefined, expected 1 | Compact-hut change |
| `packages/agent-core/src/execution-engine.test.ts` | `starterHutSize().width` 4, expected 5 | Same WIP |
| `packages/shared/src/entity-target.test.ts` (×2) | message contains the words “out of range” inside “not out of range” | Over-strict regex |

**Do not mark any of the above as live Minecraft success.**

Paper was **not** listening on `:25565` during this audit. BLUE did not start it.

---

## 10. Production body verdict

Use **MechProbe / `@civ` skills** as the five-citizen body. Do not silently swap in MindcraftProbe or Astra.

Mindcraft/Phoenix bakeoff is already done on equivalent 1.21.11 conditions. Mindcraft later patches on 1.21.4 are a different experiment.

Next action is **not** a rewrite. It is the isolated live test in `docs/BLUE_BODY_TEST_PLAN.md`.
