# Third-Party Notices

This project reuses and adapts open-source Minecraft bot libraries. Copied or wrapped behavior is not claimed as original work.

## PrismarineJS / mineflayer

- Repository: https://github.com/PrismarineJS/mineflayer
- License: MIT
- What we use: Minecraft Java client runtime for citizen bodies (connect, inventory, dig, place, craft, containers).
- Copyright: PrismarineJS contributors

## PrismarineJS / mineflayer-pathfinder

- Repository: https://github.com/PrismarineJS/mineflayer-pathfinder
- License: MIT
- What we use: Default `NavigationBackend` (`MineflayerPathfinderBackend`). Goals such as `GoalNear`, `GoalFollow`, and movement costs (`canDig`, protected `blocksCantBreak`, entity/liquid/dig/place costs). Interaction standing cells are planned *before* calling `goto`, rather than pathing to a block's exact coordinates.
- Copyright: PrismarineJS contributors

## PrismarineJS / mineflayer-collectblock

- Repository: https://github.com/PrismarineJS/mineflayer-collectblock
- License: MIT
- What we use: Evaluated as a collection pattern (path → tool → mine → pickup). Not loaded as a plugin that owns simulation state. Equivalent verified skill: `collectResource`, which still enforces target blacklist, occupancy, timeouts, and inventory verification.
- Copyright: PrismarineJS contributors

## PrismarineJS / mineflayer-tool

- Repository: https://github.com/PrismarineJS/mineflayer-tool
- License: MIT
- What we use: Evaluated `equipForBlock` ranking pattern (axe for logs, pickaxe for stone, shovel for dirt). Implemented locally in `@civ/skills` `equipForBlock` so missing-tool failures stay structured (`MISSING_TOOL`) and do not bypass our skill result schema.
- Copyright: PrismarineJS contributors

## mindcraft-bots / mindcraft

- Repository: https://github.com/mindcraft-bots/mindcraft
- License: MIT
- What we adapt: Bounded skill patterns from `src/agent/library/skills.js` — go-to-position, nearest-block selection, collect-block, place-block, and craft-recipe flows. We do **not** import Mindcraft's arbitrary code-generation or unconstrained LLM action execution. Citizens may only run approved verified skills.
- Copyright: mindcraft-bots contributors

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## miner-org / mineflayer-baritone

- Repository: https://github.com/miner-org/mineflayer-baritone
- License: ISC
- What we use: Optional experimental `MineflayerBaritoneBackend` behind the `NavigationBackend` interface for A/B comparison. Default remains mineflayer-pathfinder until a live benchmark shows a win. The current backend class delegates to pathfinder if the Baritone plugin is not installed.

## PrismarineJS / minecraft-data

- Repository: https://github.com/PrismarineJS/minecraft-data
- License: MIT
- What we use: Versioned 1.21.11 recipes, items, blocks, foods. Authoritative recipe source for `@civ/minecraft-knowledge`.
- Copyright: PrismarineJS contributors

## PrismarineJS / prismarine-block

- Repository: https://github.com/PrismarineJS/prismarine-block
- License: MIT
- What we use: Harvestability / dig and tool facts consumed through Mineflayer block objects and our knowledge layer.
- Copyright: PrismarineJS contributors

## PrismarineJS / mineflayer-auto-eat

- Repository: https://github.com/PrismarineJS/mineflayer-auto-eat
- License: MIT
- What we use: Evaluated as physical food-selection/eating mechanics. Not loaded as a plugin. Planner still decides WHEN eating is appropriate; `eatFood` performs consume + hunger verification.
- Copyright: PrismarineJS contributors

## CybersharpX / Phoenix

- Repository: https://github.com/CybersharpX/Phoenix
- License: not vendored; reference only
- What we use: Architectural study of WorldModel, TaskTree, obtainItem, recovery. No Phoenix source is copied into this repository.

## Not used

- `nuxdie/baritone-ts` (AGPL-3.0) is **not** copied or vendored. No AGPL navigation code is included in this repository.
