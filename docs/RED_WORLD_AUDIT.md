# RED world audit

Date: 2026-09-19  
Role: Agent RED (world / Paper / construction infrastructure)  
Repo: `<WORKSPACE>`  
Branch: `integration/first-settlement-v2` @ `77e5c67`  
This file is an inspection record. It does not change the live world.

## Completed vs proposed

| Completed now | Proposed / not done |
| --- | --- |
| Inspected Git, Java, Paper jar, live `server/` runtime, plugins, worlds, logs, ports | Did not start or stop any Minecraft server |
| Identified live vs isolated environments | Did not install WorldEdit / FAWE / BuildPaste / InstaSchem |
| Copied a dated backup of the live worlds + configs | Did not generate the lab world yet |
| Prepared `world-lab/` with the **same** Paper 1.21.11-132 jar | Did not paste or build the starter settlement |
| Wrote this audit + `docs/RED_WORLD_PLAN.md` | Did not run `pnpm test` / `pnpm sim:start` (AI/BLUE surface) |

No Minecraft join was performed in this pass. No automated test suite was run.

## Git

- Branch tracks `origin/integration/first-settlement-v2`.
- Dirty tree includes AI/orchestrator/knowledge files that **Agent BLUE must own**. RED did not edit them.
- Tracked `server/` contents are docs only: `README.md`, `start.bat`, `*.example`. Jars, worlds, plugins, live `server.properties` are gitignored.
- `server/server.properties.example` is already modified in the working tree (colony `spawn-monsters=false`). RED did not change it.

## Java and Paper (actual runtime)

| Item | Observed |
| --- | --- |
| Java | Temurin **21.0.10+7** LTS (`java -version`) |
| Live jar | `server/paper.jar` 54,846,016 bytes, SHA-256 `5ffef465eeeb5f2a3c23a24419d97c51afd7dbb4923ff42df9a3f58bba1ccfba` |
| Declared version | `server/version_history.json`: **`1.21.11-132-c5eb079 (MC: 1.21.11)`** |
| Last boot log | `server/logs/latest.log`: Paper **1.21.11-132-ver/1.21.11@c5eb079** (2026-05-11), API `1.21.11-R0.1-SNAPSHOT` |
| Paper warning | “4 release(s) behind latest stable (26.2)” — **do not upgrade**; project lock is 1.21.11 |
| Heap (live) | `server/start.bat`: `-Xms4G -Xmx4G` |
| Auto-start | `apps/orchestrator/src/paper.ts` can spawn **`server/paper.jar`** when `AUTO_START_PAPER=true` and **25565** is closed |

Target version **1.21.11** matches the actual jar. Do not change it.

## Live / production world

**There is one civilization live world.** It is not named `world-lab`.

| | |
| --- | --- |
| Directory | `server/world` (+ `server/world_nether`, `server/world_the_end`) |
| Address | `127.0.0.1:25565` (docs warn that `localhost` has failed on this PC) |
| `level-name` | `world` |
| `level-seed` in properties | **empty** (first generation picked a seed) |
| Seed from `level.dat` `WorldGenSettings.seed` | **`-3807514935229766152`** |
| Spawn from `level.dat` `spawn.pos` | **236, 69, 202** overworld |
| DataVersion | 4671 |
| GameType in level | 0 (Survival) |
| Sizes | overworld **54M**, nether **17M**, end **2.2M**, **14** region files |
| `session.lock` | present, 3 bytes, timestamp 2026-09-17 17:59 — leftover; **no Java process** was listening on 25565/25566/25575/25576 at audit time |
| Last player activity | `latest.log` through 2026-09-17 ~21:26: `Shadowskiii1`, `MechProbe`, `MechProbeB`, `SwarmProbe`, citizens `Atlas`/`Maya`/`Theo`/`Ava`/`Kai` |
| Mechanics fixtures | RCON `fill`/`setblock` around **223, 60, 184** (MechProbe login). Live world is **already mutated**. Do not reset it. |

SQLite identity store (not a Minecraft world, not copied): `data/civilization.sqlite` (~12MB + WAL). RED did not touch it.

