# Minecraft AI Civilization

**Can independent AI citizens survive in Minecraft—and develop their own social behavior without a scripted story?**

![Status](https://img.shields.io/badge/status-research%20prototype-2563EB)
![Demo](https://img.shields.io/badge/next%20experiment-1v1%20%E2%86%92%202v2-7C3AED)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6)
![Minecraft](https://img.shields.io/badge/Minecraft-Java-56A86D)

Minecraft AI Civilization is an independent research and engineering project building **persistent, autonomous AI citizens** inside a single shared Minecraft survival world. Citizens should choose goals from their own needs and limited observations, act through real Minecraft mechanics, remember what happened, and freely decide whether to cooperate, avoid each other or form communities.

**No scripted mayor. No forced rivalry. No invented survival outcomes.**

> **Project status · November 1, 2026:** The first-public-demo design is locked, but the demo **has not been run or verified**. The repository contains a research prototype with older single-settlement development flows; later multi-agent code and security improvements remain in isolated engineering work. Offline and historical single-bot tests are **not proof of a working 2v2 civilization**.
>
> **Source of truth:** [Project charter and active first-demo specification](project.md). Older five-citizen starter-village plans are preserved for design history but **do not govern the next demo**.

## The first experiment: GPT vs Claude, without a scripted winner

<escape> </escape>

| | First technical gate | First public demonstration |
| --- | --- | --- |
| Citizens | **1 GPT-family + 1 Claude-family** | **2 GPT-family + 2 Claude-family** |
| World | One shared survival world | One shared survival world, two starting communities |
| Starting conditions | Independently controlled, auditable | Separate comparable natural sites, empty inventories, no starter shelter or supplies |
| Tasks | Verify physical survival, individual decisions, memory and message isolation | Citizen-directed food, shelter, gathering and interaction |
| Success condition | Validated system behavior and honest failure reporting | **60 continuous real-world minutes** with recorded outcomes and performance |
| Human help | Controlled setup and explicit test interventions | No rescue, free building, creative supplies or forced encounters during the run |
| Model family | Comparison variable, **not** a permission or team-memory key | Same tools and neutral survival prompts; no compulsory conflict or cooperation |

The starting communities may never meet. They may coexist, trade, compete, migrate or disagree. These are possible **observed outcomes**, not story beats imposed by the program. The demonstration will not establish which model family is generally “better” from a single run.

The initial demo uses **ordinary respawning with `keepInventory=false`**: death is logged, items drop, and citizen identity/history remain persistent. Permadeath belongs to later experiments after reliability is demonstrated.

## Architecture

The system is designed to keep **independent decision-making** separate from physical action:

```text
                     ONE MINECRAFT WORLD
                       Paper Java server
                               |
                    per-citizen observation
                               |
              +----------------+----------------+
              |                                 |
        Citizen A memory                  Citizen B memory
        beliefs + goals                   beliefs + goals
        authorized context                authorized context
              |                                 |
         GPT-family                         Claude-family
        decision source                    decision source
              |                                 |
              +----------------+----------------+
                               |
                   bounded task planning
                               |
               Mineflayer -> verified skills
                 gather / craft / move / build
                               |
                real world + inventory checks
                               |
                    SQLite + event audit
```

This is a **target separation of responsibilities**, not a claim that every arrow is integrated and production-tested today.

### The rules that matter

**Individual agency.** Citizens may choose their own high-level priorities. The operator must not force them into preassigned professions, alliances or conflicts.

**Physical grounding.** An intention or model explanation is not evidence of success. A task succeeds only when the Minecraft world or inventory confirms the change.

**Limited information.** World truth, a citizen's observations, another citizen's speech and a citizen's beliefs are different things. Private memories, unseen resource locations and operator audit logs must not silently appear in another mind.

**Persistent identity.** Reconnection or respawn does not reset a citizen's personality, private history or relationships. Each citizen requires an independently bounded model context.

**Scientific honesty.** Record world seed, server version, model and prompt settings, costs, TPS, interventions, retries, failures and confirmed outcomes. Distinguish offline mock results, live single-bot observations and actual multi-agent experiments.

## What has actually been demonstrated?

A **September 19, 2026 local engineering checkpoint** documented the following isolated, controlled single-bot results. These are historical local development observations, not evidence of a finished civilization or capabilities guaranteed by a fresh clone.

| Skill area | Documented historical result | Limitation |
| --- | --- | --- |
| Farming and food | Nine-cell wheat crop cycle, eight wheat collected, then bread crafting, storage transfer and eating | Accelerated crop growth during the isolated test |
| Home navigation | Travel to an assigned home, use of an already-open doorway, designated bed and personal chest | Does not prove universal navigation or autonomous house selection |
| Natural mining | Mined a naturally generated exposed coal ore and deposited the coal in an approved chest | A wooden pickaxe was supplied; not a full from-zero mining run |

Other development branches contain offline planner, executor, cancellation, crafting, persistence and simulated agent-isolation tests. These are useful engineering evidence but **do not replace a continuous live 1v1 or 2v2 run**.

### Remaining release gates

1. Independently verify cross-community information boundaries, legitimate speech and memory provenance, including historical SQLite recovery.
2. Make physical settlement state, homes, workstations and resource access genuinely community-scoped without invisible ownership rules.
3. Establish reliable from-zero food, crafting, shelter, movement and recovery under the chosen Minecraft protocol.
4. Verify independent live GPT/Claude model sessions with explicit, bounded API spending.
5. Run and instrument the **1v1** technical gate, then the **2v2 / 60-minute** demo with no rescue.

**Runtime selection:** Paper 1.21.6 build #48 is a selected experimental target for parity evaluation; the currently published older setup describes 1.21.11. **No upgrade is declared complete** until compatibility, game-rule, bot and skill tests are reproduced. The external `yc-software/minecraft-agent-harness` remains an evaluation candidate, **not** an adopted dependency.

## Technology

| Layer | Technology |
| --- | --- |
| Agent orchestration and skills | TypeScript, Node.js, pnpm |
| Minecraft | Java Edition, Paper, Mineflayer / PrismarineJS |
| Identity and audit persistence | SQLite, better-sqlite3 |
| Decisions | Validated high-level goals; experimental local or cloud LLM adapters |
| Test and verification | Vitest, controlled fake-body tests, planned instrumented live trials |
| Observation | Local dashboard and structured event history |

A consumer ChatGPT/Claude subscription does **not** include the project's paid model API calls. Actual provider requests will be opt-in, cost-capped and separately recorded.

## Getting started with the published prototype

This public repository is for exploration and development, **not a one-command reproduction of the approved 2v2 experiment**. Minecraft worlds, runtime SQLite databases, Paper JARs, credentials and private engineering work are not included.

**Prerequisites for offline source checks:** Git, Node.js **22+**, pnpm.

```bash
git clone https://github.com/ManpreetS2/Minecraft-Ai-Civilization.git
cd Minecraft-Ai-Civilization
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
```

For historical local Paper/Atlas setup, consult [server/README.md](server/README.md) and the example environment file. These guides document a legacy development path; do **not** assume its default citizen count, Minecraft version or starting world matches the planned 2v2 trial. Do not start real provider calls or alter an existing Minecraft world as part of ordinary offline validation.

The development server uses local-only offline Minecraft authentication for test bots. **Never expose that setup or the observer dashboard publicly.** Do not commit `.env` files, API keys, worlds, database snapshots or personal access tokens.

## Roadmap

| Stage | Direction |
| --- | --- |
| **Now** | Prove privacy, autonomous survival, execution and persistence through safe offline tests |
| **Technical gate** | 1 GPT citizen vs 1 Claude citizen in a real shared world |
| **Public demo** | 2 vs 2, 60 continuous real-world minutes, no scripted outcomes or rescue |
| **Research follow-up** | Repeated experiments, varied terrain/traits, longer duration, 3v3 |
| **Later systems** | Citizen-directed construction requests, optional human contractor records, economy, institutions, leadership, migration and population scaling |

The earlier five-citizen starter-settlement design remains in [historical design notes](docs/master-design-google-doc-mirror.md). It is neither the next demo nor an extra prerequisite. The full design rationale and research goals are in [project.md](project.md).

## Credits and research references

This is an independent research and portfolio project, **not affiliated with Mojang or Microsoft**. Relevant technologies and research include [PrismarineJS/Mineflayer](https://github.com/PrismarineJS/mineflayer), [PaperMC](https://papermc.io/), [Ollama](https://ollama.com/), [Generative Agents](https://github.com/joonspk-research/generative_agents), [Project Sid](https://arxiv.org/abs/2411.00114) and [Mindcraft](https://github.com/mindcraft-bots/mindcraft).

Referenced research is not presented as results produced by this simulation. Demo footage and reproducible field reports will be published only when actual Minecraft experiments justify them.
