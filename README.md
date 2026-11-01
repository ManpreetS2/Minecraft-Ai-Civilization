# Minecraft AI Civilization

**Research prototype · TypeScript / Mineflayer / Paper / SQLite**

> **Project direction — November 1, 2026:** The **first public demonstration is a 1v1 technical trial followed by a 2v2, 60-minute wilderness experiment**: two independently thinking GPT-family citizens and two Claude-family citizens, in two starting communities within one survival world. The older five-citizen, prebuilt-village concept is historical. This checkout's older five-citizen commands and fixtures are **not** evidence that the new 2v2 is operational.
>
> **Authoritative design:** [Public project charter](https://github.com/ManpreetS2/Minecraft-Ai-Civilization/blob/main/project.md). If older files disagree on the demo, follow that charter. This private repository contains **engineering proposals and unfinished work**; the charter does not imply they are merged, secure or live-tested.

## What the first demo must show

- **Independent agents:** one identity, private memory and model session per citizen. GPT/Claude provider family is *not* a permission boundary.
- **World-grounded survival:** citizens start at separate, reasonably comparable natural locations, initially ~120–200 traversable blocks apart, with empty inventories, no starter buildings, no forced roles and no prescribed rivalry.
- **Legitimate information flow:** local observation, hearing, authenticated direct speech and deliberate sharing may inform a citizen; private thoughts, teammate memory, operator audit logs and distant settlement data must not automatically cross boundaries.
- **Physical results:** a citizen chooses goals; bounded Minecraft skills perform actions; world/inventory observations establish outcomes. Simple citizen-directed shelters are in scope, but large construction/contractor automation is not a demo prerequisite.
- **Observation, not a scripted winner:** 60 **continuous real-world minutes**, normal day/night and survival pressure, full failure/death/respawn, performance, cost and intervention records. Initial demo uses respawn with `keepInventory=false`; permadeath is deferred.

**Milestone order:** offline security/survival tests → real **1v1** technical trial → real **2v2 / 60-minute** run → later repeated experiments and advanced society systems. Offline mocks do not prove an agent survives in Minecraft.

## Engineering status (snapshot: November 1, 2026)

| Area | Status and evidence |
| --- | --- |
| Reviewed offline integration | Private `integration/weekly-2026-10-31` @ `17bff2d` integrates executor/gather, cancellation/recovery, crafting tests and **mock** per-session GPT/Claude isolation. Grok reported 1,062/1,064 passing tests; these were offline. |
| Secure cross-community communication | Proposed **separately**, `agents/claude-sec001-manager` @ `15804fa`. Manager-level audience routing, reported-speech provenance and read-time fact checks have offline tests, **not** independent security acceptance or live `/tell` verification. |
| Historical SQLite security QA | `agents/codex-sec001-migration-QA` @ `5df239c`. Real disposable SQLite recovery tests exist, with unresolved negative security assertions on the older SEC-001-A revision. Needs replay on Claude's revision. |
| Additional reliability fixes | Draft PR #1 and separate Claude review branch `agents/claude-pr1-review`. **Neither is part of the weekly integration** and no paid-cloud billing claim has been live verified. |
| Real 2v2 release | **Not ready.** Per-community physical settlement/home/workstation state, independent QA, live communications, 1v1 and 60-minute field results are still pending. |

See [Current engineering status](docs/CURRENT_STATUS_2026-11-01.md), [working across laptops and agents](docs/DEVELOPMENT_WORKFLOW.md) and [private coordination issue #2](https://github.com/ManpreetS2/Minecraft-Ai-Civilization-windows-backup/issues/2). For the previous checkpoint, see [October 31 handoff](docs/project-management/HANDOFF_2026-10-31.md).

## Architecture at a glance

```text
                  ONE SURVIVAL MINECRAFT WORLD
                        Paper + Mineflayer
                                 |
                    individual observations
                                 v
                 per-citizen identity / private history
                                 |
                     bounded high-level decision
                                 v
                    planner -> verified skills
                                 |
                  Minecraft world & inventory
                                 |
                    SQLite / event audit log
                                 |
               per-recipient authorized information
```

The runtime architecture is evolving. The `@civ/session-isolation` package provides **mock-adapter** tests, not proof of live GPT/Claude provider integration. See [Architecture](docs/ARCHITECTURE.md).

## Developer setup — offline first

**Prerequisites:** Git, Node.js **22+**, pnpm and access to this private repository. Java 21 and a compatible Paper server are required only for an expressly authorized live test.

```bash
git clone https://github.com/ManpreetS2/Minecraft-Ai-Civilization-windows-backup.git
cd Minecraft-Ai-Civilization-windows-backup
git fetch --all --prune
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm lint
```

**Read the test output rather than assuming the suite is fully green.** The October 31 weekly integration handoff documented two pre-existing test failures and ten typecheck diagnostics; results vary by branch and machine. No Paper server or cloud API is needed for the ordinary offline tests.

For active engineering, create a **separate worktree/branch** from the correct pinned checkpoint. Do not put SEC-001, Codex negative QA branches, and the weekly integration together without an explicit review. See [Development workflow](docs/DEVELOPMENT_WORKFLOW.md).

### Older local simulation and Paper configuration

The existing `pnpm atlas` CLI and `pnpm sim:start` script target **legacy development flows** (including five-citizen configurations), **not** the approved first 2v2 demo. Only use them when intentionally running a separately authorized legacy/local test.

The previous machine's documented Paper setup was **1.21.11 build 132**. The next experiment's selected comparison target is **Paper 1.21.6 build #48**, subject to offline compatibility/parity verification; this is **not an instruction to upgrade or overwrite an existing world**. Check [server setup](server/README.md) and the [developer notes](docs/DEVELOPER.md) for legacy instructions.

Never commit `.env`, API keys, SQLite/WAL databases, Minecraft worlds or local logs. Git does not synchronize ignored files. Development Paper may use offline authentication **only on a private loopback network**.

## Roadmap and exclusions

First prove authenticated observation and privacy, realistic food/shelter acquisition, isolated cognition, robust inventory/claims and repeatable 1v1 behavior. Next run the independent 2v2 survival demonstration without human rescue. Later work may explore emergent leadership, trade, human-supplied construction, politics, history and scaling—but those systems are **not** first-demo acceptance gates.

The experimental `yc-software/minecraft-agent-harness` is a **candidate for isolated evaluation**, not an adopted dependency. No agent has arbitrary shell, host credentials or uncontrolled internet access as an in-world skill.

## Attribution

This is an independent research/portfolio project, unaffiliated with Mojang or Microsoft. See [third-party notices](THIRD_PARTY_NOTICES.md), [Mineflayer](https://github.com/PrismarineJS/mineflayer), [PaperMC](https://papermc.io/), and [Ollama](https://ollama.com/). Any future demonstrations must distinguish real Minecraft evidence from offline simulation and human-supplied changes.
