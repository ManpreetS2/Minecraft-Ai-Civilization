# GREEN fishing visual replay (spectator)

Date: 2026-09-20  
Owner: Agent GREEN  
This is a **separate** demonstration. It does **not** replace [GREEN_FISHING_LIVE_RUN.md](./GREEN_FISHING_LIVE_RUN.md) (`FISHING_LIVE=PASS`, salmon ×1).

## Verdict

**VISUAL_REPLAY=PASS** (second physical catch with human spectator at the shore)  
**RETURN_HOME_LIVE=SKIP**

Original recorded result remains **FISHING_LIVE=PASS** (first salmon). This replay added a real **cod ×1** beside that salmon. Fish was not `/give`. Chest was not emptied.

If the human did **not** see the rod, bobber, pickup, or chest use, treat the *visual* part as INCONCLUSIVE even though the world delta is real.

## Spectator TEST_CONTROL (human only)

| Step | Result |
| --- | --- |
| Username on `list` | **Shadowskiii1** only (then FishProbe joined) |
| Prior gamemode / pos | spectator (3) at **-1035.93, 81.99, 807.37** |
| Camera used | **-1034.5, 70, 984.5** yaw 118 pitch 28 — **east of X=-1035**, outside X **-1051..-1035**, Z **972..988**. Suggested `-1038.5,67,984.5` was **not** used |
| Command | `gamemode spectator Shadowskiii1` then `execute in minecraft:overworld run tp Shadowskiii1 -1034.5 70 984.5 118 28` |
| During/after fish | Human had flown to **-1042.70, 63.65, 980.31** (origin/chest cells, still spectator) |
| Restore | spectator, returned to **-1035.933, 81.986, 807.367** |

FishProbe was TPed only to the origin (existing harness TEST_CONTROL). The human teleport did not move the bot.

## Chest (preserved first catch)

| When | `-1042,63,980` Items |
| --- | --- |
| Before replay | Slot 0 `minecraft:salmon` count 1 |
| After replay | Slot 0 `minecraft:salmon` count 1; Slot 1 `minecraft:cod` count 1 |
| Mining chest `-954,58,944` | still coal ×1 |

## Harness stdout (this replay only)

```
FISH_RECORD before inv={"fishing_rod":1} chest=[{salmon count 1}] tick=17049 pos=-1042.5,63.0,980.5
FISH_RECORD after  inv={"fishing_rod":1} chest=[salmon + truncated slot 1] tick=17709 pos=-1042.5,63.0,980.5

- PASS rod prerequisite fishing_rod=1
- PASS cancel before cast (1ms, internal abort — not a visible catch)
- PASS fish from shore (32883ms) catch={"cod":1} deposited=1 shore=-1043,63,980 water=-1044,62,980 casts=1
- PASS inventory or chest delta chestChanged=true
FISHING_LIVE=PASS
RETURN_HOME_LIVE=SKIP
elapsedMs=36136
exit_code: 0
```

TEST_CONTROL on the bot: `op`, `tp FishProbe -1042.5 63 980.5`, `clear`, `give fishing_rod 1`. No fish given. `FISH_TEST_PLACE_CHEST` unset. `FISH_TEST_RETURN_HOME` unset.

## Cleanup

FishProbe disconnected and already deopped. World `save-all flush`. Paper left on **25567**. Two-bot / `pnpm sim:start` not started. `executor.ts` not edited.
