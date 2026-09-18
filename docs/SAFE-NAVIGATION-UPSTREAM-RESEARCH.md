# Safe navigation stuck-path research

Handoff for Cursor 1. Do **not** set `canDig=true` on normal walks.

## Live status

`SAFE_NAVIGATION` / `NORMAL_NAVIGATION_CAN_DIG=false` **did not** turn unrelated solids to air (MechProbe walk snapshots).

Displacement:

- Open pad (~229, 65, 195): **14.1 blocks**, no mining.
- Hole pad (~223.7, 61, 184): **0.0 blocks**, `PATH_FAILED` / stuck, still no mining.

That is the intended trade: walk around or fail; do not mine the village.

## What we already wrap

`packages/minecraft-adapter/src/pathing.ts` (mineflayer-pathfinder **2.4.5**, MIT):

| Setting | SAFE_NAVIGATION |
| --- | --- |
| `canDig` | false |
| `allowParkour` | true |
| `allow1by1towers` | false |
| `maxDropDown` | 3 |
| `infiniteLiquidDropdownDistance` | false |
| `scafoldingBlocks` | empty |
| `canOpenDoors` | true when the field exists |
| lava/fire | `blocksToAvoid` |
| protected names | `blocksCantBreak` |

Goals used: **`GoalNear`**, then interaction fallbacks **`GoalLookAtBlock`** and **`GoalGetToBlock`**. Recovery: xz offsets, **y±1**, larger `GoalNear` range, occupancy yield, target blacklist.

Profiles already exist: `SAFE_NAVIGATION`, `RESOURCE_APPROACH`, `CONTROLLED_EXCAVATION` (only excavation may dig).

## Upstream comparison

### mineflayer-pathfinder

Has `GoalNear`, `GoalBlock`, `GoalLookAtBlock`, `GoalGetToBlock`, `GoalFollow`, `GoalPlaceBlock`, dynamic `setGoal(goal, true)`. Interaction now tries ranked standing cells (`GoalNear`), then `GoalLookAtBlock` / `GoalGetToBlock` on the target. **collectblock** uses `GoalLookAtBlock` then `dig` — we wrap that pattern without loading the plugin.

### collectblock Movements (do not copy)

On collect it sets `dontMineUnderFallingBlock = false` and `dontCreateFlow = false` on **the bot pathfinder**. Loading the plugin as owner of movements will fight `SAFE_NAVIGATION`.

### Mindcraft

`goto` + `GoalFollow` / inverted goals; collectblock plugin loaded globally. Table dump via `getNearestFreeSpace` + `placeBlock`. Do not copy that for citizens.

### Phoenix

`StuckDetector` + `HazardDetector` + `goTo(pos, { minDistance })`. Useful **pattern**: classify stuck vs no-path vs timeout, then replan. Implementation is MIT and AltoClef-shaped; port the **classification**, not the whole NavigationSystem. Phoenix still sits on pathfinder.

## Implemented on integration (do not regress)

1. **Interaction goals:** `navigateToInteractWithBlock` ranks standing cells, `GoalNear` each, then `GoalLookAtBlock` / `GoalGetToBlock`. `canDig` stays false.
2. **Hole / 1-wide pit:** `recoveryAttempts` includes `y+1` / `y-1` and a larger `GoalNear` range before failing.
3. **Progress watchdog:** stall watch (~4s without `movedEnough`) stops the path; collect blacklists that cell and tries the next candidate.
4. **Doors:** `canOpenDoors=true`; wooden-door skill stays ours. Do not mine doors.

Do **not** install a second pathfinder. Do **not** enable collectblock’s movement mutation.

## Tests

- Unit: `NORMAL_NAVIGATION_CAN_DIG === false`; excavation profile is the only `canDig`.
- Live MechProbe: walk on open terrain ≥ ~8 blocks, solids snapshot unchanged; 1-block depression steps out without mining; deep stone wells fail-fast (`PATH_BLOCKED` / `NAV_NO_INITIAL_PROGRESS`) without breaking blocks.

## One-line recommendation

Keep `canDig=false`; interaction uses LookAt/GetToBlock after standing cells; y-offset recovery for pits; do not load collectblock as the navigator.
