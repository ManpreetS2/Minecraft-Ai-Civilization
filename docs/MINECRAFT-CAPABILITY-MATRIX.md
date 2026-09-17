# Minecraft capability matrix

Environment: Paper 1.21.11 + Mineflayer 4.39.0 + minecraft-data 3.116.0. **LIVE PAPER VERIFIED** is only marked after a real body performed the action. Unit tests are not live proof.

Evidence: `pnpm --filter @civ/orchestrator mechanics` on 2026-09-17, probe `MechProbe`, Paper 1.21.11 at 127.0.0.1:25565. Latest green suite (exit 0) plus an earlier same-day run that walked 14.1 blocks.

| Capability | IMPLEMENTED | UNIT TESTED | LIVE PAPER VERIFIED | Known limitations |
| --- | --- | --- | --- | --- |
| Walk | yes | yes (path policy) | yes (no random mining) | `canDig=false`. 14.1-block walk verified once. Later spawn in a hole: 0 displacement, still no terrain break. |
| Jump | yes (pathfinder) | no | no | standard pathfinder jumps only |
| Sprint | pathfinder default | no | no | not explicitly toggled |
| Swim | pathfinder water cost | no | no | drowning emergency is separate NO_LLM |
| Climb | pathfinder ladders | no | no | no custom vine parkour |
| Open wooden door | yes | yes (classification) | yes | RCON oak_door fixture; activate + pass-through attempted |
| Open fence gate | yes | yes (classification) | no | same activate flow as doors; not in live suite |
| Use crafting table | yes | yes | yes | reused existing table at live coords; no extra table dumped |
| Craft 2x2 | yes | yes (planks/sticks/table) | yes | inventory grid via Mineflayer; log→planks→sticks |
| Craft 3x3 | yes | yes (oak_door, pickaxes) | yes | wooden pickaxe, stone pickaxe, oak_door inventory increase |
| Break block | yes | yes (harvest rules) | yes | explicit `collectResource` of intended stone only |
| Collect drop | yes | yes (gather tests) | yes | mine drops + tossed-item pickup |
| Place block | yes | yes (placement tests) | partial | open-field door/bed/table rejected; real doorway place still often `PURPOSELESS_PLACEMENT` |
| Equip item | yes | no | yes | implied by verified eat/mine/craft |
| Use item | partial | no | partial | eat verified; no generic "use" |
| Eat | yes | yes (food metadata) | yes | hunger effect then cooked_beef; hunger 0→eat |
| Open chest | yes | no | yes | |
| Deposit | yes | no | yes | |
| Withdraw | yes | no | yes | |
| Sleep | yes | yes (sleepFacts) | partial | earlier run PASS; later hole spawn SKIP `NO_INTERACTION_POSITION` |
| Attack entity | yes | no | no | basic melee only |
| Flee entity | yes | no | no | creeper/hostile distance |
| Use furnace | no | no | no | lower priority than craft/mine/place |
| Follow player/citizen | yes | no | no | GoalFollow |
| Interact with workstation | yes (table) | yes | yes | furnace later |

Furnace smelting is intentionally incomplete in this pass.
