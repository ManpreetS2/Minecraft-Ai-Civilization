# BLUE persistent homes implementation

Date: 2026-09-19  
Branch: `integration/first-settlement-v2`  
Server for any later live test: isolated WORLD-LAB Paper 1.21.11-132 `127.0.0.1:25567` only

This is **not** a five-citizen civilization PASS. Planner home-*selection* is UNVERIFIED. Live Mineflayer home proof is **not** claimed: WORLD-LAB is stopped, personal chests are not installed, and exclusive access has not been granted.

## Phase 1 — Farming checkpoint

**Commit:** `7d3e645` (`7d3e6453d8cd1f35c1576b2149bef350516530b0`)

Message: `Checkpoint verified WORLD-LAB wheat farming so later home work cannot overwrite it.`

Isolated to farming skill, reach-first harvest standing, farm harness, and farming docs. RED files, compact-hut / entity-target WIP, and `mechanics:demo` were **not** staged.

Targeted tests after the checkpoint (and after home work): farm + interaction + farm-guard **PASS**. Live farm evidence remains `docs/BLUE_AGRICULTURE_LIVE_RUN_6.log` (run 6: 9/9 plant/grow/harvest/replant, bread, chest, eat). Full suite is **not** claimed green.

## Phase 2 — What already existed vs what was missing

Inspected, then extended (no second citizen/bot framework):

| Area | Already worked | Missing |
| --- | --- | --- |
| SQLite identity | `citizens.home_id` string; WAL; `upsertCitizen` | No `homes` / memberships, beds, or chests |
| Planner | `planCitizen`; `experimentWorkAssignment(false)` does not roster-assign jobs | No use of a claimed home bed; no autonomous house choice |
| Sleep | `sleep(ctx, preferred?)` | Preferred missing fell back to nearest bed; after pathing, `findBlock` any bed within 4 |
| Chests | `depositItem` / `withdrawItem` with a preferred block; `openContainer` on `chest` \| `barrel` \| `trapped_chest`; FarmProbe live single `chest` PASS | Personal vs communal access; `knownChest` could adopt any first chest as `settlement.storage` |
| Nav | `navigateToInteractWithBlock`, reach 4.5, standing cells radius 2 | Destination was nearest bed/chest, not a claimed cell |
| Respawn | Vanilla spawn / `applyBodyRespawn` | Must not imply home ownership (still true) |

## Exact files / schema

- `packages/agent-core/src/home-types.ts`, `homes.ts`, `homes.test.ts`, `home-ops.ts`
- `packages/agent-core/src/store.ts` — `homes`, `home_memberships`, exclusive partial unique indexes on active/displaced bed and personal chest
- `packages/skills/src/world.ts` — designated bed only; no nearest-bed substitute
- `packages/agent-core/src/executor.ts` — `sleep`, `deposit_personal` / `withdraw_personal`; default deposit remains communal
- `packages/agent-core/src/workstations.ts` — communal `knownChest` skips claimed personal chests
- `packages/agent-core/src/planner.ts` + `manager.ts` — if a home is **already** claimed and it is night, emit `sleep` at that bed. Does **not** call `claimHome`
- Guards/harness: `apps/orchestrator/src/home-test-guard.ts`, `live-home-test.ts`
- Error codes: `ACCESS_DENIED`, `CLAIM_CONFLICT`, `HOME_MISSING`, `HOME_INACCESSIBLE`

`claimHome` is transactional. Conflicting exclusive bed/chest claims return `CLAIM_CONFLICT`. Joining a household requires an explicit `homeId`. Changing house requires `move: true`. Temporary `seekSafety` does not write `home_id`.

## Personal container (for RED)

**Supported and required for starter houses:** one ordinary vanilla `minecraft:chest` per house.

- Empty (no loot table, no `Lock`, no custom NBT)
- Single block; do **not** place two chests adjacent (vanilla would merge them into a double chest)
- `barrel` / `trapped_chest` are accepted by the open/deposit skill if already present, but they are **not required** and must **not** be installed
- No household/second chest per house
- Ownership is **SQLite claim + access checks**, not vanilla chest mechanics

