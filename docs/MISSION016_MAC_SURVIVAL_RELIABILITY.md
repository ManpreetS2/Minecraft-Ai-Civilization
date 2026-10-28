# Mission 016 — Mac Survival-Skill Reliability

**Status:** Offline skill/adapter corrections complete. Does **not** claim live Minecraft or Paper success.  
**Branch:** `mac/offline-reliability-20261028`  
**Private remote:** `ManpreetS2/Minecraft-Ai-Civilization-windows-backup`

## Mission 015 private checkpoint

| | SHA |
| --- | --- |
| Local HEAD at 015 commit | `0a71111dc2c9f4280f6b676ac29e681293501073` |
| `windows-backup/mac/offline-reliability-20261028` | `0a71111dc2c9f4280f6b676ac29e681293501073` |
| Base (Mission 012) | `39e98a44f248df04e6ec819f4af9a736c694ded9` |

Public `origin` was not updated. Windows `dev/demo-simplification-20261027` was not modified.

Mission 016 was checkpointed on this Mac branch after offline verification (Mission 016C).

## Capabilities audited

Statuses are offline judgments of the production functions. Green unit tests are not live Minecraft proof.

| Capability | Offline status | Evidence |
| --- | --- | --- |
| 1. Safe movement / pathfinding | **PASS** (code contract) / **UNVERIFIED** live | `moveToPosition` / `runGotoOnce` require `arrivalAccepted`; unmatched arrival is `VERIFY_FAILED`; hazard cells return `HAZARD_BLOCKED`. Fake bots cannot exercise Mineflayer pathfinder against Paper. |
| 2. Wood and stone gathering | **PASS** with gap / **UNVERIFIED** live | `collectResource` requires inventory gain. `mineBlock` verifies the world block is gone, **not** that a drop entered inventory. |
| 3. Crafting | **PASS** fail-closed / **UNVERIFIED** live success | `craftItem` refuses missing ingredients and requires inventory increase. Real Mineflayer recipe/window timing is not reproduced offline. |
| 4. Farming | **PASS** after fix / **UNVERIFIED** live | `tillSoil` / `plantCrop` verify block names. `workFarmPlot` no longer reports success when till/plant/harvest made no progress. |
| 5. Hunger, food, eating | **PASS** after fix / **UNVERIFIED** live | `eatFood` now requires consumed food or increased hunger. Food *acquisition* (fish/hunt/harvest drops) still needs a live world. |
| 6. Home and bed navigation | **PASS** missing-bed / **UNVERIFIED** live pathing | Designated missing/unloaded beds fail `BED_MISSING` before `bot.sleep`. Arrival at a real bed still needs Paper. |
| 7. Sleeping and waking | **PASS** offline guards / **UNVERIFIED** live | Daytime → `NOT_SLEEP_TIME`; hostiles → `HOSTILE_NEARBY`; requires `bot.isSleeping` after `bot.sleep`. Fake `sleep()` only sets a flag. |
| 8. Stuck detection / recovery | **PASS** unit / **UNVERIFIED** live loops | `task-recovery` backoff and unresolved blocks are tested. `eatFood` still does not check `AbortSignal` before consuming. |

## Defects discovered

1. **Designated sleep treated an unloaded bed as present.** `sleep()` only rejected a loaded non-bed. `blockAt() === null` was labeled `"bed"` and navigation ran before `BED_MISSING`.
2. **`eatFood` could succeed without a hunger or inventory change** if `beforeHunger >= 20` slipped past the early gate. The verify clause required all of “count unchanged AND hunger not up AND was hungry.”
3. **`workFarmPlot` always returned `ok`**, even when every till/plant/harvest failed. `tillAndPlantPlot` already failed closed in that case; the production farm action did not.
4. **Left unfixed (not in the three-fix budget, or Mission 013 overlap):**
   - `mineBlock` success without inventory gain (pickup is a separate skill).
   - `harvestCropAt` can succeed with `collected: 0` after the crop block is gone.
   - `eatFood` ignores cancellation until consume returns.
   - Frozen construction typecheck/tests (`blueprint.test.ts`, `construction-experiment-guard`).
   - `dispatch-integrity.test.ts` `"OBTAIN_ITEM"` vs `"obtain_item"`.
   - Live scripts `live-home-test.ts` / `live-fish-test.ts` type errors.

