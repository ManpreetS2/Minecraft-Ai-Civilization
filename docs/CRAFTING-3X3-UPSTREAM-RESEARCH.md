# 3x3 crafting-table research (Paper 1.21.11)

Do **not** patch `clickWindow` again. Do **not** copy Mindcraft/Phoenix craft helpers wholesale.

## Commit range (git order, not the prompt’s assumed order)

```
0c818b1
  94aeff7   FIRST BAD for live pickaxes (cherry-first recipesFor fallback + clickWindow race)
    2f2e176 FIX: named-recipe scoring, never unowned variants, bound _syncWindow only
```

`git log 2f2e176..94aeff7` is empty because **94aeff7 is the parent**. The isolated research worktree was built from the later fix `2f2e176`. Do not revert `2f2e176`.

## Live status

MechProbe (`pnpm --filter @civ/orchestrator mechanics`) on Paper 1.21.11:

- log → planks → sticks → table → **wooden_pickaxe**
- **stone_pickaxe**
- **oak_door**

`94aeff7` FAIL modes (same Paper world):

- `PREREQUISITE_MISSING Need oak planks before wooden pickaxe` / cherry-first `recipesFor()[0]`
- `VERIFY_FAILED Crafted stone pickaxe but inventory count did not increase`
- `_syncWindow` / `updateSlot:0` hang (~12s)

Those FAILs are **not** “no recipe in minecraft-data”. `recipeExists("oak_door"|"wooden_pickaxe"|"stone_pickaxe")` is true on installed 1.21.11 data.

## Installed APIs (do not guess)

| Piece | Installed |
| --- | --- |
| Mineflayer | 4.39.0 |
| minecraft-data | 3.116.0 |
| Paper | 1.21.11 |
| Craft plugin | `node_modules/.../mineflayer/lib/plugins/craft.js` |

`bot.craft(recipe, count, craftingTable)`:

1. `activateBlock(craftingTable)` then `once(bot, 'windowOpen')` for 3x3.
2. Click ingredients into the grid (`clickWindow`).
3. `grabResult()` **fakes** slot 0 with `window.updateSlot(0, item)` then `bot.putAway(0)`.
4. After the loop, `_syncWindow(windowCraftingTable)` then `closeWindow`.

2x2 (planks, sticks, crafting_table item) uses the player inventory window and does **not** need a table block.

## Why wooden_pickaxe looked like a plank bug

minecraft-data 1.21.11 `recipes[wooden_pickaxe]` lists **cherry_planks first**, oak_planks **last** (12 wood variants). Stick recipes are ordered the same way.

Mindcraft `craftRecipe` and Phoenix `CraftingManager.craft` both do:

```js
bot.recipesFor(item.id, null, 1, table)[0]
```

That is the cherry-plank trap. `recipesFor` can also accept a cherry recipe when `delta`/tags look satisfied while `inShape` still wants cherry ids. `bot.craft` then “succeeds” (client-side fake slot 0) with **no inventory delta**.

Phoenix does **not** solve this. Mindcraft `getItemCraftingRecipes` *does* sort oak common items, but `craftRecipe` still crafts `recipes[0]` from Mineflayer, not that sorted list.

**Keep (already on integration):** `recipeIngredientsOwned` by **registry item name**, score oak/cobble/stick, never fall back to unowned variants, recurse `obtainItem` when `craftItem` returns `PREREQUISITE_MISSING` / `MISSING_INGREDIENT`.

## Why 3x3 VERIFY_FAILED happened

Open Mineflayer issue: [PrismarineJS/mineflayer#3906](https://github.com/PrismarineJS/mineflayer/issues/3906) (`updateSlot:0` after crafting-table output click). Confirmed family: vanilla 1.21.5; we saw the same hang on Paper 1.21.11.

A failed experiment: racing **`clickWindow` / `putAway` at 2s** broke shapeless 2x2. Do not restore that patch.

**Keep:** bound **`_syncWindow` only** (~1.2s) in `patchMineflayerCrafting`, then close the window and trust **inventory name counts**. Treat craft timeout as success **only if** `countItem` increased.

Optional MechProbe-only oracle (not citizen path): RCON `clear <player> <item> 0` as a non-truncating server check (comment on #3906). Do not use `data get entity Inventory` (truncates).

## What Cursor 1 should not do

- Do not `canDig=true` to “unstick” craft approach.
- Do not dump a new crafting table at `position.offset(1,0,0)` (Phoenix `placeCraftingTable`).
- Do not pick `recipes[0]`.
- Do not mark 3x3 adopted from a README. Re-run MechProbe after any craft.js change.

## Regression

- Unit: `packages/minecraft-knowledge` wooden_pickaxe plan next-step is `oak_planks`; oak_door recipe exists.
- Live: MechProbe wooden_pickaxe + stone_pickaxe + oak_door inventory increase.

## Recommendation (one line)

Keep current `craftItem` + `_syncWindow` bound + named-recipe filter; file/track mineflayer #3906; do not vendor Mindcraft/Phoenix craft.
