# Offline survival and readiness work

Branch `agents/t3-survival-offline-readiness`, base physical-state candidate `fc6f9fc231aec308305ca008dde6a6e4f5e35567`.

## Verified gathering race repair

Root cause: collectResource selected a resource, yielded during navigation, then dug the replacement block at the old position without checking it still belonged to the requested resource set. Reproduced with dirt, stone and crafting_table replacing an oak log: all three were dug. This could damage another citizen's newly placed workstation.

Fix: reject mismatching initial candidates, recheck after navigation, and reread after the final asynchronous look immediately before digging. Changed targets are skipped within this bounded attempt; no destructive fallback or increased timeout. Six regressions cover replacements during navigation and final look. No protected executor changes.

## Capability evidence

Three deterministic offline seeds (17, 41, 99) start with empty inventory, call production obtainItem to gather logs, craft planks/sticks/table, place and verify the table, craft a wooden pickaxe, then harvest stone and pick up cobblestone. JSON lines record inventory, digs, crafts, placed blocks, requested skills, model-decision count zero and zero operator interventions. Natural stone is part of the fixture terrain, not a gifted item. These are capability requests from the test, not autonomous model choices.

Full skills package **210/210 passed**. Focused changed-file lint and skills TypeScript pass. Artifacts: artifacts/campaign/survival-skills.json, survival-skills.log, survival-seeds.log. Existing food, interrupted eating, lost drops, full inventory, cancellation, navigation, empty-start crafting and survival gauntlet tests also pass. Health/hunger dynamics, hostiles, real server physics and model choices are explicitly unmodeled in the new seeds; no live survival claim.

## Remaining survival integration

Real Observation -> Cognition -> Goal dispatch -> Planning -> Skills -> Verification -> Persistence -> Memory still requires the protected community executor integration and Claude's checkpointed provider-session interface. Existing manager has one cognition provider. Separate mock labels cannot establish independent model sessions. No major provider rewrite was attempted. Food/shelter/respawn under real Paper remains authorization-gated.