API field `personalChest` is the **floored chest BLOCK** in `dimension` (default `overworld`), not the bot standing cell and not the chest facing.

Facing is not stored. A facing that leaves 2-high air on the lid side is recommended so Mineflayer can stand within **4.5** reach. Navigation chooses a walkable standing cell within radius 2 of the chest block (planks/cobble underfoot; air at feet+head; stairs allowed).

## Access rules

- **Personal:** only the membership owner may deposit/withdraw that `personalChest`. Another citizen gets `ACCESS_DENIED`.
- **Communal:** `settlement.storage` — tannery `-1038,65,839`. Farm-chest / shared-storage workflows stay on this path (`depositItems` default).
- **Household:** optional shared chest on the home row; not used for Site C starter install.
- Unclaimed house chests are not automatically treated as communal.

## RED installation (approved)

Place **five** ordinary single chests in RED’s verified air cells. Do not block doors, beds, or the interior stand cells. Preserve lighting, paths, and backup `2026-09-19_world-lab_site-c-pre-homes`.

| House | Chest BLOCK | Facing (recommended) | Stand (not stored) | Bed HEAD (already present) | Entrance / approach |
| --- | --- | --- | --- | --- | --- |
| H1 | **-1096, 69, 729** | south | -1096, 69, 730 | -1097, 69, 728 | -1096, 69, 732 |
| H2 | **-1057, 68, 757** | west | -1058, 68, 757 | -1056, 68, 756 | -1060, 68, 757 |
| H4 | **-1056, 65, 780** | west | -1057, 65, 780 | -1055, 65, 779 | -1059, 65, 780 |
| H5 | **-1078, 69, 799** | west | -1079, 69, 799 | -1077, 69, 798 | -1081, 69, 799 |
| H9 | **-1066, 68, 847** | east | -1065, 68, 847 | -1067, 68, 848 | -1063, 68, 847 |

Communal (already installed, do not replace): chest **-1038, 65, 839** facing east; stand **-1037, 65, 839**. Register as `settlement.storage` only.

Example (H1): `/setblock -1096 69 729 minecraft:chest[facing=south] replace`

No blockers on those five cells from BLUE’s chest/home API. H6/H8 stay without chests (cramped). Do not lower roofs.

## First live probe (not run)

After RED installs chests **and** the user/RED grant exclusive WORLD-LAB access:

- Username `HomeProbe` (reserved). SQLite identity `probe_home` in a **temp** DB — not Atlas/Maya/Theo/Ava/Kai.
- Claim **H1** (`home_h1`). H4 bed stays **unclaimed** as the closer distractor. Tannery is the closer communal chest.
- Profile: `HOME_TEST_PROFILE=H1_PROBE` plus the three enable flags. Never 25565/25566. Never `pnpm sim:start`.

## Test evidence

| Layer | Result |
| --- | --- |
| Unit: claims, exclusive bed/chest, two residents one `homeId`, personal vs communal vs household, displace without silent overwrite, reopen/respawn upsert, leaveHome | **PASS** `homes.test.ts` (8) |
| Unit: designated sleep ignores closer bed; missing designated bed does not fall back; daytime `NOT_SLEEP_TIME` | **PASS** `world.test.ts` (3) |
| Unit: night + claimed home → `sleep`; no home → `seekSafety`; no roster farm jobs | **PASS** `planner.test.ts` |
| Guard: no connect without flags; H1 profile coords; refuse 25565/25566 | **PASS** `home-test-guard.test.ts` |
| Live A–E on WORLD-LAB | **NOT RUN** (server stopped; chests not placed; exclusive access not granted) |
| Planner autonomous house choice | **UNVERIFIED** (API only; no fake roster assignment) |
| Two probes sharing one house live | **SKIP / UNVERIFIED** until a house has two beds |

## Remaining before a five-citizen integration test

1. RED places the five chests, confirms install, starts WORLD-LAB, grants exclusive access.
2. BLUE runs `HomeProbe` H1 live A/B/D/E (and only then claims a live PASS).
3. Citizens must still **choose** homes; do not bind H1–H9 to roster names.
4. Do not connect all five citizens until that live probe PASS exists.
