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

## linkle69 / mineflayer-auto-eat

- Package: `mineflayer-auto-eat` 5.0.3 (npm)
- Repository: https://github.com/linkle69/mineflayer-auto-eat
- License: MIT
- What we use: Evaluated as physical food-selection/eating mechanics. **Not loaded.** `PrismarineJS/mineflayer-auto-eat` GitHub is 404; current maintainer is linkle69. Planner still decides WHEN eating is appropriate; `eatFood` performs consume + hunger verification. Do not call `enableAuto()`.
- Copyright: Rocco A / Linkle / contributors

## CybersharpX / Phoenix

- Repository: https://github.com/CybersharpX/Phoenix
- License: MIT (LICENSE file verified 2026-09-17)
- Classification: **REFERENCE ONLY** (architecture). Optional later: stuck/missing-ingredient *patterns* with notice. **No Phoenix source is copied** into this repository. Do not use `CraftingManager.placeCraftingTable` (dumps a table at `position.offset(1,0,0)`). Do not use `recipesFor(...)[0]` (cherry-plank first on 1.21.11).
- Copyright: CybersharpX / Phoenix contributors

## PrismarineJS / mineflayer-statemachine

- Repository: https://github.com/PrismarineJS/mineflayer-statemachine
- License: MIT
- Classification: REFERENCE ONLY. Not loaded. Do not convert the civilization orchestrator to nested FSM plugins.

## PrismarineJS / mineflayer-pvp

- Repository: https://github.com/PrismarineJS/mineflayer-pvp
- License: MIT
- Classification: REFERENCE / later WRAP candidate for basic engagement. Must never override deterministic creeper flee.

## yuniko-software / minecraft-mcp-server

- Repository: https://github.com/yuniko-software/minecraft-mcp-server
- License: Apache-2.0
- Classification: evaluated as a **development harness** only. Not adopted. MechProbe CLI (`pnpm --filter @civ/orchestrator mechanics`) already covers isolated mechanics. Do not expose citizens as MCP-controlled agents.

## Boyan253 / minemind

- Repository: https://github.com/Boyan253/minemind
- License: MIT
- Classification: REFERENCE ONLY. Forge 1.20.1 stack. Do not install.

## MineDojo / Voyager

- Repository: https://github.com/MineDojo/Voyager
- License: MIT
- Classification: REFERENCE ONLY (skill reuse, execution error feedback). Do **not** import generated-code execution. Citizens stay on bounded approved skills.

## AltoClef (Fabric)

- Classification: REFERENCE ONLY (nested tasks, unreachable tracking, preemption). Do not install Fabric. Phoenix is the MIT Mineflayer analogue of this architecture. Original AltoClef license is not treated as a runtime dependency.

## Not used / do not copy

- `nuxdie/baritone-ts` (AGPL-3.0) is **not** copied or vendored. No AGPL navigation code is included in this repository.
- MineColonies and similar colony mods are **not** the civilization engine.
- Mindcraft unconstrained LLM code execution is **not** imported (MIT skill *patterns* only, with notice above).
