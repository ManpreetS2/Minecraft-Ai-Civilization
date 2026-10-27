# GREEN fishing live run (FishProbe)

Date: 2026-09-20 (afternoon, local)  
Owner: Agent GREEN  
Harness: `pnpm mechanics:fish` → `apps/orchestrator/src/live-fish-test.ts`  
Guards: `apps/orchestrator/src/fish-test-guard.ts`  
Skill: `packages/skills/src/fish.ts` `fishAtShore`  
This is a **live** result. Unit tests are not this PASS. Mining live PASS at commit `e7d594d` is unchanged.

## Verdict

**FISHING_LIVE=PASS**  
**RETURN_HOME_LIVE=SKIP**

FishProbe has no claimed home and the harness was launched **without** `FISH_TEST_RETURN_HOME` / `FISH_TEST_HOME`. H1 was not assigned to this test bot. Leaving the shore was not counted as arrival at home.

World and item evidence below. Catch was not `/give`. Water was not `/setblock`. `FISH_TEST_PLACE_CHEST` was **unset**. The two-block log-detour was not used.

## Lab and exclusive access

| Check | Result |
| --- | --- |
| Paper | **1.21.11-132** `c5eb079` on **127.0.0.1:25567**, RCON **25577** |
| Ports 25565 / 25566 | Closed during preflight (lab was down; GREEN started existing `world-lab/paper.jar`, no reset, not 25565) |
| `list` before launch | 1 player: **Shadowskiii1**. No HomeProbe / FarmProbe / MineProbe / MechProbe / FishProbeB |
| BLUE | Idle. No HomeProbe on `list`. User reported one-block landing / hazard / walk-home PASS separately; FishProbe did not route that unverified two-block log detour |
| RED chest | Installed after user approval: `setblock -1042 63 980 minecraft:chest[facing=west] keep`. Pre-launch RCON: chest, `Items: []` |
| Human pre-launch | **[-1100.8, 77.5, 867.6]** — outside X **-1051..-1035**, Y **61–65**, Z **972..988** |
| Human post-run | **[-1060.6, 46.2, 823.8]** — still outside the fish box |
| `pnpm sim:start` / two-bot | Not started |
| `executor.ts` | Not edited this pass |

## Approved bound actually used

| Env | Value |
| --- | --- |
| `FISH_TEST_ORIGIN` | **-1043,63,980** (dry grass; harness tp `-1042.5 63 980.5`) |
| `FISH_TEST_CHEST` | **-1042,63,980** |
| `FISH_TEST_RADIUS` | 8 |
| `FISH_TEST_CASTS` | 1 |
| `FISH_TEST_TIMEOUT_MS` | 90000 |
| `FISH_TEST_PLACE_CHEST` | **unset** (RED already placed) |
| `FISH_TEST_RETURN_HOME` / `FISH_TEST_HOME` | **unset** |
| Username | FishProbe |
| `AUTO_START_PAPER` | false |

## TEST_CONTROL (actual)

1. `op FishProbe`
2. `tp FishProbe -1042.5 63 980.5` → origin cell **-1043,63,980** (not a long overland walk)
3. `clear` (empty)
4. `give FishProbe minecraft:fishing_rod 1` — **one** unenchanted rod. **No fish given.**

Shore/water RCON after the run: origin still air; west water **-1044,62,980** still water.

## Harness stdout (actual)

```
FISH_RECORD before inv={"fishing_rod":1} chest=... Items: [] tick=9782 pos=-1042.5,63.0,980.5
FISH_RECORD after inv={"fishing_rod":1} chest=... [{Slot: 0b, id: "minecraft:salmon", count: 1}] tick=10002 pos=-1042.5,63.0,980.5

- PASS server version 1.21.11 (Paper 1.21.11-132)
- PASS rod prerequisite (18ms) fishing_rod=1
- PASS cancel before cast (1ms) Fishing task cancelled
- PASS fish from shore (10740ms) catch={"salmon":1} deposited=1 shore=-1043,63,980 water=-1044,62,980 casts=1
- PASS inventory or chest delta inv {"fishing_rod":1} -> {"fishing_rod":1}; chestChanged=true
FISHING_LIVE=PASS
RETURN_HOME_LIVE=SKIP
elapsedMs=14061
exit_code: 0
```

Player inventory stayed rod-only because the salmon was **deposited**. Tick delta 9782→10002 is 220 ticks (~11 s), matching the 10740 ms fish stage. Position after fishing is still the origin stand, not a home bed.

## Independent world evidence (after disconnect)

RCON:

- `execute if block -1042 63 980 minecraft:chest` → **Test passed**
- `data get block -1042 63 980 Items` → `[{Slot: 0b, id: "minecraft:salmon", count: 1}]`
- Mining chest `-954, 58, 944` still `[{Slot: 0b, id: "minecraft:coal", count: 1}]`
- Mined coal cell `-953, 58, 946` still air
- `list` → Shadowskiii1 only; FishProbe disconnected
- `deop FishProbe` → already deopped by the harness

## Cleanup

GREEN fishing/mine forceload marks removed. `forceload query` after cleanup: **none**. World saved (`save-all flush`). Paper left running on 25567. FishProbe controls (op, connection) cleared. The salmon in the FishProbe chest is the catch evidence (same pattern as mining coal ×1).
