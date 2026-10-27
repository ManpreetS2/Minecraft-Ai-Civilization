# GREEN two-bot fishing live (2026-09-20)

Owner: Agent GREEN  
Harness: `pnpm mechanics:two-fish`  
Bounded **2-each** same-pond check: **PASS**. Historical 5-each runs remain PARTIAL. `pnpm sim:start` was not started. `executor.ts` was not edited.

## TWO_BOT_FISHING=PARTIAL

Verified inventory/chest fish only. Overlapping connections are not treated as concurrency success.

| Run | Kai | Atlas | Notes |
| --- | --- | --- | --- |
| 1 | **0/5** deposit 0 | **1/5** cod, deposited | Concurrent windows; 12 attempts in ~54s |
| 2 | **0/5** | **1/5** salmon, deposited | Leftover run-1 cod not counted |
| 3 | **0/5** | **0/5** | Splash-only; user saw bobber dips with no reel |
| 4 | stopped | stopped | User stop; bots kicked; no new chest fish |

**KAI_CATCHES=0/5** (all launched runs)  
**ATLAS_CATCHES=2** genuine fish across runs 1–2 (cod + salmon), **not** 5/5 in one concurrent session  
**KAI_DEPOSIT=0/5**  
**ATLAS_DEPOSIT=** chest now holds leftover **cod ×1 + salmon ×1** from those two verified Atlas deposits  
**TWO_BOT_CONCURRENCY=FAIL** (both bots never had verified catches in the same session)  
**STORAGE_ISOLATION=PASS** (Kai chest stayed empty; Atlas chest only received Atlas deposits)  
**RETURN_HOME=SKIP**  
**MISSING_FISH_INVESTIGATION=INCONCLUSIVE**

### Preserved world (RCON after stop)

| Chest | Contents |
| --- | --- |
| Kai `-1042,63,980` | `Items: []` |
| Atlas `-1042,63,982` | salmon ×1 + cod ×1 (genuine prior deposits; **not replaced**) |
| Mining `-954,58,944` | coal ×1 |

Paper **1.21.11-132** left running. Human only on `list`. Test bodies disconnected.

---

## Bounded 2-each live check (user-approved, 2026-09-20 16:33–16:34)

Harness: `pnpm mechanics:two-fish` with **`TWO_FISH_TARGET=2`**. Adapter: `runMineflayerFishCycle`. Log: [GREEN_TWO_FISH_CHECK2.log](./GREEN_TWO_FISH_CHECK2.log). **Not** a five-each rerun. **Not** `sim:start`.

| | |
| --- | --- |
| Connect | Kai+Atlas **23:33:32Z** together; `list` Shadowskiii1, Kai, Atlas |
| Human | Start **~-1047.8,62.5,979.8** (water west of pond, not on a stand/chest). Not kicked. After: **~-1042.8,63.7,981.4** |
| Windows | Kai 56.5s; Atlas 53.8s; overlapping |
| Bobbers | Kai **3013** then **3043**; Atlas **3014** then **3047**. No shared ids |
| Bites | Both reels were `own-particle-bite` (2 each). Atlas second bite before Kai’s second |
| Exit | **0** |

```
KAI_NEW_CATCHES=2/2
ATLAS_NEW_CATCHES=2/2
KAI_NEW_DEPOSIT=2/2
ATLAS_NEW_DEPOSIT=2/2
TWO_BOT_FISHING=PASS
BOBBER_OWNERSHIP=PASS
BITE_RESPONSE=PASS
STORAGE_ISOLATION=PASS
```

Chest after (slot RCON; list NBT is truncated so do not use the harness `CHEST_DELTA atlas=0` line):

| Chest | Before | After |
| --- | --- | --- |
| Kai `-1042,63,980` | empty | **cod ×2** (both new) |
| Atlas `-1042,63,982` | cod ×1 + salmon ×1 | **cod ×1** (old), **salmon ×2** (old+1 new), **tropical_fish ×1** (new) |
| Mining `-954,58,944` | coal ×1 | coal ×1 |

Kai species this run: cod, cod. Atlas species this run: tropical_fish, salmon. Inventories after deposit: rod only (damage 2).

---

## Installed Mineflayer vs GitHub master

| | |
| --- | --- |
| Installed | **mineflayer@4.39.0** (`packages/minecraft-adapter` range `^4.37.1`) |
| Local plugin | `node_modules/.pnpm/mineflayer@4.39.0/node_modules/mineflayer/lib/plugins/fishing.js` |
| Example | `examples/fisherman.js`: equip rod, `await bot.fish()`, optional `playerCollect` recast |
| API | `bot.fish()` — Promise, “Use fishing rod”; `activateItem` is eat/shoot/throw/rod toggle |

Installed `fishing.js` matches current GitHub master for this plugin: `lastBobber = first spawn_entity of fishing_bobber while task active`, reel on `world_particles` fishing/bubble **amount 6** within **1.23** of that bobber.

We **do not** call stock `bot.fish()` for Kai+Atlas together. The installed plugin still registers global `spawn_entity` / `world_particles` listeners on every bot, but they only `activateItem` while `bot.fish()` is in flight (`fishingTask.done === false`). Nothing in this repo calls `bot.fish()`.

