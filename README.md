# Minecraft AI Civilization 🏰

**What happens when five persistent AI citizens share a Minecraft world long enough to build a society of their own?**

Minecraft AI Civilization is an experimental, local-first multi-agent simulation. Its citizens have separate identities, limited observations, memories, and goals; they act through real Minecraft bodies. The aim is to study how survival, cooperation, conflict, households, construction, and eventually economies and institutions might emerge **without scripting the outcome**.

![Status: experimental](https://img.shields.io/badge/status-experimental-orange) ![Minecraft Java 1.21.11](https://img.shields.io/badge/Minecraft_Java-1.21.11-56A86D) ![TypeScript](https://img.shields.io/badge/TypeScript-monorepo-3178C6)

> **Project status:** The public repository contains an **experimental five-citizen prototype** built around Paper, Mineflayer, TypeScript, SQLite, a deterministic planner, optional local Ollama cognition, and a local observer dashboard. **Option A is the current design direction, not a list of finished features.** Some mechanics and tests discussed in the project's design documents are being developed or evaluated locally and have not been verified in this public GitHub revision. A self-sustaining, multi-generation society has **not** been demonstrated.

## 🌍 Option A: start with a world, not a civilization

Instead of giving the agents a giant modpack, a preassigned city, or a scripted government, the first experiment uses **spacious, mostly vanilla survival terrain** and a small **human-provided starter settlement**. The human supplies a workable environment and optional infrastructure; the citizens decide what happens afterward.

| Human provides at the start | Citizens decide over time |
| --- | --- |
| A reproducible plains/river or valley world, with nearby forest, accessible caves and mining resources, and room to expand | What to explore, gather, grow, build, repair, share, trade, or abandon |
| Three simple houses, at least five reachable beds, a small crop farm, shared storage/workstations, paths, and **finite, logged** starter supplies | Their own homes, household arrangements, personal possessions, relationships, and priorities |
| Optional building tools and later automation services | Whether to commission a building or machine, where to put it, who owns it, and whether the price is worth paying |

The starter settlement is a **research scaffold**, not evidence that the AI built a village. Every supplied building, resource, gamerule, terrain alteration, and human intervention should be recorded. Citizens may later renovate, expand, repurpose, or leave the starting area.

The first world should be easy for the *current physical bot* to navigate: usable doors, beds and chests, simple paths, no forced deep-water crossing, and open plots. Custom terrain maps and Paper-side plugins are **candidates to test in a separate world copy**, not installed or validated dependencies.

### Five founders, no assigned social script

**Atlas · Maya · Theo · Ava · Kai** begin as five separately persistent adult citizens. They should **not** start with assigned farmer/miner/leader jobs, friendships, a religion, a government, fixed market prices, or a predetermined social outcome.

A shortage can be observed by the simulation, but it should not become an invisible manager ordering everyone to farm. A citizen can ask for help, offer a trade, refuse, change goals, or disagree. The early experiment measures what actually happens—not what the designer wishes had happened.

### Citizen-led construction, human-provided capability

A planned **contractor system** makes building less tedious without pretending that pasted structures were physically built by AI citizens:

\`\`\`text
Observed need / citizen proposal
           ↓
Citizen chooses structure and site
           ↓
Optional contractor quote → accept, reject, or negotiate
           ↓
Verified payment / resource reservation
           ↓
Human installs a catalog building in Minecraft
           ↓
Verify real blocks, access, ownership, and settlement once
\`\`\`

The proposed catalog starts small: **house, crop farm, warehouse/market stall, and a real-output automated farm**, using vanilla blocks. A schematic-pasting tool such as WorldEdit or BuildPaste would be tested for exact Paper/version compatibility in an isolated copy before adoption. **Citizens do not receive unrestricted OP, WorldEdit, or RCON access.**

The human is an optional **contractor**, not the ruler of the civilization. A citizen may also choose ordinary, block-by-block construction; the experiment must label the difference.

### Real automation, not free resources

Citizens may commission a redstone/hopper crop farm, a collection mechanism, or later a livestock feeding trough. The human can install its physical machinery, but citizens decide **whether** to use it, manage its inputs, access, and ownership, and respond to its economic consequences.

Automation must consume or produce **actual Minecraft items/entities**. No invisible deposits, imaginary per-tick production, duplicated funds, instant-grown crops, or fabricated ore. Log the operator, material inputs, real inventory output, throughput, and maintenance. A villager-operated or redstone farm is **external infrastructure**, not independent AI citizen labor.

These building, contract, and automation systems are **planned experiments**, not implemented production features in the current public repository.

## 🧠 Design: a citizen is more than a bot connection

The design separates three things:

| Layer | Responsibility |
| --- | --- |
| **Physical body** | A Mineflayer client moves, looks, interacts, collects items, uses tools, and reports what *actually* occurred in Minecraft. |
| **Persistent citizen** | An identity with its own experiences, knowledge, preferences, needs, relationships, home, and commitments; it survives disconnects and restarts. |
| **Cognition and planning** | The citizen chooses **what/why**; bounded skills handle **how**. Optional model inference supports high-level deliberation rather than controlling movement every tick. |

\`\`\`text
One shared Paper world
       │ real, limited observations
       ▼
Five separate citizen identities ↔ SQLite memories / relationships
       │ intentions and bounded tasks
       ▼
Skill engine → Mineflayer body → actual world interaction
       │                               │
       └──── verified result / error ◄┘
                   │
          Events + observer dashboard
\`\`\`

**World truth ≠ citizen perception ≠ citizen belief ≠ model narration.** An ore behind a wall, the contents of an unopened chest, or another citizen's private intention must not become magically known just because the game server can access it. Memory can be incomplete, subjective, outdated, or contradicted by later observation.

The intended decision loop is *perceive → interpret → remember → choose intention → act through bounded skills → verify → update memory*. Immediate lethal danger may warrant a deterministic reflex; non-emergency choices should not be silently overridden by a central job scheduler.

> **Current-code boundary:** The public prototype contains shared settlement needs, deterministic task assignments, and optional high-level model decisions. The fully independent, citizen-owned choice loop described here is a **target architecture**, not an already-proven property of the released simulator.

### Physical actions must be verified

\`\`\`text
intention → plan → execute → observe world/inventory → verify → recover or fail
\`\`\`

A model saying “I harvested wheat” is not evidence that wheat was grown, harvested, picked up, or deposited. A claimed building is not complete until its blocks and usability are checked. Failed routes, inventory mismatches, and timeouts must be visible, not rewritten as success.

## 🧪 First experiment: a stable five-citizen village

**The next milestone is reliability, not adding 100 bots.**

1. **Choose and record a world.** Back up the current Paper/world setup; test candidate terrain and any plugin in an isolated copy. Document seed, map/version, starting inventories, structures, difficulty, mob settings, and interventions.
2. **Make the starter village physically usable.** Provide accessible homes/beds/doors, a modest working farm, shared chests, crafting/furnaces, safe routes to real natural resources, and open space.
3. **Pass the single-body gate.** Live-test walking through doors, bounded path recovery, reading previously unknown chests through actual interaction, item pickup/transfer, eating, sleeping, gathering, tool use, cancellation, and accurate failures. Source code or unit tests alone do not establish an in-game PASS.
4. **Run the five-citizen baseline.** Observe at least **three Minecraft days** without repeated human rescue. Log physical tasks, independently sourced messages and replies, actual transfers, memory/persistence, crashes, deaths, and performance.
5. **Only then expand the study.** Try one citizen-requested construction contract and one real-output automated farm in separately logged experiments. A later **wilderness-from-zero** run removes the human-provided village and stockpile; it is a different experiment, not a relabeling of the starter-village run.

A meaningful first PASS requires persistent citizens, usable physical skills, honest event records, and at least one documented social interaction involving a real request, response, cooperation, dispute, or resource transfer. It **does not** require perfect survival, harmony, or an invented institution. Negative and inconclusive outcomes count as research results.

**Current research gates still under development:** own-home/own-bed/own-chest navigation; forward-first door opening; time-aware return home before sunset; bounded ore search and real pickup; and coordinated, independently acting citizens. A reported single-bot farming probe is not proof of a full multi-citizen food economy.

## 🏡 What comes after the physical baseline?

The following are **planned capabilities and research questions**, not features advertised as working today.

| Stage | Research direction |
| --- | --- |
| **Homes and daily life** | Citizens claim homes, beds, personal storage, and freely chosen shared households. They plan journeys so they can return home and attempt sleep on a configurable Minecraft-day schedule. |
| **Resource skills** | Farming, fishing, mining, crafting, and transporting use real tools, items, finite deposits, accessible routes, and authorized storage. |
| **Social autonomy** | Individual memories, conversations, promises, trust, cooperation, disagreements, reputation, and changing learned tendencies. |
| **Construction services** | Citizen-proposed sites, optional contractor quotes, material/payment checks, physically verified buildings, and recorded ownership. |
| **Economy** | Negotiated barter and prices, property and inventory rights, a single authoritative ledger, wages and finite work contracts, community treasuries, and later optional taxation. All transfers must be idempotent and backed by verified world/item changes. |
| **Institutions and culture** | Adult households, migration, settlements with different histories, beliefs, shared customs, community-chosen institutions, and persistent records across historical cohorts. No governance or cultural outcome is preassigned. |

A later experimental economy might begin with **one citizen hiring another** to harvest and replant a real field for an agreed wage, settling payment once only after verifying actual work and delivery. A policy-analysis agent, if added, should be **read-only by default**, not a hidden ruler rewriting citizen accounts or laws.

### Scaling is about depth, not 100 simultaneous LLMs

The **long-term design cap is 100 living persistent citizens**, reached only after measured, stable stages: **5 → 10–25 → 25–50 → at most 100**. This is **not current capacity**.

The proposed scaling strategy separates **persistent identities** from **physically active Minecraft clients**: nearby/relevant citizens use full Minecraft bodies, while distant/routine activity may eventually run at lower detail without resetting identity, memory, possessions, or relationships. Population size should not imply one graphical Minecraft window or one constantly running model per citizen. Any lower-detail simulation must be labeled and reconciled with real world state, rather than passing statistical resource changes off as physically mined items.

## 🛠️ What this repository currently contains

- **TypeScript/pnpm workspace** with orchestrator, agent core, Minecraft adapter, skills, cognition, memory, society, shared types, and a browser-based observer.
- **Paper 1.21.11 + Mineflayer** integration for a shared local Minecraft Java world, with a single-citizen CLI and five-citizen orchestrator.
- **SQLite persistence** for identity, settlement state, memories, relationships, events, and decision-call logs.
- **Deterministic planner and bounded actions** with structured result handling; optional **local Ollama** for occasional high-level decisions, with a heuristic fallback.
- **Local observer dashboard** for citizen status, goals, settlement resources, events, social state, and performance.

See [architecture](docs/ARCHITECTURE.md), [MVP targets](docs/MVP.md), and [developer notes](docs/DEVELOPER.md). These earlier technical documents describe the prototype and its original milestone; **this README describes the updated Option A direction**. Unmerged local experiments or internally reported test checkpoints are **not** represented as merged GitHub capabilities.

### Repository layout

| Path | Purpose |
| --- | --- |
| \`apps/orchestrator\` | Simulation loop, local HTTP/WebSocket dashboard server, Atlas CLI |
| \`apps/dashboard\` | Local observer UI |
| \`packages/agent-core\` | Citizen records, SQLite persistence, planner, executor |
| \`packages/minecraft-adapter\`, \`packages/skills\` | Minecraft body, pathing, bounded actions |
| \`packages/cognition\`, \`packages/memory\`, \`packages/society\` | High-level decision provider, memory, social behavior |
| \`server\` | Local Paper setup and safe example configuration |

## ▶️ Run the public prototype locally (Windows)

**Requirements:** Minecraft **Java Edition 1.21.11**, **Java 21**, **Node.js 22+**, **pnpm**, and a locally downloaded matching **Paper 1.21.11** server jar. The live world, Paper jar, player records, database, and environment secrets are intentionally excluded from Git.

1. Follow the [Paper setup guide](server/README.md). Download the stated build from Paper's official site, save it as \`server/paper.jar\`, copy the example server properties, and personally accept the Minecraft EULA.
2. Keep the provided **offline-auth development server loopback-only**. Never expose it, its dashboard, or its ports to the internet.
3. In the repository root, copy \`.env.example\` to \`.env\` and review local settings.
4. Run \`pnpm install\`. Start Paper via \`server/start.bat\` (or use the documented auto-start option), then run \`pnpm sim:start\`.
5. Join the local world at \`127.0.0.1:25565\`; view the observer dashboard at \`http://127.0.0.1:3000\`.

Optional: Start a compatible local Ollama model and set \`LLM_ENABLED=true\` with an appropriate configured model. Otherwise the included heuristic/deterministic path is available.

| Command | Purpose |
| --- | --- |
| \`pnpm sim:start\` | Start the public five-citizen prototype and observer |
| \`pnpm atlas\` | Single-citizen developer CLI |
| \`pnpm build\` | Compile the workspace |
| \`pnpm typecheck\` | TypeScript checks |
| \`pnpm lint\` | ESLint |
| \`pnpm test\` | Vitest suite |

The example world is **not included**; exact terrain, paths, and survival outcomes will differ. The project is not a public multiplayer service. **A code build or unit-test run is not a verified live Minecraft survival demonstration.**

## 📸 Demonstration and evidence

Real Minecraft screenshots, short gameplay footage, and a reproducible experiment log will be added after local capture. Concept art from the Option A world plan is **illustrative only**, not a screenshot of a working simulated settlement.

For each documented run, distinguish:

- **Human-supplied** world setup and infrastructure;
- **Citizen-chosen** intentions and social decisions;
- **Physically executed and verified** block/item/entity interactions;
- **Optional model output** versus actual world state;
- **Failures, admin rescues, and unverified observations**.

## Security, research boundaries, and attribution

This is a **local research/portfolio prototype**, not a hardened service. Agents should act through bounded Minecraft skills, not arbitrary shell/filesystem access or model-generated code execution. Offline Minecraft authentication is **only** suitable for a private, local development world.

This is an independent project, **not affiliated with Mojang or Microsoft**. It uses and learns from the [Paper](https://papermc.io/), [Mineflayer/PrismarineJS](https://github.com/PrismarineJS/mineflayer), and [Ollama](https://ollama.com/) ecosystems. [Generative Agents](https://github.com/joonspk-research/generative_agents) and [Project Sid](https://arxiv.org/abs/2411.00114) inform the longer-term research direction; their outcomes are not this project's results.
