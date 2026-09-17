# Minecraft capability matrix

Environment: Paper 1.21.11 + Mineflayer. **LIVE PAPER VERIFIED** is only marked after a real body performed the action. Unit tests are not live proof.

| Capability | IMPLEMENTED | UNIT TESTED | LIVE PAPER VERIFIED | Known limitations |
| --- | --- | --- | --- | --- |
| Walk | yes | yes (path policy) | pending | `canDig=false`; no random terrain break |
| Jump | yes (pathfinder) | no | pending | standard pathfinder jumps only |
| Sprint | pathfinder default | no | pending | not explicitly toggled |
| Swim | pathfinder water cost | no | pending | drowning emergency is separate NO_LLM |
| Climb | pathfinder ladders | no | pending | no custom vine parkour |
| Open wooden door | yes | yes (classification) | pending | verifies `open` when block properties exist |
| Open fence gate | yes | yes (classification) | pending | same activate flow as doors |
| Use crafting table | yes | yes | pending | must be a real reachable block |
| Craft 2x2 | yes | yes (planks/sticks/table) | pending | inventory grid via Mineflayer |
| Craft 3x3 | yes | yes (oak_door, pickaxes) | pending | requires table |
| Break block | yes | yes (harvest rules) | pending | explicit mine only |
| Collect drop | yes | no | pending | verifies inventory delta when possible |
| Place block | yes | no | pending | support face required; occupancy is not fake success |
| Equip item | yes | no | pending | verifies held item |
| Use item | partial | no | pending | eat/activate/sleep covered; no generic "use" |
| Eat | yes | yes (food metadata) | pending | hunger must allow eating |
| Open chest | yes | no | pending | chest/barrel/trapped_chest |
| Deposit | yes | no | pending | partial transfer allowed |
| Withdraw | yes | no | pending | re-reads container |
| Sleep | yes | yes (sleepFacts) | pending | night/thunder; not if hostiles |
| Attack entity | yes | no | pending | basic melee only |
| Flee entity | yes | no | pending | creeper/hostile distance |
| Use furnace | no | no | no | lower priority than craft/mine/place |
| Follow player/citizen | yes | no | pending | GoalFollow |
| Interact with workstation | yes (table) | yes | pending | furnace later |

Furnace smelting is intentionally incomplete in this pass.
