# Mission 005 Ledger — Production Construction Reliability

Date: 2026-10-26  
Branch: `integration/reliability-pr7-windows` @ `019d26d`  
Mode: implement offline; prepare live plan; **do not launch Minecraft**.

## Defects fixed

| Defect | Fix | Tests |
| --- | --- | --- |
| Soft `*_door` / `*_bed` match | Exact identity in `blockMatchesPlan` | blueprint-rules + production-path |
| Door/bed multiblock missing from plan | `door_lower`/`door_upper`, `bed_foot`/`bed_head` + `impliedBySibling` | expand + simulate + placeBlock |
| State unavailable still COMPLETE | `unverified` + `matchBlockProperties`; COMPLETE requires props | intention persist + offline acceptance |
| BOM drift | `authoritativeBomFromExpanded` + library sync + pipeline `BOM_DRIFT` | pipeline |
| Farm plank pad | `simple_farm_v1` → `implemented: false` | catalog test |
| Unauthorized extras | `sanitizeBlueprintExtras` | shed rejects bed/furnace |
| Weak overlap test | Strict exact-footprint overlap assertion | production-path multi-citizen |
| placeBlock success on promise only | Post-place exact identity + door upper + bed twin | production-path placeBlock |
| Acceptance ≠ production placer | New harness invoking real `advanceBlueprintBuild` / `placeBlock` | `construction-production-path.test.ts` |

## Production call path

`contribute_to_project` → `buildStructure` → `executeBuildStructurePlan` → `selectConstructionSite?` → `dispatchCitizenBuildIntention` → `advanceBlueprintBuild` → `placeBlock` → reconcile (+ properties) → persist.

## Test results

- Construction suite (12 files): **82/82 PASS**
- Knowledge `tsc --noEmit`: **PASS**
- Agent-core construction-related: clean; unrelated WIP errors remain outside this mission

## Remaining Mineflayer risks

- Real nav / pathfinder / reach
- Real door hinge/facing from Mineflayer block states under rotation
- ClearSite dig / tool requirements on vegetated pads
- Live `FINAL_VALIDATION` enter/exit/chest deposit
- Inventory double-consume edge cases under lag

## Live prep

Documented in `CONSTRUCTION_LIVE_TEST_PREP.md`. **NO-GO** for execution.