## Code changes (Mission 016, uncommitted)

| File | Change |
| --- | --- |
| `packages/skills/src/world.ts` | Fail `BED_MISSING` immediately when the designated bed is missing or unloaded. |
| `packages/skills/src/inventory.ts` | `eatFood` succeeds only if food count dropped or hunger increased. |
| `packages/skills/src/farm.ts` | Record till failures; fail `workFarmPlot` when no till/plant/harvest progress and the plot is not an idle immature farm. |
| `packages/skills/src/world.test.ts` | Unloaded designated bed must not navigate. |
| `packages/skills/src/eat-food.test.ts` | Production `eatFood` success, no-op, no-food, full-hunger. |
| `packages/skills/src/farm.test.ts` | Unreachable till fails; idle immature plot may succeed. |
| `packages/skills/src/gather.test.ts` | `mineBlock` VERIFY_FAILED vs block-gone. |
| `packages/skills/src/obtain.test.ts` | `craftItem` without planks does not consume logs. |

Original Minecraft mechanics (dig, hoe, consume, `bot.sleep`) are unchanged. Timeouts, retry, and backoff helpers were not relaxed.

## Offline test and typecheck results

| Gate | Result |
| --- | --- |
| `@civ/minecraft-adapter` typecheck | **pass** |
| `@civ/skills` typecheck | **pass** |
| `@civ/agent-core` typecheck | **fail** (3 frozen errors: construction tests + `"OBTAIN_ITEM"`) |
| `@civ/orchestrator` typecheck | **fail** (construction guard + live-home/live-fish scripts) |
| Full workspace `pnpm typecheck` | **fail** (stops on agent-core; 8/10 packages with scripts still pass) |
| Agent-core tests | 265 pass / 1 fail (`blueprint.test.ts` crafting_table) |
| Full `pnpm test` | **753 pass / 2 fail** (755 total). Failures: `blueprint.test.ts`, `construction-experiment-guard.test.ts` path aliasing on macOS |

Mission 015 was 744 pass / 2 fail. The two remaining failures are the frozen construction cases.

### What the fake environment cannot prove

- Paper 1.21 pathfinder, jump, and player_input packets
- Real item-drop physics and pickup race
- Mineflayer crafting window / `recipesFor` matching
- Hunger packet updates vs `bot.consume()`
- Occupied beds, thunderstorms, and vanilla sleep distance
- Windows `path.sep` aliasing for construction isolation

## Remaining live verification

On Windows with Paper (not this Mac session):

1. Atlas navigates to a visible oak log, `mineBlock`/`collectResource`, inventory actually gains logs.
2. Craft sticks/planks from held logs at a placed table; missing-ingredient path does not consume logs.
3. Hunger &lt; 20, `eatFood` with bread: hunger rises and stack decreases; full hunger refuses.
4. Hoe a hydrated 3×3, plant wheat; blocked path does not report farm success.
5. Night sleep at a designated loaded bed; unloaded/missing bed fails without `bot.sleep`.
6. Cancel/shutdown mid-gather and mid-eat; inventory not silently credited.

## Files that must not be merged blindly

Do not take Windows Mission 013 copies of:

- `packages/agent-core/src/manager.ts` (and related manager files)
- `packages/agent-core/src/executor.ts`
- construction engine / blueprint / `construction-experiment-guard*`
- directives
- `packages/minecraft-adapter/src/minecraft-body.ts`
- bulletin / shared config exports

Mission 016 only touches isolated skill modules listed above.

## Mission 013 overlap risks

Low: 016 does not edit manager, executor, construction, directives, minecraft-body, or bulletin.  
Watch: if 013 also edited `packages/skills/src/farm.ts`, `inventory.ts`, or `world.ts`, rebase skill hunks carefully. `task-recovery.ts` was committed in Mission 015, not 016.

## Recommended Windows integration

1. Keep `mac/offline-reliability-20261028` at 015 SHA `0a71111` as the published checkpoint.
2. Review and commit Mission 016 separately after this doc.
3. After Mission 013 is checkpointed on Windows, rebase this Mac branch onto that commit.
4. Re-run adapter/skills typecheck and `pnpm test`; expect the two construction failures until 013 construction types are reconciled.
5. Run the live Atlas retests above before claiming Gate A.