## Live server.properties (gitignored)

Observed, not rewritten:

- `online-mode=false`, `gamemode=survival`, `difficulty=easy` (not Peaceful)
- `spawn-monsters=false`, `spawn-protection=16`
- `server-port=25565`, `enable-rcon=true`, `rcon.port=25575`
- RCON password matches the documented mechanics default in `apps/orchestrator/src/rcon-once.ts`
- `generate-structures=true`, `view-distance=10`, `max-players=20`
- A Paper `management-server-secret` exists in this file. It is gitignored. **Do not commit it. Do not copy it into world-lab.**

`bukkit.yml`: `spawn-limits.monsters: 0`, `ticks-per.monster-spawns: 0`, animals still spawn (`animals: 10`, `animal-spawns: 400`).

## Plugins

Live `server/plugins/`:

| Plugin | Notes |
| --- | --- |
| `LocalObserver.jar` (1773 bytes) | Custom `civ.LocalObserver` 1.0.0, `api-version: 1.21`. Last log: “Shadowskiii1 will be OP + creative. AI citizens are unchanged.” |
| spark | bundled with Paper (not a separate construction plugin) |
| bStats / `.paper-remapped` | Paper runtime |

**No WorldEdit, FAWE, BuildPaste, or InstaSchem is installed on live.**

`server/plugins-build/` holds a tiny LocalObserver source stub (`plugin.yml` only; `out/` empty).

`ops.json` includes human `Shadowskiii1` plus citizens and probes (`Atlas`, `Maya`, `Theo`, `Ava`, `Kai`, `MechProbe`, `MechProbeB`, `MindcraftProbe`, `PhoenixProbe`, `SwarmProbe`).

## Isolated / throwaway environments (do not treat as live civ)

These already exist **outside** this repo. RED did not start them.

| Path | Role | Port (from that tree) |
| --- | --- | --- |
| `Desktop/paper_mindcraft_body_test` | Mindcraft body throwaway Paper **1.21.4** | **25566**, RCON 25576 |
| `Desktop/paper_1.21.4_swarm_test` | Older swarm Paper | inspect before reuse |
| `Desktop/mindcraft_body_test` | MindcraftProbe software | not Paper |
| `Desktop/minecraft_ai_sim_cognition` | git worktree `feat/cognition-v2-real` | not a world |
| `Desktop/minecraft_ai_sim_upstream` | git worktree | not a world |

There was **no** `world-lab` folder in the repo before this task.

## Backup created (copy only)

`<LOCAL_WORLD_BACKUPS>\2026-09-19_pre-red`

Contains `world/`, `world_nether/`, `world_the_end/`, and copies of live yml/properties/ops. Live `server/world/level.dat` still present after the copy. See `MANIFEST.txt` in that folder for rollback steps.

Rollback requires **stopped** Paper. Do not `/MIR`. Do not delete the live folders; rename them aside first.

## Isolated lab prepared (not started)

`<WORKSPACE>\world-lab`

- Same `paper.jar` SHA as live (version **not** changed)
- `eula.txt` copied from this machine (`eula=true`)
- `bukkit.yml` copied so monster spawn-limits stay 0
- Fresh `server.properties`: port **25567**, RCON **25577**, password `civ-world-lab-rcon`, seed **`20260919`**, `spawn-monsters=false`, `difficulty=easy`
- **No** live world copied in. First `start.bat` will generate a new world.
- Heap **2G** (live uses 4G)
- Inner `.gitignore` so jars/worlds are not committed
- `pnpm sim:start` still targets `server/` on 25565 only

## What RED did not touch

- Any file under `packages/`, `apps/`, `data/`
- Live `server/world*`, live `server.properties`, live plugins
- `docs/ARCHITECTURE.md`, `docs/DEVELOPER.md`, `package.json` (dirty in Git; likely BLUE)

## Next action

See `docs/RED_WORLD_PLAN.md` § “Exact next action”. Short form: **do not boot live 25565**; from `world-lab`, run `start.bat`, join `127.0.0.1:25567`, inspect biomes **before** installing any construction plugin or pasting houses.
