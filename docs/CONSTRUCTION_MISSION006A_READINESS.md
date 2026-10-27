# Mission 006A — Physical Construction Readiness

Date: 2026-10-26  
Branch: `integration/reliability-pr7-windows` @ `019d26d`  
**Physical Minecraft: NOT EXECUTED**

## Preservation evidence

| Asset | Path | SHA256 (at prepare) |
| --- | --- | --- |
| Original World-Lab `server.properties` | `world-lab/server.properties` | `7168F3F95F2A6C47F87CB64DF1FC0F67D6F22F768A1C6DB3A284E7D5E111B021` |
| Original sqlite | `data/world-lab-civilization.sqlite` | `037A0F751FEC685D411664BE2815657B7B49AC7FFFDB92E4443104BAE51E57E4` |
| Original ports | Paper **25567** / RCON **25577** | unchanged after copy |

Post-copy re-hash confirmed originals **unchanged** (`originalUnchangedAfterCopy: true` in manifest).

## Isolated environment

| Item | Path / value |
| --- | --- |
| Root | `experiments/construction-006a/` |
| World-Lab copy | `experiments/construction-006a/world-lab-isolated/` |
| SQLite copy | `experiments/construction-006a/world-lab-civilization.sqlite` |
| Evidence | `experiments/construction-006a/evidence/` |
| Isolated ports | Paper **25568** / RCON **25578** (patched in **copy only**) |
| `AUTO_START_PAPER` | **false** (pinned) |
| Symlinks | none (plain Directory) |
| Rollback | `experiments/construction-006a/ROLLBACK.md` |

Proposed pad: `(-900, 70, 700)` — ≥48 blocks from H9 / claimable homes (catalog check). Operator must still verify chunk loaded + empty before any live stage.

## Runtime readiness

**Call path:** `buildStructure` → `executeBuildStructurePlan` → `dispatchCitizenBuildIntention` → `advanceBlueprintBuild` → `placeBlock` → observe → reconcile (+ door/bed properties) → SQLite persist.

| Risk | Mitigation / status |
| --- | --- |
| Nav / reach | Live unverified; abort on PATH_BLOCKED |
| Neighbor support | `placeBlock` fails closed without support |
| Equip / inventory | ITEM_NOT_FOUND / EQUIP_FAILED abort; evidence logs pre/post |
| Door upper + facing | Offline verified; live still risk |
| clearSite digging | Now refuses `isProtectedFurnitureName` before dig |
| H9 / settlement | Site select + pad distance gate; clearSite ACCESS_DENIED on furniture |
| Persist ≠ COMPLETE | Existing Mission 002–005 gates |
| Compilation | Construction suites pass; unrelated agent-core WIP `tsc` noise may remain |

## Stages — GO/NO-GO (physical)

| Stage | Verdict | Why |
| --- | --- | --- |
| 1 One block | **NO-GO** | No operator live authorization; offline prep only |
| 2 Wall | **NO-GO** | Depends on stage 1 live proof |
| 3 Door | **NO-GO** | Depends on 1–2; live state risk |
| 4 Cabin | **NO-GO** | Depends on 1–3 |

## Authorization required before Minecraft

Explicit operator sentence approving **one** stage on the **isolated** copy (25568), with Atlas only, no cheats, evidence logging on, and confirmation that original 25567 World-Lab stays stopped/untouched.

## Commands (documented, not run live)

See `experiments/construction-006a/OPERATOR_COMMANDS.md`.
