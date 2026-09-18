# Minecraft body capability matrix

Physical body facts only. MechProbe is **not** a citizen. Atlas / Maya / Theo / Ava / Kai stayed offline.

Statuses: **PASS**, **FAIL**, **PARTIAL**, **NOT TESTED**.

LIVE PAPER is never marked PASS from unit tests. Combined Paper 1.21.11 evidence from `pnpm --filter @civ/orchestrator mechanics` on 2026-09-17/18, branch `integration/first-settlement-v2`. Navigation remains `canDig=false`.

Known-good V1 SHA at start of this pass: `701e9c66e4746903a4efd2094ecdfe0c2b8382ea`.

| Capability | UNIT | LIVE PAPER | Implementation | Upstream dependency | Verification | Failure / limitation | Next action |
| --- | --- | --- | --- | --- | --- | --- | --- |
| walk | PASS | PASS | `moveToPosition` SAFE_NAVIGATION | mineflayer-pathfinder 2.4.5 | 15.6 / 11.0 displacement, 0 unrelated breaks | deep wells still fail-fast | keep |
| sprint | PASS | PASS | control-state sprint | Mineflayer controls | displacement ≥ 2 | not a pathfinder sprint goal | keep |
| jump | PASS | PASS | local-escape + jump | Mineflayer | pit exit 2.9 | 1.0 full lip unreliable | keep |
| step-up | PASS | PASS | pathfinder | mineflayer-pathfinder | dy ≥ 0.6, no mining | — | keep |
| drop-down | PASS | PASS | pathfinder | mineflayer-pathfinder | dy down | — | keep |
| stairs | PASS | PASS | pathfinder | mineflayer-pathfinder | oak_stairs walk | — | keep |
| slabs | PASS | PASS | pathfinder | mineflayer-pathfinder | oak_slab walk | — | keep |
| swim / enter water | — | PARTIAL | pathfinder liquidCost | mineflayer-pathfinder | entered water (y≈89) | 1.21.11 swim/stick reports | physics |
| leave water | — | FAIL | pathfinder + local-escape + jump | mineflayer-pathfinder | still y≈89.3 | Paper 1.21.11 liquid exit | physics |
| door | PASS | PASS | `openDoor` + canOpenDoors | pathfinder | walk through | — | keep |
| gate | PASS | PASS | `openFenceGate` | pathfinder canOpenDoors | walk through | — | keep |
| ladder up | PASS helper | FAIL | `climbLadder` jump+forward | Mineflayer controls; pathfinder climbables unused in practice | ΔY 0.00–0.16 | prismarine-physics 1.21.11 does not climb | physics |
| ladder down | PASS helper | FAIL | `climbLadder` sneak | Mineflayer controls | ΔY −0.38 | same | physics |
| inventory snapshot | PASS | PASS | `snapshotInventory` | Mineflayer | 64 oak_log / stackSize 64 | — | keep |
| equip | PASS | PASS | `equipItem` | Mineflayer equip | held wooden_pickaxe; armor slots | — | keep |
| drop quantity | PASS | PASS | `dropItem` toss | Mineflayer toss | 64→59 | — | keep |
| drop stack | PASS | PASS | `dropStack` | Mineflayer tossStack | 59→0 then pickup | — | keep |
| pickup | PASS | PASS | `pickupDroppedItem` | Mineflayer item entities | oak_log and stick + | — | keep |
| capacity | PASS | PASS | `freeCapacity` / `canReceive` | minecraft-data stack sizes | INVENTORY_FULL | — | keep |
| deposit | PASS | PASS | `depositItem` | Mineflayer chest | citizen/container delta | — | keep |
| withdraw | PASS | PASS | `withdrawItem` | Mineflayer chest | inventory + / full refuse | — | keep |
| transfer | PASS model | PASS | `transferItemToCitizen` | toss + peer pickup | giver 12→4, receiver 0→8 | keepalive risk if peer lingers | keep |
| mine stone | PASS | PASS | `collectResource` | mineflayer-tool 1.2.0 | cobble + | — | keep |
| mine iron | PASS | PASS | `collectResource` iron_ore | mineflayer-tool requireHarvest | raw_iron then smelt | — | keep |
| collect drops | PASS | PASS | shared `pickupDroppedItem` | Mineflayer | combat/hunt/farm/mine | one collector | keep |
| craft 2x2 | PASS | PASS | `obtainItem` | minecraft-data | planks/sticks | — | keep |
| craft 3x3 | PASS | PASS | `obtainItem` table | minecraft-data | pickaxes / armor | — | keep |
| wood pickaxe | PASS | PASS | `obtainItem` | minecraft-data | item exists | — | keep |
| stone pickaxe | PASS | PASS | `obtainItem` | minecraft-data | item exists | — | keep |
| iron pickaxe | PASS | PASS | `obtainItem` | minecraft-data | item exists | — | keep |
| axe | PASS | PASS | `obtainItem` iron_axe | minecraft-data | item exists | — | keep |
| sword | PASS | PASS | `obtainItem` iron_sword | minecraft-data | item exists | — | keep |
| eat | PASS | PASS | `eatFood` | Mineflayer consume | hunger 0→eat | no auto-eat plugin | keep |
| sleep | PASS | PASS | `sleep` | Mineflayer sleep | isSleeping | — | keep |
| zombie | PASS allowlist | PASS | `attackHostile` | Mineflayer attack | killed | no mineflayer-pvp | keep |
| skeleton | PASS allowlist | PASS | close then attack | Mineflayer attack | killed | — | keep |
| spider | PASS allowlist | PASS | moving melee | Mineflayer attack | killed | cobble-roofed pen | keep |
| creeper flee | PASS allowlist | PASS | `fleeCreeper` NO_LLM | pathfinder + sprint | distance increased | do not auto-attack | keep |
| hunt cow | PASS allowlist | PASS | `huntAnimal` | attack + pickup | death + drops | capability, not culture | keep |
| hunt pig | PASS allowlist | PASS | `huntAnimal` | attack + pickup | death + porkchop | first flake, retry PASS | keep |
| hunt chicken | PASS allowlist | PASS | `huntAnimal` | attack + pickup | death + drops | — | keep |
| harvest wheat | PASS age 7 | PASS | `harvestCrop` mature only | dig | world + inventory | immature left in place | keep |
| replant wheat | PASS | PASS | `plantCrop` | activate farmland | wheat present | — | keep |
| farm creation | PASS | PASS | `tillAndPlant` | hoe + seeds | planted wheat | approved plot only | keep |
| cook food | — | PASS | `smeltItem` | Mineflayer openFurnace | cooked_beef + | reused furnace | keep |
| smelt iron | — | PASS | same `smeltItem` | Mineflayer openFurnace | iron_ingot + | not a second engine | keep |
| iron helmet | PASS | PASS | obtain + equip head | recipe + Mineflayer | slot | — | keep |
| iron chestplate | PASS | PASS | obtain + torso | recipe + Mineflayer | slot | — | keep |
| iron leggings | PASS | PASS | obtain + legs | recipe + Mineflayer | slot | — | keep |
| iron boots | PASS | PASS | obtain + feet | recipe + Mineflayer | slot | — | keep |
| equip armor | PASS | PASS | Mineflayer equipment | Mineflayer | slot names | LLM must not invent armor | keep |
| villager trade | PASS helper | PASS | `tradeWithVillager` | openVillager / trade | inventory delta | optional; worked this Paper | keep |
| simple shelter | PASS classify | PASS | `probeShelter` 3x3 | placeBlock + ground standing | verifyStructure | roof needs wall support first | keep |
| doorway | PASS | PASS | PlacementIntent | placeBlock | door in opening | — | keep |
| roof | PASS plan | PASS | shelter dy=3 | placeBlock | blocks present | place from ground Y | keep |
| defensive wall | PASS | PASS | V1 3-plank + fort walls | placeBlock | world cells | — | keep |
| fort/enclosure | PASS plan | PASS | `probeFort` 5x5 | placeBlock | executeStructure | 7x7 later if wanted | keep |

