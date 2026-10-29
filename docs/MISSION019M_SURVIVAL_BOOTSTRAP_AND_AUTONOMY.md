# Mission 019M — Survival Bootstrap & Autonomy Validation (Mac)

**Branch:** `mac/offline-reliability-20261028`  
**Starting SHA:** `d974b2212c00770c1cf727754de661d13e9e7ce6`  
**Private remote only.** No Paper/Minecraft. No Windows Mission 013 merge.

Public `project.md` on `main` may include a future CoreProtect candidate not present in this Mac copy. That is **not** implemented here.

## 1. Project charter alignment

Locked principles honored:

- Model chooses WHAT/WHY; skills execute HOW; inventory/world verify results.
- No invented resources or compulsory mayor/roles.
- Demo needs empty-start survival chain (food + shelter pressure).
- Offline tests ≠ Gate A/B live proof.

## 2. Confirmed production bootstrap path

| Step | Production path | Offline status |
| --- | --- | --- |
| Empty → gather wood plan | `planCitizen` → `gather_wood` / `mineBlock` | Planner PASS |
| Dig → collect logs | `collectResource` (inventory delta) vs `mineBlock` (excavation only) | collect PASS; dig→loot on Paper **UNVERIFIED** |
| Logs → planks | `craftItem` / `obtainItem` + knowledge recipe | PASS with knowledge fallback |
| Planks → sticks | same | PASS |
| Crafting table item | same | PASS |
| Place table | `ensureCraftingTable` / `placeAdjacentCraftingTable` | PASS offline fixture; live place **UNVERIFIED** |
| Wooden pickaxe | `obtainItem("wooden_pickaxe")` needs table | PASS offline |
| Executor wood gather | still maps to `mineBlock` | **Windows blocker** |

## 3. Defects found

1. **`craftItem` failed closed when Mineflayer `recipesFor` was empty** even though `@civ/minecraft-knowledge` knew the recipe and ingredients were held — blocked offline bootstrap and fragile live sync cases.
2. Test/fixture gap: observe `findBlock` uses `findBlocks`; empty `findBlocks` made ensureCraftingTable place tables repeatedly (fixture correctness, mirrors how critical findBlocks is live).

## 4. Code fixes

| File | Change |
| --- | --- |
| `packages/skills/src/inventory.ts` | `synthesizeKnowledgeRecipe` + use when `recipesFor` empty; still requires inventory increase after `craft` |
| Tests | `bootstrap-progression.test.ts`, `bootstrap-decision-cycle.test.ts` |

## 5. Recipe / inventory verification

- B1–B3: plank/stick/table crafts consume ingredients and add outputs.
- B5: logs → pickaxe via `obtainItem` with placement.
- B6–B10: empty, cancel, missing station, unknown recipe, gather miss — no invented tools.

## 6. Planner multi-cycle evidence

Empty → gather; logs → `obtainItem` wooden_pickaxe; owned pickaxe stops redundant craft; hunger+food → `eatFood` reflex over model explore.

## 7. Cloud strategy vs heuristic

Existing Mission 010B precedence retained:

- `model_selected_strategy` (`source: llm`, allowlisted goals)
- `deterministic_mechanical_prerequisite` (bootstrap obtain/gather)
- `heuristic_fallback` / observe
- `emergency_reflex` (eat/flee)

`obtain_item` remains an internal planner action; models use `craft_tools`.

## 8. Food & shelter readiness matrix

| Capability | Impl | Offline tests | Live | Integration gap |
| --- | --- | --- | --- | --- |
| Gather/eat food | Yes | Yes | UNVERIFIED | — |
| Wood → tools | Yes | Yes | UNVERIFIED | executor mineBlock vs collectResource |
| Simple shelter skill | Yes | Partial | UNVERIFIED | construction frozen |
| Sleep/bed | Yes | Yes | UNVERIFIED | — |
| Gate A fixture | — | — | Required | Windows World-Lab |
| Gate B empty start | Design locked | Offline chain closer | Required | No free H9/supplies |

## 9. Test / typecheck

Focused suites green (bootstrap + decision + related). Full workspace results recorded at checkpoint. Known construction 2 failures unchanged.

## 10. Windows Mission 013 blockers

- Do not touch `executor.ts` / `manager.ts` here.
- Required later: `gather_wood` should prefer inventory-verified `collectResource` (or emit ResourceCollected only after inventory delta).
- Merge only after 013 checkpoint on Windows.

## 11. Live verification still required

- Real tree dig + drop pickup
- Real crafting window + table placement on Paper
- Planner ticks with AgentManager (not atlas-cli)
- Gate A / Gate B remain **NO-GO** from offline evidence alone