1.21.11 `fishing_bobber` entity id is **156**. Spawn packet includes `objectData` (thrower entity id). Metadata keys include `hooked_entity` and `biting`. Mineflayer’s entity plugin does **not** copy `objectData` onto the entity; the adapter reads it from the spawn packet.

---

## CONFIRMED vs UNVERIFIED

### CONFIRMED (code + this lab’s logs)

1. **Our skill never used `bot.fish()`.** `fish.ts` toggled `activateItem` and waited on `soundEffectHeard` / (later) splash-only. That is not the official cycle.
2. **`activateItem` is a rod toggle.** A second call while a bobber is out reels. Duplicate cast on the same client can retract the active hook. Seen in our loop: cast, then always `activateItem` again after `waitForBite`.
3. **Bite listening was world-wide on each client.** `waitForBite` set `splash=true` on any matching sound that client heard. After we narrowed to `fishing_bobber.splash`, run 3 still SEARCH_EXHAUSTED in ~4.5s per miss (throw/landing) or waited without reeling on a visible dip.
4. **Nearest-any-bobber.** `findBobber` picked the first/nearest `fishing_bobber` in `bot.entities`, not “the bobber this client just spawned.”
5. **Run 3 missed visible bites.** User saw bobbers dip; we had **removed velocity dip** and required a splash string. Ledgers: Kai 12× SEARCH_EXHAUSTED in 53s; Atlas 11 short misses then one ~47s miss. **0 fish** that run.
6. **Atlas did catch real fish** in runs 1–2 (advancement + chest NBT). Kai never did.
7. **Harness `TWO_BOT_CONCURRENCY=PASS` was only overlapping wall-clock windows**, not two successful independent wait-for-own-bite cycles.

### UNVERIFIED (do not treat as proven cause of the failed runs)

1. Whether stock `bot.fish()` **would have** bound Kai to Atlas’s bobber in this pond. The first-`spawn_entity` behavior is **in the installed plugin**; we did not call `bot.fish()` live.
2. Whether fishing hooks physically collided / despawned each other. No entity-id logs from the live runs.
3. Exact packet names Mineflayer emitted for those dips (`world_particles` vs sound vs velocity vs `biting` metadata).
4. Whether Paper 1.21.11 always fills spawn `objectData` with the thrower’s entity id. Adapter tests cover the field; live has not been re-run.

---

## What changed in this repo (no live relaunch)

- `packages/skills/src/mineflayer-fish-cycle.ts` — per-bot adapter (not a `node_modules` patch, not stock `bot.fish()`):
  - WeakMap inflight **per bot object**; duplicate cast returns `already-fishing` with **zero** `activateItem`.
  - Snapshot preexisting bobber ids, then bind only a **new** hook whose spawn `objectData` (thrower entity id) matches **this** bot. Known-foreign hooks are never selected. Nearest-unlabeled fallback waits 250ms so the first observed unlabeled spawn is not treated as `lastBobber`.
  - Reel only on upstream **own** particle (fishing/bubble ×6, dist ≤ 1.23 of the bound hook) or 1.21 `biting` metadata on **that** entity id.
  - Timeout/cancel reels **that** client only, and only if its bound bobber still exists. `entity_destroy` of the bound hook does not extra-toggle.
- `packages/skills/src/fish.ts` — one adapter cycle per cast; inventory-delta verification + authorized chest deposit unchanged. `waitForBite` / nearest-any-bobber / post-wait `activateItem` removed from the live path.
- `apps/orchestrator/src/live-two-fish-test.ts` — `TWO_BOT_FISHING` / concurrency require verified catches, not mere overlap. Separate bodies, ledgers, chests.
- `THIRD_PARTY_NOTICES.md` — mineflayer@4.39.0 fishing plugin attribution.

Unit tests: `packages/skills/src/mineflayer-fish-cycle.test.ts` (**15**) plus fish/quota/guard.

**48** targeted tests passed. This is **not** a live two-bot PASS.

node_modules was **not** patched. BLUE navigator / `executor.ts` were **not** edited. `pnpm sim:start` / `pnpm mechanics:two-fish` were **not** started.

---

## Proposed bounded live validation (do not run until requested)

Same WORLD-LAB, same chests (do not clear Atlas’s cod+salmon; count only **new** inventory deltas).

1. Stands: keep Kai `-1043,63,980` and Atlas `-1044,63,981` first. Water cells are ~1.41 apart, which is **greater** than upstream particle radius 1.23, so *if* bobbers stay on those cells, particles should not cross. If RED sees hooks overlapping, propose Atlas `-1044,63,983` **without placing blocks** until approved.
2. Timeout 180–420s, target 2 fish each for a short check (not a cognition test), then 5/5 if that holds.
3. Require `FISH_ROD` lines: per-bot `cast` / `bind bobberId=` / `own-particle-bite` or `own-biting-metadata` / `reel`. Fail the run if one bot’s particle or biting packet reels the other. Confirm `bobberId` differs.
4. `TWO_BOT_CONCURRENCY=PASS` only if both have verified new catches while both remain connected.
5. HomeProbe may stay outside the fishing AABB. No `sim:start`, no time/weather, no `/give` fish.