Vines / scaffolding: **NOT TESTED**. Not a V1.1 blocker.

Tool durability: `durabilityFromItem` / `toolDurabilityFacts`. If Mineflayer omits `durabilityUsed`/`maxDurability` on 1.21.11, `known=false` — values are not invented.

## Upstream policy (this pass)

Adopted: mineflayer-pathfinder 2.4.5, mineflayer-tool@1.2.0, minecraft-data, prismarine-block (via Mineflayer/knowledge).

Inspected, not added: mineflayer-pvp (Mineflayer `attack` + approach was enough), mineflayer-collectblock, mineflayer-auto-eat, Phoenix runtime, Mindcraft runtime, Minecraft MCP, MineColonies, Baritone.

Pathfinder still documents climbables as unused; `Movements.climbables` exists but 1.21.11 physics did not produce Y displacement. `climbLadder` is the bounded skill; it is **not** live-PASS.

## MechProbe course

Isolated pads ~174–218, y89, z134–168.

- V1 pad: 174–190, z134–156
- Gauntlet: 192–218, z134–168 (nav, ladder, combat pen, animals, farm, furnace, villager, shelter, fort)

`MECHANICS_PROBE_PRESERVE_FIXTURES=true` leaves the course. Default restores air above the grass pad after the gauntlet.

## Combined live counts (not one uninterrupted process)

A full default run hit a Mineflayer keepalive while MechProbeB disconnected. V1+inventory+transfer were already PASS. Gauntlet was then run with `MECHANICS_TEST_FILTER=gauntlet` and targeted retries.

Do not treat keepalive-interrupted V1 FAILs from the second full process as regressions; the first process in this pass was 21/21 on the V1+inventory chain.

See `docs/LIVE-MECHANICS-TEST.md` for commands.
