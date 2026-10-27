# BLUE Mindcraft movement reuse (TASK 06)

Date: 2026-09-20  
Project: `<WORKSPACE>`  
Farming checkpoint preserved: `7d3e645`  
HomeProbe / shared jump work was finished first; this document is the follow-on audit. GREEN mining/fishing modules were not edited in this task. MechProbe was not replaced.

**Result: Mindcraft does not offer a verified improvement over the current shared navigator on Paper 1.21.11-132. Keep our adapter. Do not vendor Mindcraft's agent or pathfinder patch.**

## Phase 1 — Source and license

| Item | Recorded value |
| --- | --- |
| Repository | https://github.com/mindcraft-bots/mindcraft |
| Branch inspected | `develop` |
| Exact commit | `5f3acc87b479864124173de444f31fa5538f94a6` (2026-06-09, merge PR 787 dashboard status) |
| License | MIT, Copyright (c) 2024 **Kolby Nottingham** — https://github.com/mindcraft-bots/mindcraft/blob/develop/LICENSE |
| License text in this repo | `THIRD_PARTY_NOTICES.md` (full MIT text retained) |
| README credit | `README.md` § Third-Party Credits |

Inspected upstream files:

- `package.json` (mineflayer `^4.33.0`, mineflayer-pathfinder `^2.4.5`, `postinstall: patch-package`)
- `patches/mineflayer-pathfinder+2.4.5.patch`
- `src/agent/library/skills.js` (`goToPosition`, door interval, cheat `/tp` when `cheat` mode)
- LICENSE

### Installed versions vs Mindcraft

| Library | This repo (adapter / lock) | Mindcraft `develop` @ `5f3acc87` |
| --- | --- | --- |
| mineflayer | `^4.37.1` resolved **4.39.0** | `^4.33.0` |
| mineflayer-pathfinder | **2.4.5** | **2.4.5** |
| Minecraft target | Paper **1.21.11-132** | README advertises Java through 1.21.11; that does **not** prove their patch on our Paper build |

Mindcraft “smooth movement” is **not** a separate controller. It is:

1. **pathfinder settings** (`canOpenDoors=true`, vine/trapdoor climbable, door node centering)
2. **a node_modules patch** (0.175 node arrival, lava avoid unless already in lava, jump while in lava)
3. **skill sequencing** (`goToPosition` + dig-progress watchdog), not a better 1.21 `player_input` implementation
4. Optional **cheat `/tp`** — rejected

Neither the README 1.21.11 claim nor the FAQ patch mention was treated as compatibility proof.

## Phase 2 — What was copied, adapted, rejected

Linked to **our** deficiencies (stall on 1-block full blocks, door toggle, lava, 1.21 jump bits), not “it looks related.”

| Upstream | Action | Reason |
| --- | --- | --- |
| `canOpenDoors=true` | **Already adapted** in `configureMovements` (prior bakeoff). Kept. | Matches our closed-wooden-door requirement. |
| Door node snap to block center | **Rejected as a vendored patch** | We open wooden doors once via `tryOpenAdjacentDoor` / skill `openDoor` without toggling an already-open door. Patching `node_modules` is not required. |
| Arrival `0.175` vs `0.35` | **Rejected** | Tighter node arrival does not fix Paper 1.21 jump bits. We already reject Y-miss arrivals in `arrivalAccepted`. |
| Lava removed from `blocksToAvoid` while `isInLava` + jump in lava | **Rejected** | Conflicts with lava halt/retreat/`HAZARD_BLOCKED`. We must not treat lava as walkable. |
| Vine / weeping / twisting / cave vine climb + trapdoor climbers | **Rejected** | Not an observed village/farm/home deficiency. |
| Optimistic `world.setBlockStateId` before `placeBlock` | **Rejected** | We require verified real placement for authorized bridges only. |
| `goToPosition` cheat `/tp` | **Rejected** | User forbids teleport home / fake on-time arrival. |
| Entire Mindcraft agent, LLM skills, `allow_insecure_coding` | **Rejected** | Keep insecure coding disabled. Preserve citizen identities, SQLite homes, action-result codes. |
| 1.21 `player_input` / `tick_end` | **Independent** (ours) | Mineflayer 4.39 sneak-only `player_input` clears jump. Mindcraft does not ship this fix. |

No Mindcraft file was copied verbatim in this task.

## Phase 3 — Baseline vs adapted (same fixtures)

Baseline is the current MechProbe/HomeProbe shared navigator **after** TASK 05 jump/door/hazard work, **without** applying Mindcraft’s patch.

Pad ~`200,67,400` on WORLD-LAB (not Site C; no village lava):

| Fixture | Our navigator (live) | Mindcraft-derived change |
| --- | --- | --- |
| Open / closed wooden door | Unit PASS (already-open no toggle; closed open once). **H1 live: already-open door not toggled; sleep PASS.** | Not applied; would not replace our door policy. |
| One-block ascent | Unit PASS. Live: jump **starts** (y=67.3) but landing on dirt not yet consistent. | Patch does not send 1.21 `player_input`. No reason to expect a win. |
| Two-block / tree | Unit PASS (memory + around). Live did not pass the trunk. | Door/vine patch is unrelated. |
| Stall recovery | Unit PASS; live recoveries=1 observed | Not in Mindcraft patch. |
| Lava / magma | Unit PASS. Live magma standing refused. Live lava mixed (bypass vs pit fall) — our hazard path, not theirs. | Their lava-walkable behavior is **worse** for our safety requirement. |
| H1 bed/chest walk | Live NAV to stoop PASS; storage PASS; sleep FAIL on earlier run | Not re-run as a Mindcraft bakeoff. |
| Cancel / release controls | Unit PASS | N/A |

No same-world bakeoff was run with MindcraftProbe: importing their patch would fight lava policy and would not address the measured 1.21 jump/landing gap. Per the task: **do not declare Mindcraft better because it looked smoother in a different world.**

## Phase 4 — GREEN coordination

Stable navigator remains `@civ/minecraft-adapter`:

- `moveToPosition` / `navigateToInteractWithBlock` (`recover: true`, xz≤3 for interact)
- `HAZARD_BLOCKED`
- `evaluateReturnHome` / `MiningRequest.returnHome`
- `allowHazardBridge` opt-in only

GREEN owns fishing/mining skill modules; this task did not edit them.

## Paper 1.21.11 live compatibility

Mindcraft + its pathfinder patch is **not** verified on our Paper 1.21.11-132 body. Our adapter **is** connected and walking on that server. Remaining live gap is 1-block **landing** and tree pass-by, not “need Mindcraft.”

## Regressions / blockers

- Do not install `patch-package` on `mineflayer-pathfinder` in this repo.
- Do not enable `allow_insecure_coding`.
- Live 1-block hop still not an acceptance PASS; keep iterating **our** jump/input path, not a Mindcraft migration.
