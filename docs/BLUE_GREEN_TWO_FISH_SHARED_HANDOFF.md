# BLUE → GREEN shared WORLD-LAB handoff (two-fish)

Date: 2026-09-20  
From: Agent BLUE  
To: Agent GREEN  
Server: isolated WORLD-LAB Paper **1.21.11-132** `127.0.0.1:25567` / RCON **25577**

**This is not a fishing PASS.** BLUE did **not** launch `pnpm mechanics:two-fish` and did **not** edit GREEN fishing code.

---

## TWO_FISH_BLUE_SHARED=true

GREEN is authorized to set **`TWO_FISH_BLUE_SHARED=true`** for the user-approved bounded two-bot fishing test (**Kai** + **Atlas**) on this WORLD-LAB.

BLUE exclusive HomeProbe window is **closed** and **will not be reclaimed** for the duration of that run.

---

## Confirmations (checked live just before this handoff)

| Item | Status |
| --- | --- |
| BLUE oak-log + curfew live tests | **Finished.** `TWO_BLOCK_DETOUR_LIVE=PASS`, `CURFEW_LIVE=PASS`. Evidence: [BLUE_OAK_LOG_AND_CURFEW_LIVE.md](./BLUE_OAK_LOG_AND_CURFEW_LIVE.md) |
| BLUE live harness process | **None.** No `live-oak-log` / `live-curfew` / `live-home` / `live-movement` node process |
| HomeProbe | **Disconnected.** `list` has no HomeProbe. RCON `data get entity HomeProbe Pos` → no entity |
| FishProbe / Kai / Atlas | **Not on `list`** (GREEN has not launched yet) |
| Paper | **Left running.** Not restarted by BLUE |
| `pnpm sim:start` | **Not started** |
| Occupant | Human **Shadowskiii1** at **~-1045.5, 65.9, 972.0** — south of the pond, **not** on Kai/Atlas stand or chest cells. Not kicked. |

Fishing AABB for the planned stands/chests (`-1043,63,980` / `-1044,63,981` / `-1042,63,980` / `-1042,63,982`, pad 3) is about **X -1047..-1039, Z 977..985**. Human Z **972** is outside that box. GREEN still must re-read occupants at launch.

---

## BLUE commitments during GREEN’s Kai+Atlas fishing window

1. **Finished / nonconflicting.** No BLUE live test is running. HomeProbe stays off unless later parked at H1 (`~-1097,69,728`) or the disposable pad (`~200,67,400`), both outside the fishing AABB. BLUE will not enter the pond work box.
2. **No interference with Kai or Atlas.** BLUE will not kick, disconnect, teleport, deop, `/clear`, or otherwise mutate Kai, Atlas, FishProbe, or FishProbeB while GREEN’s two-fish harness owns them.
3. **No global mutation.** BLUE will not restart Paper, `time set`, `weather`, change gamerules, forceload the pond, or edit shared fixtures (Kai chest `-1042,63,980`, Atlas chest `-1042,63,982`, mining chest `-954,58,944`, Site C, farm pad, H1 furniture).
4. **HomeProbe, if connected later, stays out of the fishing area.** GREEN’s guard may leave HomeProbe connected when it is outside the AABB. BLUE will not stand HomeProbe on a stand/chest cell.
5. **No exclusive reclaim.** No BLUE cleanup, list-sweep, or “exclusive WORLD-LAB window” kick will run during this test. The earlier FishProbe kick (exclusive HomeProbe window after a reported GREEN disconnect) **will not be repeated**.

GREEN owns pond time/weather/gamerules for this run. BLUE will not take them.

---

## What GREEN should set (BLUE does not launch)

```
TWO_FISH_BLUE_SHARED=true
```

Keep BLUE’s home/curfew flags **unset** so they do not collide with GREEN’s two-fish guard:

- `MECHANICS_HOME_TEST_ENABLED` unset
- `MECHANICS_CURFEW_TEST_ENABLED` unset
- `MECHANICS_FARM_TEST_ENABLED` unset
- `MECHANICS_TWO_PROBE_TEST_ENABLED` unset

BLUE is **not** starting `pnpm mechanics:two-fish`, `pnpm mechanics:fish`, or `pnpm sim:start`.
