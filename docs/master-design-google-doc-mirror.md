<!-- Complete text migration of Minecraft AI Civilization Google Docs master plan, October 26, 2026. -->
<!-- The source document included 2 embedded illustrations; these are marked below and remain in the Google Doc. -->
<!-- Historical sections may conflict with newer decisions; root project.md takes precedence on those points. -->

> **Master design archive · October 26, 2026.** This is the full readable text from the existing Google Docs project plan, reformatted as Markdown. It is retained for traceability, including historical experiments and proposals. The newer decisions in [../project.md](../project.md) override conflicting earlier design ideas. Two embedded illustrations are represented as placeholders rather than copied image files.

# Minecraft AI Civilization

## Project Design, Scaling & Emergent Society Plan


## VISION


Build an autonomous Minecraft civilization that feels less like “100 scripted bots” and more like humans restarting civilization from zero.


The agents should begin with a physical world, survival needs, memory, communication, the ability to learn individual behavioral tendencies, and the ability to act. They should not begin with a prescribed personality archetype, religion, government, ideology, economy, law code, social hierarchy, or cultural identity. Those systems and individual differences should be capable of emerging through experience and interaction.


The goal is to create a persistent artificial society that can survive, build, specialize, form adult households and partnerships, create settlements, trade, argue, cooperate, remember history, create institutions, transmit culture, split into factions, migrate, reform old institutions, and develop new beliefs across historical cohorts.


The core question is not “Can an AI play Minecraft?” It is: “What happens when many persistent agents share a world long enough to create a civilization?”


## FINAL-PRODUCT NORTH STAR — FROZEN-BIOME MORAL CIVILIZATION

Decision date: October 26, 2026. This section is the final-product direction, NOT permission to replace the current World-Lab or interrupt Atlas survival stabilization. Develop in stages; run the frozen-world experiment only after isolated single-citizen and five-citizen live survival tests are reliable.

### The experiment

Place a persistent society of independent adult AI citizens in a frozen Minecraft wilderness after baseline testing. Resources, warmth/shelter, food, isolation, conflict, cooperation and harsh survival pressure should create meaningful tradeoffs. The finished test must be reproducible: record world seed, server/mod versions, actual available food and wood, world difficulty, starting supplies, citizen prompts/model versions, and observation rules. Minecraft snow alone does not create a general cold meter; use a specifically tested temperature mechanic only if its behavior and server compatibility are verified.

### Moral dilemmas without pre-scripted moral outcomes

Citizens may independently decide to share resources, help, threaten, reject, exile, steal from, fight or kill another fictional Minecraft citizen. Example dilemma: a citizen is perceived as a freeloader during a food shortage; other citizens can disagree about evidence, disability or inability to contribute, fairness, loyalty, protection, exile or violence. The engine must not preselect an approved moral answer or force a violent outcome. The LLM chooses intentions from its own limited perception, values, history and relationships; the world validates effects. Fictional in-game actions remain within a controlled simulation and permitted tool/model boundaries, not unrestricted host or real-world permissions. Distinguish allegations and citizen beliefs from measured facts.

### Permanent death and replacement economy

FINAL EXPERIMENT: a confirmed Minecraft in-world death permanently marks that citizen DECEASED. The identity, memories and historical relationships persist as records but the same body never respawns or returns. A killed citizen is NEVER automatically replaced. Introducing a new distinct citizen requires an explicit paid recruitment/spawn transaction from an authorized budget, with an immutable ledger record and population-cap check; if no payment/authorization occurs, the population stays reduced. Whether 'money' means only in-simulation currency or an external real-money budget remains an OPEN PRODUCT DECISION; never silently spend real money. DEVELOPMENT/LAB: keep permadeath disabled until survival and navigation bugs no longer cause spurious irreversible deaths; preserve historical lab rules separately from final-experiment rules.

### AI decides WHAT and WHY; scripts perform HOW

Execution contract: perception + memory + social context → LLM high-level intention (reason, target, priority) → validated structured action request → deterministic prerequisite/task planner → allowlisted Minecraft skills/scripts → actual world observations → outcome + consequences + persistent memory. Scripts handle movement, navigation, gathering, crafting, fishing, farming, construction, trading and in-game combat. The LLM cannot run arbitrary shell, filesystem, generated scripts, network calls, or bypass server safety; no fantasy success flags. A target can escape, resist, fight back or survive. Record failed actions as failures and give citizens the option to reconsider.

### Build order and acceptance gates

GATE A — Atlas reliably gets food, handles water hazards, follows housing routes, sleeps, resumes work and shuts down cleanly in isolated World-Lab. GATE B — five persistent citizens survive three Minecraft days and independently coordinate without repeated human rescue. GATE C — social/economic evidence: actual negotiated resource exchanges, disagreements, remembered consequences, and optional citizen-directed structures/human-provided automation. GATE D — isolated permanent-death, paid-replacement and fictional-conflict tests on copies, with no accidental respawns, duplicate charges or auto-replacements. GATE E — frozen-biome final experiment with validated cold mechanics, measured survival and long-running moral/social behavior. No move to the next gate merely because unit tests pass.

### Present implementation status

As of October 26, 2026: Atlas has connected, claimed home H9, gathered wood and crafted a pickaxe in live World-Lab; later runs uncovered drowning, home-navigation/sleep and food-retry failures. The Windows reliability branch is local, with important uncommitted WIP. No complete autonomous Atlas day, five-citizen demonstration, implemented paid-replacement economy, or frozen-world moral experiment has been verified. The next coding priority remains the narrow Atlas live-survival blockers; do not attempt a final-product feature dump.

## CURRENT NEAR-TERM DIRECTION — FIVE-CITIZEN MINECRAFT SETTLEMENT

Minecraft remains the primary world. Begin with five persistent citizens in a documented, physically usable starter settlement, then study their independently chosen social and survival behavior. The separate wilderness-from-zero experiment follows after the starter-settlement experiment passes real-world tests. Do not mistake prebuilt village structures or human-supplied starting supplies for emergent construction.


### EXPERIMENT 1 — STARTING CONDITIONS AND INDEPENDENCE

Five separately persistent adult citizens (Atlas, Maya, Theo, Ava, Kai) begin in one physically usable Minecraft village: accessible homes/beds/doors, a farm, shared storage, a crafting area, a nearby forest, and accessible stone/ore. Supply a modest recorded starting inventory so primitive survival bugs do not consume the entire study; preserve real scarcity. Record the server/world seed, layout, difficulty, mob settings, all provided supplies, and any common initial briefing. The first village is a research scaffold, not something the citizens built.

No citizen starts with an assigned farmer/miner/leader job, preset relationships, a government, a religion, or scripted social outcomes. They can independently use, expand, renovate, or abandon existing structures. Generic Minecraft mechanics may be known equally; location-specific facts must arise from each citizen's own perception, conversation, or an explicit logged initial briefing. Unknown chest contents stay unknown until that citizen physically inspects the container.

### WHAT EACH CITIZEN CONTROLS

Maintain separate identities, limited perceptions, selective memories, needs, commitments, beliefs and social history. A citizen decides WHAT/WHY, including whether to talk, cooperate, give, ask, refuse, gather, build, rest, fight or retreat. The Minecraft body decides HOW using bounded reliable skills, and reports verified results. A shared shortage indicator is an observed fact, not an order from a central AI. Ordinary danger is a mind decision; reserve reflexes for immediately lethal danger. Keep server truth, citizen perception, citizen belief, and model narration separate.


### BODY CANDIDATE GATE — MINIMUM RELIABLE MINECRAFT SKILLS

Freeze new features in isolated MindcraftProbe until the current stuck/door/resource/container incidents have reproducible evidence. Patch code and unit tests are not a real-Minecraft PASS. Run a fair, bounded live comparison with minecraft-for-astra in its separate sandbox (already cloned, not yet live-tested), using the same starting conditions and tasks. Compare door crossing and blocked-door failure; exact bounded collection with picked-up drops; proper tool choice; verified placement; unknown-chest physical inspection and selective take/deposit; cancellation and nonfatal path failure; eating and using an existing shelter. Log time-to-completion, actual inventory/world state, stalls, disconnects, latency and custom patches. Do not assume a README's advertised capability works in our world. If both are unsuitable for this narrow settlement experiment, make a short separate version-compatible Fabric test of AIBot/mc_aiplayer or Frens. Keep the winning body swappable and do not import unverified code into the civilization world.

### FIRST FIVE-CITIZEN CAPABILITY SET

After one body passes the small physical gate, integrate only the skills needed to live socially in the village: move/look, basic gather/craft/eat/sleep, inspect and use storage, recognize and traverse existing shelter, talk and hear nearby citizens, request/offer/give/decline resources, complete small repair or building tasks, cancel actions, verify progress, and handle recoverable failures. An entire wilderness tech tree, perfect combat, advanced cave navigation, and full arbitrary construction are NOT first-milestone prerequisites. Normal human requests should address the citizen mind by name (test alias AI), never an internal body shell.

### CHECKPOINT: DO NOT BUILD A GIANT QA PLATFORM FIRST

Use existing logs, world-state assertions, captured failure snapshots, and a small repeatable scenario pack. A separate general autonomous coding/QA system, vision model, new dashboard rewrite or broad model-provider migration is optional later, not a blocker unless a specific observed failure demands it. Time-box candidate comparisons; do not spend another long cycle indefinitely rewriting Mindcraft instead of testing an alternative body.


### EXPERIMENT 1 — LIVE OBSERVATION AND ACCEPTANCE

Once the physical gate is signed off, run five citizens together for at least three Minecraft days without repeated human rescue. Record seed, initial supplies, prompts/model versions, starting knowledge, interventions, per-citizen observations, messages and recipients, inventory and block changes, task/action results, restarts, agent deaths, model latency, and server performance. A first-milestone PASS requires persistent identities, verified survival/physical tasks, usable records, and at least one documented multi-citizen interaction involving a real request, response, cooperation, dispute, or resource transfer. It does not require a predetermined role distribution, harmony, invented institution, or success at every task. Record negative and inconclusive runs equally.

### CONTROLLED FOOD-SHORTAGE STUDY

Once the baseline is stable, create a measured food shortage and watch each citizen's independent response. Record who notices, who searches or farms, who asks, offers, shares or declines food, and what actual items change hands. Compare repeat runs with citizen-to-citizen communication enabled versus disabled under otherwise comparable starting conditions. Distinguish assistance caused by scripted initial conditions from self-chosen interactions; never manufacture a conversation or a successful transfer for the video.

### FOLLOW-ON — WILDERNESS CIVILIZATION RESET

Only after the starter-village experiment works, run an explicitly separate five-citizen test with no premade settlement and no material stockpile. Study whether they can establish shelter, production, sharing, and a lasting settlement from scratch. Later extend by demonstrated reliability to 10–25, 25–50, and at most 100 persistent living citizens, with additional settlements, historical cohorts, institutions and culture. The starter village is not the answer to the wilderness experiment: it isolates the social hypothesis first.

### DEVELOPMENT RULES AND PUBLIC EVIDENCE

Keep SIM_PERMADEATH_ENABLED=false during development: physical body death respawns the same citizen with identity and memory, never a brand-new person; disconnect/restart is not death. Optionally disable natural hostile spawning for the initial social study without using Peaceful (which changes hunger); document settings and run hostile/combat scenarios separately. For a LinkedIn post, show reproducible conditions, real Minecraft footage, verified events and limits; describe observable human-like social behaviors, not proof of human status, consciousness, depression, or sentience. Credit Project Sid/PIANO, Generative Agents, and body libraries appropriately, and distinguish published findings from this project's unverified results.


## WORLD SETUP DECISION — CALM, MOSTLY VANILLA MINECRAFT (CURRENT)


Use a simple vanilla-style Java Minecraft world on the already isolated compatible Paper server for the first five-citizen settlement. Do NOT install a large gameplay modpack for Experiment 1: new ores, machines, recipes, mobs, currencies, inventories or claims would change the economic rules, add body/tool compatibility problems, obscure the source of behavior, and make runs difficult to compare. Minecraft's existing hunger, crops, mining, crafting, shelter, biomes, ore scarcity and day/night are already sufficient for a real economy and social study.


Choose and save one reproducible seed and version with an attractive, easy-to-navigate plains or gently rolling valley beside a forest, river and accessible mining hills; avoid an enormous mountain, deep ravine, water barrier or elaborate multi-level maze between starting buildings. Establish a small physically usable starter village with simple houses, accessible doors/beds, a common area, farm, shared chest/storage, crafting stations, and an unexhausted naturally generated mine area. Record exactly what the experimenter prebuilt or supplied; do not credit these to citizen initiative. Leave nearby wilderness and ore finite so future growth requires real work.


Recommended environment settings: survival mechanics with hunger and day/night active, controlled difficulty (e.g. Easy), and optionally turn OFF natural hostile mob spawning during the first social-isolation run without selecting Peaceful. Keep controlled hostile/combat tests and later hostile-enabled comparison runs separate. Decide and record keepInventory/death-drop behavior, weather, time, gamerules, spawn settings and any safety protections before each run. Never secretly change world rules mid-experiment. Preserve same-citizen respawn in development as specified by SIM_PERMADEATH_ENABLED=false.


Optional aesthetics: client-side resource packs or shaders, or a small tested decoration-only addition that does not change block/item IDs or survival/economy logic. These should be opt-in for the human spectator and must not be assumed visible to the AI camera or alter the server's real mechanics. Do not rely on a plugin/modpack until body and Paper/version compatibility have been verified in a COPY of the test world.


World design for later phases: place the second and third communities in comparable but separated regions of the SAME world with logged distances, starting resources and directives. The economics experiment should use vanilla item/recipe values first, with a single authoritative custom ledger; Towny, WorldGuard, WorldEdit, Vault, QuickTax, Jobs Reborn and shop plugins are integration candidates, not a bulk modpack to turn on together. If used, enable only needed compatible pieces after isolated testing and prevent duplicate money creation or auto-assigned governance.


Decision checkpoint: run the first five-citizen physical/social milestone on the calm vanilla-style world. Consider a content modpack only after a specific measured research question requires mechanics absent from vanilla Minecraft, and then treat that modpack as a NEW experimental condition with its own documented baseline, version and body tests.


## ECONOMIC CIVILIZATION — TEN IDEAS, REUSE MAP & FEASIBILITY (PLANNED, NOT IMPLEMENTED)

Scope: the resources below are documented candidates/references, not a set of already integrated or version-tested plugins. Keep the five-citizen physical/social milestone first. No plugin pack automatically delivers independent AI decisions, real labor contracts, community-designed tax rules, and an honest Minecraft-backed ledger. Check actual license, exact Minecraft/Paper or Fabric version, permissions, data schemas, and API compatibility before adopting code. Preserve upstream notices. Avoid enabling overlapping economy/payroll plugins that mint money independently.

1. ONE-LINE STARTING PERSONALITY — LOW: Start each citizen with one concise disposition, no immutable personality/job archetype. Separate histories, relationships, beliefs and memory remain able to change future choices. Reference: Stanford Generative Agents (https://github.com/joonspk-research/generative_agents), an architecture reference, not a drop-in Minecraft mind. Test that experience and independent observation can change a citizen's choices.

2. MULTIPLE COMMUNITIES / DIRECTIVES — MEDIUM-HIGH: Community A can begin with food/shelter as a broad objective, B with production/trade, C with exploration; citizens may disagree, renegotiate or migrate. Use separate towns, membership, geography and local knowledge. Towny (https://github.com/TownyAdvanced/Towny) demonstrates towns/banks/plots; WorldGuard (https://github.com/EngineHub/WorldGuard) offers bounded regions/permissions. Avoid auto-assigning mayors and imported governance rules; compare matched terrain/start conditions and record directives. Scale from one working village to two/three settlements in the SAME world.

3. MINING AND FARMING ZONES — MEDIUM after body works: Designate an actual discovered mine area, site boundaries, access rights, tool needs, storage, finite ores and extraction logs; a declaration does not spawn gold. Reuse mineflayer-collectblock (https://github.com/PrismarineJS/mineflayer-collectblock) for navigation/dig/drop pickup and WorldGuard for optional protected regions. Verify harvested item count and physical deposit, never count an uncollected drop as production.

4. ITEM VALUES / EQUIPMENT INPUTS — MEDIUM: minecraft-data (https://github.com/PrismarineJS/minecraft-data) supplies versioned Minecraft items and recipes for material/use-cost estimates. Maintain separate reference value, utility/need and negotiated trade price; diamonds/bread/wood do not have to have permanent fixed prices. Craftable equipment consumes actual materials and labor. Benchmark actual trades as supply, need, and scarcity vary.

5. TAXABLE TRADE AND ITEMS — MEDIUM after ledger: Start with one clearly defined tax event (e.g. verified sale). QuickTax (https://github.com/tjtanjin/QuickTax) is a scheduled tax reference, VaultAPI (https://github.com/MilkBowl/VaultAPI) an economy integration interface, better-sqlite3 (https://github.com/WiseLibs/better-sqlite3) an authoritative local transactional ledger candidate. QuickTax is NOT our full item-sale/ore-extraction policy engine. Never double-tax an item transfer because multiple plugins each think they own the event. Failed sales collect zero tax.


6. COMMUNITY-DECIDED TAXATION — HIGH social effort: Towny (https://github.com/TownyAdvanced/Towny) demonstrates banks, residents, plots, and configured taxes, NOT independent AI deliberation. Our system records citizen/community proposals, taxable event, rate, exemptions, jurisdiction, adoption procedure, effective time, objections, and amendments. A community may choose its own governance mechanism; no global manager secretly chooses its tax rate. Unapproved proposals must never collect tax.


7. ECONOMIC ANALYST AI / INFLATION — MEDIUM for read-only observation, HIGH if delegated policy powers: Store actual price, quantity, wage, production, and currency-issuance history in a ledger; compute changes in a comparable basket of goods deterministically, keeping food shortage distinct from money inflation. Treasury (https://github.com/ArcanePlugins/Treasury) is an interoperability economy API, NOT a ready-made AI economist. A separate analyst reads permitted verified statistics, qualifies thin samples, publishes findings or proposals, and has no secret authority to rewrite accounts or control community decisions.


8. CITIZENS PURCHASE HUMAN-CONSTRUCTED HOUSES/FARMS — MEDIUM for predefined verified contracts: WorldEdit (https://github.com/EngineHub/WorldEdit) loads and pastes schematics; prismarine-schematic (https://github.com/PrismarineJS/prismarine-schematic) reads structure data; WorldGuard (https://github.com/EngineHub/WorldGuard) can protect assigned property. A citizen may negotiate with the human contractor, choose a plot, agree on price/materials, and pay from escrow only after the real completed building passes an agreed world-state check. Distinguish a building pasted by the human from an AI physically built structure and record imported resources.


9. TAX-FUNDED ASSISTANCE / INFRASTRUCTURE — MEDIUM after ledger: Towny provides town-bank patterns; VaultAPI (https://github.com/MilkBowl/VaultAPI) can bridge compatible economy providers; better-sqlite3 provides the authoritative custom ledger. A community-created decision can fund real food aid, road work, a public farm, a warehouse, or a human/AI construction contract. Approval, money movement, recipient, delivery and contract completion must be independently verified. No hidden automatic redistribution or zero-cost public buildings.


10. CITIZEN BUSINESSES AND HIRED WORK — MEDIUM for one-off contracts, HIGH for a complete labor market: Jobs Reborn (https://github.com/Scot-Survivor/JobsReborn) demonstrates game-action-based job rewards; QuickShop-Hikari (https://github.com/QuickShop-Community/QuickShop-Hikari) demonstrates player shops, but neither is a complete autonomous AI employer/employee contract system. Implement offer, negotiation, acceptance/refusal, employer-funded escrow, a measurable task (harvest/replant a defined farm, deposit crop output), postcondition checks, bounded cancellation, and pay exactly once. A recurring employer/employee relationship is a later expansion.


SHARED IMPLEMENTATION — SINGLE AUTHORITATIVE LEDGER: citizen/business/community/human-contractor accounts; recorded physical item ownership and storage permissions; credits and explicit issuance/burn rules; immutable transaction IDs; escrow; property/plot records; agreements; active tax rules; and verified world events. A Minecraft item transfer and a database commit are not naturally atomic: use reservations, idempotency, reconcile-after-crash, and audit trails. Do not run Jobs Reborn/other money-minting plugin beside our ledger without a deliberate one-provider design. The LLM may propose an action but cannot manufacture payment, item pickup, ore, or construction success.


IMPLEMENTATION GATES: A. Five citizens reliably alive and social in the starter village. B. One verified barter/credits transaction. C. One farm or mine production record plus ABC→DEF one-off wage contract. D. Community treasury and one adopted tax event. E. One citizen-funded human or AI infrastructure contract. F. Second/third community and comparative economy. G. Separate read-only economic analyst, then optional expressly delegated policy mechanisms. Do not treat a plugin's documented feature as tested in our server; reproduce with live world and inventory assertions.


## WORLD DESIGN UPDATE — CITIZENS COMMISSION BUILDINGS; HUMAN OPERATES BUILD TOOL

Clarification: the user wants a spacious attractive survival-capable prebuilt terrain/world to expand in, NOT a gameplay modpack adding new ores, machines, items, recipes or NPCs. Existing vanilla village farms are too small for the proposed economies. Keep Paper / current Minecraft version, original resources and hunger. Start with a small neutral shared hub and accessible existing shelter/food so five citizens can live, but deliberately leave open plots. Alternatively use a survival-friendly downloadable custom world as a terrain canvas after testing its actual ores/caves, flat settlement sites, resource supply and rights for public footage. The AI communities must choose what they want to commission and where, rather than the experimenter prebuilding all of their desired structures. Every initial building is labeled experimenter-provided.

### HUMAN ADMIN BUILD CATALOG / INSTANT STRUCTURES

On a COPY of the Paper server/world, test BuildPaste's actual Paper/Spigot multiplayer plugin, which the developer's own wiki says runs entirely server-side and supports /buildplacer, /bindbuild, /paste, /construct, /undopaste: https://buildpaste.net/wiki and https://modrinth.com/plugin/buildpaste . The main Modrinth project overview ambiguously says 'Singleplayer only' for its mixed mod/plugin listing; the vendor separately specifies that the Fabric/Forge/NeoForge MOD builds are singleplayer and the Paper PLUGIN is multiplayer. Do not assume our 1.21.4 setup works until testing that exact plugin JAR in isolation. WorldEdit remains a more established Paper-compatible fallback, with schematics and //schem load <name> then //paste -a: https://modrinth.com/plugin/worldedit and https://worldedit.enginehub.org/en/latest/commands/ . Instant paste is a human admin action; the AI never receives arbitrary OP/WorldEdit/RCON commands.

### SAMPLE EXPANSION CONTRACT

A community detects food shortages, discusses options, chooses a site and size (e.g., one medium farm rather than an invented exact optimal farm requirement), then independently asks the human contractor for quotes. The human offers a curated vanilla-block template with known dimensions, materials and cost, reserves/collects the agreed funds or items in one authoritative ledger, pastes only after acceptance, and verifies the structure exists and is accessible. Record who supplied materials, templates, human interventions, plot ownership, world change, and payment. Later citizens can instead choose to physically build by themselves through a separate verified construction skill. Communities can disagree, reject the quote, hire an AI builder, or save for another project.

### AUTOMATION AS PURCHASED INFRASTRUCTURE — NOT FREE ITEMS

Human-built vanilla redstone/hopper or villager-assisted farms are allowed as a separate type of commissioned infrastructure, provided their input, output, throughput, maintenance, owners and access rights are measured from REAL Minecraft inventory/block changes. Examples: crop plots and sugar-cane/bamboo/melon collection farms; a vanilla iron farm only after economic balance is tested. An always-on farm has operating opportunity costs and may greatly shift prices, employment and resource scarcity. The economy must not award imaginary production every tick or silently credit a village for crops that no citizen or physical collector picked up. Distinguish human-built automatic output from citizens' manual farm labor; villagers or other non-citizen producers count as external automation, not citizen workers. Consider separate manual-vs-automated treatment/control runs. Avoid gameplay automation plugins that spawn items, instant-grow crops or create currency unless that is an explicitly documented new experimental condition.

### WORLD / BUILD RESOURCES TO EVALUATE

Roomy survival-friendly map candidate with listed Minecraft 1.21.4+ support, flat/natural landscapes and caves: Kyldros (6k x 6k) https://www.planetminecraft.com/project/kyldros-6k-1-21-4-survival-friendly-custom-caves-amp-features-a-huge-adventure-map . It is a large custom world and reports custom diamond/iron clusters; benchmark ore distribution and do not assume default vanilla scarcity or fair community resources. A simpler natural-seed plains/river world is the reproducibility fallback. Prefab source: BuildPaste catalog https://buildpaste.net/ ; WorldEdit schematic library from appropriately licensed creators (check attribution and reuse rights). For exact click-to-place tool, test BuildPaste plugin first; Insta Schem also advertises item-bound right-click schematic placement with FAWE but is an additional dependency: https://modrinth.com/plugin/instaschem .

### IMPLEMENTATION GATE

Do not install a giant modpack, switch world versions, or modify minecraft_ai_sim until a COPY of the body-test world proves: five-citizen pathing in a representative town, one human-requested and paid one-click building, non-destructive paste/undo, reachable door/bed/chests, no accidental buried/overwritten resources, and actual automated farm output into a physical container. Choose the smallest working plugin set. BuildPaste and WorldEdit are alternatives for an admin build workflow, not a requirement to activate both.


## DESIGN PRINCIPLE: CIVILIZATION RESET


The simulation should feel like humanity starting civilization again.


We provide the physics and basic biological/social constraints. The agents provide the civilization.


Agents should be free to:

- form friendships, rivalries, households, alliances, and factions

- choose or change occupations

- create their own customs and social norms

- invent systems of exchange and property

- propose rules and laws

- create leadership structures or reject leadership

- create councils, monarchies, democracies, clans, guilds, or systems we did not anticipate

- invent stories, myths, symbols, rituals, holidays, taboos, and traditions

- create religions or non-religious philosophies

- convert, reject, reinterpret, reform, or split from existing belief systems

- build temples, monuments, meeting places, memorials, or other culturally important structures

- teach beliefs and traditions to other citizens and later settlement cohorts

- preserve, distort, or forget historical events

- create competing interpretations of the same event

- migrate and establish culturally different settlements

- cooperate, compete, trade, negotiate, or fight over resources and ideas


No specific religion, ideology, constitution, economy, or political system should be hard-coded as the “correct” outcome.


## FREEDOM OF THOUGHT, OPERATIONAL CONTAINMENT


The agents should have open-ended cognitive freedom inside the simulation. Their internal reasoning can generate novel goals, explanations, beliefs, social structures, and cultural practices.


That does not mean giving them unrestricted access to the host computer.


The design principle is:


Cognitive freedom inside the world.

Strictly bounded capabilities outside the world.


The LLM layer should not receive arbitrary shell access, unrestricted filesystem access, arbitrary Python/JavaScript execution, or unrestricted internet access. Agents should act through a fixed Minecraft skill API such as move, observe, speak, mine, craft, build, farm, trade, fight, sleep, store items, inspect structures, and interact with other agents.


This separation is important because it allows emergent behavior without making the simulation dependent on unsafe or unnecessary host-level permissions.


## WHAT “EMERGENT RELIGION” SHOULD MEAN


Religion should not be a dropdown field assigned by us.


An agent or group might interpret an unusual event as meaningful, tell a story about it, attach a symbol to it, repeat that story, create a ritual, persuade others, build a monument, and eventually create an institution around the belief.


A belief system could contain:

- origin stories or cosmology

- sacred objects, blocks, locations, animals, times, or events

- rituals and ceremonies

- moral rules or taboos

- symbols and architecture

- festivals and remembrance days

- teachers, priests, elders, prophets, skeptics, or reformers

- different denominations or schools of thought

- schisms and doctrinal disagreements

- conversion and loss of belief

- household and cohort transmission

- cultural blending when settlements interact


These should emerge from agent memory, social influence, major events, uncertainty, storytelling, prestige, household and cohort transmission, and repeated interaction. The simulation should not force agents to become religious, and it should allow secular philosophies and skeptical agents to emerge as well.


## FOUNDATIONAL RESEARCH IDEAS


Project Sid demonstrates that large populations of language-model agents can exhibit specialization, social conventions, institutional behavior, and cultural transmission at scales reported up to 1,000+ agents. Its PIANO architecture is especially relevant because it separates concurrent processes that operate at different timescales.


Generative Agents provides a useful cognitive pattern: observation, persistent memory, retrieval, reflection, and planning. Rather than placing the entire history of an agent into every model call, relevant memories are retrieved when needed.


Mindcraft and Mineflayer provide the practical Minecraft execution layer: movement, observation, inventory, crafting, digging, building, combat, multi-agent interaction, and integration with local or remote language models.


The project should combine these ideas rather than simply running 100 independent chatbots.


## SYSTEM ARCHITECTURE


Minecraft / Paper Server

→ Physical agent layer (Mineflayer)

→ Deterministic skill engine

→ Civilization simulation layer

→ Agent cognition and memory layer

→ LLM router

→ Local model for routine high-level deliberation

→ Stronger model only for difficult or important decisions

→ Persistent database for identity, history, relationships, households, institutions, resources, and culture


The most important architectural rule is that population count must not equal expensive LLM process count.


The current civilization is capped at 100 living persistent citizens. Deceased citizens may remain indefinitely in historical records without counting toward the living population cap, and not every living citizen needs a full language-model reasoning loop every second.


## THREE LEVELS OF AGENT INTELLIGENCE


Level 1 — Reflexes


No language model is required for immediate, predictable emergency reactions: eat when starvation is imminent and food is available, flee when critically injured, escape fire/drowning, or react to an immediate nearby lethal threat. Non-emergency needs such as returning home at night, replacing a tool, depositing inventory, or improving shelter can be high-priority planner inputs, but should not automatically erase a valid deliberative choice.


Level 2 — Skills and Tasks


Routine work should use deterministic skills: harvest a field, replant crops, mine an assigned resource, carry supplies, follow a road, craft tools, build from a plan, patrol a boundary, or transport goods.


Level 3 — Deliberative Reasoning


The LLM should be called when the agent needs to make a meaningful choice: choose a new goal, change occupation, respond to social conflict, decide whether to trust someone, propose a new law, interpret a major event, join or leave an institution, decide whether to migrate, create a new cultural practice, or rethink a belief.


This dramatically lowers compute while keeping the moments that matter intelligent.


## PERSISTENT AGENT MODEL


Every citizen should have a persistent identity rather than being a stateless bot.


Suggested state includes:

- name and unique agent ID

- adult age/stage and historical cohort

- learned behavioral tendencies and observer-facing personality summaries

- skills and occupation

- home and settlement

- inventory and property

- health, hunger, energy, and risk state

- short-term goals and long-term goals

- adult household, partnership, and close-bond relationships

- friendships, rivals, acquaintances, and trusted leaders

- relationship dimensions such as trust, affection, respect, resentment, familiarity, and dependence

- important memories

- beliefs and cultural affiliations

- institution memberships

- perspective-specific beliefs about other citizens

- knowledge of places, resources, people, and events


## PERSONALITY, EMOTION, MOOD, AND LEARNED BEHAVIOR

Citizens should not behave like identical utility-maximizing bots. Psychological state must be persistent enough to matter, but flexible enough to change through experience.


### EMERGENT PERSONALITY AND LEARNED TENDENCIES

Citizens should not receive strongly predefined personalities from the developer. Recognizable traits such as caution, curiosity, sociability, persistence, ambition, assertiveness, empathy, or preference for familiarity should emerge mainly from repeated choices, memories, relationships, learned expectations, habits, successes, failures, and interpretations of lived events. The system may later summarize these behavioral patterns for observation, but summaries should not become rigid causal scripts.


### DYNAMIC EMOTION AND MOOD

Short-lived emotions and longer-lived mood are separate. Useful affective dimensions include emotional valence, stress, fear, sadness, anger, joy, gratitude, loneliness, pride, and confidence. Immediate events can create strong short-term reactions, while major losses, repeated failures, successful cooperation, safety, achievement, and social support can shift mood more gradually.


The system should not label ordinary simulated behavior as a clinical psychiatric disorder. Use concepts such as low mood, sadness, fear, stress, withdrawal, confidence, and recovery.


### EVENT APPRAISAL AND DECISION WEIGHTS

Important events should be appraised relative to the individual citizen: desirability, goal impact, loss magnitude, threat, controllability, novelty, responsibility, social impact, and relationship relevance. The same event can affect different citizens differently because memory, current needs, relationships, confidence, prior choices, learned expectations, beliefs, and prior experience differ.


Keep objective facts separate from subjective interpretation. The engine may know that Theo took food from Atlas, how much food was lost, whether Atlas was starving, who witnessed it, and whether the transfer was authorized. It should not automatically encode a universal rule such as “theft = trust -0.10.” Atlas decides what the event means using remembered context, prior treatment, needs, beliefs, social expectations, and later reflection. Universal physical consequences such as damage, starvation, or immediate danger may produce bounded baseline survival reactions, but social meaning, trust, resentment, forgiveness, loyalty, values, and recognizable personality should emerge from citizen-specific appraisal and history.


Emotion must modify goal scoring rather than script exact actions. Never implement rules such as “if sad, farm potatoes.” Goal selection should instead combine survival urgency, settlement need, expected utility, perceived risk, learned behavioral tendencies, mood, confidence, familiarity, prior success/failure, social obligations, preferences, curiosity, habits, and controlled stochastic variation. This allows behavior such as a stressed citizen temporarily favoring familiar low-risk work without hard-coding the activity.


### EMOTIONAL MEMORY, ASSOCIATIONS, AND HABITS

Important episodic memories should carry emotional salience and learned associations. A Creeper destroying valuable storage might strengthen associations such as creeper -> threat, exposed storage -> unsafe, or a particular location -> danger. Environmental cues can later reactivate relevant memories and temporarily alter behavior.


These associations must remain learnable rather than permanent. Repeated safe experiences can weaken obsolete fear. Successful activities can increase familiarity, confidence, pride, and preference; repeated failures can create caution or avoidance depending on learned history, current state, and the citizen's own interpretation. Occupations and hobbies can therefore partly emerge from experience.


### SOCIAL EMOTIONS

Relationships and affect should interact. Rescue, resource sharing, praise, abandonment, betrayal, conflict, death, or departure can change trust, affection, resentment, gratitude, loneliness, stress, or mood in proportion to relationship strength. A stranger dying should not automatically affect everyone as strongly as the loss of a close partner or friend. Social support can contribute to recovery.


### LLM INTEGRATION AND OBSERVABILITY

The simulation stores objective events, learned psychological state, mood, affect, memories, relationship beliefs, habits, confidence, and behavioral evidence. It should not assign a strong developer-authored personality and then force behavior from it. The LLM receives concise structured context—learned behavioral summary, current mood, active emotions, relevant memories, relationships, current needs, recent important events, and uncertainty—then makes bounded high-level decisions executed through verified skills.


The observer dashboard should expose learned behavioral tendencies, observer-facing personality summaries, mood, stress, fear, sadness, anger, positive valence, confidence, activated emotional memories, recent emotional events, and how affect changed goal scoring. These summaries are descriptive, not hidden causal personality scores. The system should be able to answer “Why is Atlas farming instead of exploring?” with inspectable factors rather than guesswork.


### CREEPER-LOSS BEHAVIOR TEST

A future integration test should create a meaningful negative event such as a Creeper destroying important storage and verify that the loss becomes an episodic memory, affective state changes, relevant threat associations may strengthen, future decision weights change, state persists across restart, and later experience can produce recovery. The test should not require one exact scripted reaction.


## MEMORY SYSTEM


Memory should be layered.


Immediate memory contains recent observations and conversations.


Episodic memory stores notable experiences such as an attack, rescue, betrayal, marriage, famine, discovery, construction project, political conflict, religious event, or death.


Semantic memory stores learned facts and beliefs about the world.


Social memory tracks what the agent believes about other people.


Cultural memory stores stories, customs, symbols, laws, rituals, and shared historical narratives.


Old memories should be summarized and compressed. Agents should sometimes misremember, disagree, or forget instead of sharing a perfect global database of truth.


## ADULT HOUSEHOLDS, MIGRATION, AND HISTORICAL COHORTS


The civilization should support adult households and long-term history across multiple settlement cohorts.


All physically simulated citizens are adults. Citizens may form friendships, romantic partnerships, households, mentorships, rivalries, factions, organizations, and chosen-family-like bonds, but reproduction, parenting, childhood development, and juvenile Minecraft agents are outside the planned simulation. Population growth should come from adult newcomers, immigration, settlement migration, and departures. The observed Minecraft region is treated as one inhabited frontier rather than the only humans in existence: new adult migrants may enter from an abstract outside population that is not individually simulated. Newcomers arrive as distinct persistent adults, not replacements or descendants, and learn local language, stories, social ties, skills, values, customs, institutions, and beliefs through interaction. Settlement safety, food, housing, work, social ties, reputation, and political/economic conditions may affect migration pressure, but reaching the 100-living-citizen cap blocks further arrivals.

## POPULATION CAP, PERMANENT DEATH, AND ESTATES


The simulation has a hard cap of 100 living citizens. The cap should be configurable in code, but 100 is the project ceiling rather than a target that the system tries to fill. Immigration may occur below the cap, but a death or departure only creates available capacity; it must never automatically spawn a replacement citizen.


Death is permanent. A confirmed in-world Minecraft death sets that persistent citizen to DECEASED, permanently retires the Mineflayer body for that identity, and prevents respawn or later re-physicalization. Ordinary disconnects, server restarts, crashes, pathfinding failures, and network errors are not death. If an entire settlement dies out, it becomes extinct or abandoned; later adult migrants may discover or resettle the ruins, but the dead citizens do not return.


A deceased citizen remains part of history. Their memories in other citizens, relationships, buildings, promises, reputation narratives, work, discoveries, institutions, and historical records can continue to affect the civilization after death. Death should be a major social event whose meaning is interpreted by surviving citizens rather than a simple reset mechanic.


### PROPERTY AFTER DEATH — MECHANICS ARE FIXED, SOCIAL OUTCOME EMERGES


The simulation engine should decide objective world facts, not inheritance policy. Carried inventory follows real Minecraft death mechanics: items drop at the death location and may be recovered, stolen, lost, or despawn if nobody reaches them. Persistent property such as homes, chests, workshops, stored resources, tools, records, and ownership claims remain in the world/database after the owner dies.


The engine records facts such as who previously owned an item or structure, what promises or written instructions existed, who recovered dropped items, and who currently possesses or controls property. It should not automatically transfer everything to a predefined heir, partner, government, or communal chest.


Surviving agents and institutions decide what should happen. A partner may claim a home, an apprentice may claim a workshop, friends may preserve belongings as memorial objects, someone may simply take valuable items, a settlement may declare property communal, or citizens may create wills, inheritance customs, courts, estate rules, confiscation rules, or entirely different arrangements. Disputes over a dead citizen's property should be allowed to become genuine social and political events.


If no accepted rule exists, the property remains unclaimed, contested, possessed by whoever physically controls it, or informally redistributed through agent decisions. The developer supplies physical constraints and factual records; the civilization supplies the social meaning and rules.


## LOCAL REPUTATION AND PERSPECTIVE

There is no magical global reputation score. Reputation is local and perspective-dependent. Each citizen stores their own beliefs about other citizens based on direct experience, witnessed events, conversation, rumor, records, and social influence. Different citizens may hold completely different views of the same person, and information can be incomplete, distorted, forgotten, or disputed.


The dashboard may summarize observed behavioral patterns or aggregate how citizens are perceived for the human observer, but those summaries must not become hidden global truth available to agents or causal personality variables that dictate decisions.


Over long runs, original founders may age from adulthood onward, die or depart, and eventually become historical figures known only through surviving records and cultural memory.


The calendar can still be accelerated for historical eras, adult aging, settlement tenure, and institutional change without ever simulating physical childhood.


## ECONOMY AND SPECIALIZATION


The simulation should permit specialization to emerge from needs and opportunity.


Possible occupations include farming, mining, construction, crafting, exploration, defense, logistics, trade, record-keeping, teaching, governance, religious/cultural leadership, engineering, and roles we did not predefine.


A settlement-level planner can identify shortages without dictating every individual decision. Agents may cooperate with the planner, ignore it, negotiate, switch jobs, form guilds, hoard resources, trade privately, or create new arrangements.


## GOVERNMENT, LAW, AND INSTITUTIONS


Do not begin with a government.


Allow governance to emerge from repeated coordination problems.


Agents might create a council because food allocation is chaotic, appoint a leader during a crisis, create property rules after theft, establish courts after disputes, invent taxes to fund common infrastructure, create guards after attacks, or reject centralized authority entirely.


Institutional state should be persistent and inspectable, including laws, membership, authority, treasury/resources, offices, procedures, and history.


### ELECTIONS, TAXES, PROTESTS, AND POLITICAL CHANGE

## If agents create an electoral system, elections should emerge from their institutions rather than being forced as the universal form of government. A society might instead create a council, monarchy, clan structure, military leadership, rotating office, religious authority, or something we did not anticipate. The simulation should support elections as one available political mechanism without assuming every settlement will choose them.


## When elections exist, candidates should emerge from the population. Likelihood of running can depend on how others perceive the candidate, demonstrated willingness to lead, social connections, leadership history, occupation, household/community ties, wealth, ideology, religion, achievements, scandals, and whether other agents encourage the person to run. A race may narrow to two highly supported candidates, but the system should also allow more candidates, uncontested elections, coalitions, withdrawals, and new political movements.


## Citizens should vote from their own limited perspective rather than a global popularity score. A voter may care about taxes, food security, employment, religion, household and close social ties, public safety, trade, a candidate’s past actions, campaign promises, rumors, or personal relationships. Two agents can observe the same candidates and rationally choose differently because their needs, memories, and beliefs differ.


## Taxes should be connected to the real Minecraft economy. Governments can propose crop taxes, mining taxes, property or household contributions, trade tariffs, emergency levies, or other systems created by the agents. Collected resources enter an actual public treasury that can fund roads, walls, guards, food reserves, construction, aid, exploration, temples, public buildings, or other collective projects. Citizens can judge whether taxation is fair and whether leaders use the treasury as promised.


## Campaign promises should be persistent historical objects. If a candidate promises to lower a crop tax, build housing, expand roads, or improve defenses, the system should remember the promise and allow citizens to later judge whether it was fulfilled, partially fulfilled, abandoned, or made impossible by changing conditions.


## Protests and riots should emerge socially rather than from a hard-coded threshold such as “approval below 30% = riot.” Grievances can spread through households, workplaces, neighborhoods, religious groups, political factions, and influential agents. Individual citizens can independently decide whether to stay home, complain, petition, protest peacefully, strike, refuse taxes, leave the settlement, support the government, or participate in destructive unrest. Government responses such as negotiation, concessions, elections, arrests, force, resignation, or ignoring the protest can change legitimacy and future political behavior.


## Political legitimacy should therefore be an emergent result of many individual beliefs. The admin dashboard may calculate aggregate measures such as approval, perceived fairness, security, economic conditions, or corruption suspicion for observation, but agents should not have access to a magical global approval number. Each citizen only knows what they have personally experienced or learned through their social network.


## Across historical cohorts, governments should be able to reform, decay, split, centralize, decentralize, collapse, or be replaced. Political history should matter: old laws, past elections, revolts, broken promises, respected leaders, unpopular households or factions, and remembered crises can influence later cohorts without predetermining them.


## CULTURE AND INFORMATION SPREAD


Information should spread through networks rather than instantly.


An agent should usually know household members or partners, close friends, coworkers, neighbors, leaders, and a limited set of acquaintances. Most citizens in a 100-person civilization should not automatically know every other person.


News can travel through conversation, travelers, public meetings, messengers, records, signs, institutions, and household and community teaching.


This limits compute and creates realistic phenomena such as rumors, local cultures, regional identities, misinformation, forgotten history, and different interpretations of the same event.


## ACTION VERIFICATION


The model should never be trusted merely because it says an action succeeded.


Every meaningful action should use an expected-result loop:


Goal → plan → execute → observe → compare expected result with actual world state → recover if necessary.


If an agent believes it built a wall but four blocks failed to place, the system should detect the mismatch and repair the task rather than storing a false memory that the wall is complete.


## BUILDING SYSTEM


The LLM should not place every block.


A high-level decision such as “the village needs four more homes” should produce a construction goal.


A planner selects or generates a blueprint, calculates materials, assigns procurement tasks, reserves resources, and lets physical agents gather and place the blocks.


Later versions can support agents inventing new architectural styles and modifying blueprints according to cultural preferences, available resources, household/community ties, religion, climate, or local history.


## SCALING: ACTIVE VS. PERSISTENT CITIZENS


Use simulation level-of-detail.


### FULL / PHYSICAL MODE

The agent is connected to Minecraft, perceives the local world, pathfinds, mines, crafts, fights, builds, speaks, and can request LLM reasoning.


### LOW-DETAIL MODE

The citizen remains alive in the civilization database but routine work is simulated statistically. A far-away miner can complete a shift without physically pathfinding through every tunnel.


When the player travels to that settlement or the agent becomes important to an active event, a living citizen can be physicalized again. Deceased citizens are never eligible for re-physicalization.


This is the main strategy for scaling from a small fully physical group to the capped 100-citizen civilization without requiring every citizen to be a full bot client at all times.


### BOT CLIENTS AND SELECTIVE PHYSICALIZATION

A bot client is not a separate Minecraft installation or full graphical game instance. It is a programmatic player connection to the same Minecraft server, controlled by code rather than a human keyboard and mouse. When physically active, that citizen still exists in the real shared world: it can move, mine, build, fight, talk, use inventories, and interact with other players.


The civilization therefore runs in one shared server/world. A population of up to 100 persistent living citizens does not require 100 graphical Minecraft windows or 100 independent LLMs. A smaller subset can be connected as full bot clients at any moment, while the rest remain persistent citizens simulated at lower detail.


This is effectively level-of-detail for people. For example, a 100-person civilization might have 30–50 physically active bot clients while distant or routine citizens continue through the civilization simulator. When the human visits their settlement, they become relevant to a major event, or the scheduler needs them at high detail, they can be physicalized and reconnected as active bot clients.


The goal is that switching between low-detail and physical mode does not reset identity. The same citizen must retain memories, household/partnership ties, relationships, possessions, beliefs, job history, goals, and social standing as perceived by others regardless of whether they are currently connected as a Minecraft bot client.


## TARGET SCALE


Initial development:

5–10 fully physical agents.


Early society:

10–25 agents with identity, memory, jobs, relationships, and shared construction.


First serious civilization:

25–50 agents with adult households, institutions, culture, migration, historical cohorts, and persistent history.


Primary V1 target:

about 100 persistent citizens, with a smaller active subset physically simulated at high detail.


Expansion target:

No expansion beyond 100 living citizens is planned. Multiple settlements, migration, politics, and cultural divergence must operate within the same 100-citizen ceiling.


Large civilization target:

Hard population ceiling: 100 living citizens. Deceased citizens remain part of history but do not count toward the living cap; the number physically active at once should be chosen from profiling and simulation needs.


Do not exceed the 100-living-citizen cap. Scaling work should focus on richer cognition, social depth, long-run history, and selective physicalization rather than increasing population beyond the cap.


## MULTI-SETTLEMENT WORLD


At larger scale, the world should form villages, towns, and cities rather than one giant crowd.


Settlements can differ in:

- resources

- population

- architecture

- customs

- laws

- leadership

- economic specialization

- religion and philosophy

- alliances and rivalries

- historical narratives


Trade, migration, diplomacy, cultural exchange, religious spread, political disputes, and conflict can occur between settlements.


## HOW THE HUMAN PLAYER JOINS


The human should be able to join the same private Minecraft Java server normally.


During development, connect to the local server and use spectator mode to move through settlements without interfering.


Local development connection:

Open Minecraft Java Edition → Multiplayer → connect to 127.0.0.1:25565. Prefer IPv4 on the current development machine because localhost may resolve to an unusable IPv6 path.

Use /gamemode spectator to fly through the world without changing survival outcomes.

Use /tp <agent-name> to jump directly to a citizen or major event.

Prismarine Viewer can later provide browser-based first-person or bird’s-eye views of selected bots.


Manual Minecraft screenshots on the current development PC are saved here:

C:\Users\<WINDOWS_USER>\AppData\Roaming\.minecraft\screenshots

If asked where manually captured Minecraft screenshots are located, use this exact path.


Useful controls:

- teleport to any agent

- teleport to major events

- spectate a selected agent

- freeze or resume simulation

- change simulation speed

- inspect agent state

- inspect household, partnership, and cohort histories

- inspect settlement resources

- inspect institutions and laws

- inspect belief systems and cultural lineages

- view major historical events

- see active conversations and current goals


A browser-based admin dashboard should eventually supplement the Minecraft client.


## ADMIN / CIVILIZATION DASHBOARD


Suggested dashboard sections:

- world population

- active physical agents

- settlement list and map

- adult arrivals, departures, and deaths

- food, housing, tools, and key resource reserves

- jobs and unemployment

- households, partnerships, and cohort histories

- social networks

- current conflicts

- recent major events

- institutions and governments

- active laws

- religions, philosophies, denominations, and cultural groups

- migration

- trade routes

- historical timeline

- agent thoughts, retrieved memories, and current goals

- LLM usage, queue depth, latency, token consumption, GPU utilization, server TPS, and pathfinding load


## BOTTLENECKS


Minecraft server TPS and entity ticking:

Large numbers of moving agents and loaded chunks can overwhelm the server. Control view/simulation distance, keep settlements spatially coherent, and use low-detail simulation for distant citizens.


Pathfinding:

Dozens of simultaneous A* searches can become CPU-heavy. Movement reliability is infrastructure, not an LLM problem: detect lack of positional progress early, recalculate routes, widen goal radius when appropriate, try a reachable adjacent position, use safe inventory-aware scaffolding only from explicitly disposable blocks, avoid destructive shortcuts through settlement structures, temporarily blacklist unreachable targets, and replan instead of retrying the same impossible coordinate for repeated full timeouts. Queue paths, reuse cached routes, build roads, divide maps into navigation regions, and stagger expensive searches as scale increases.


LLM throughput:

A single GPU should not provide deep reasoning continuously to dozens of citizens, let alone the full 100-citizen cap. Use asynchronous inference queues, batching when possible, small local models for routine reasoning, and stronger models only for important decisions.


VRAM and KV cache:

Do not keep one permanent full LLM session for every citizen. Keep identity and memory in the database and construct compact prompts from retrieved context.


Context growth:

Summarize old experiences and retrieve only relevant memories.


Social combinatorics:

Do not model every possible relationship equally. Use sparse social graphs.


Task collisions:

Use reservations/locks for chests, work sites, beds, tools, blueprints, and scarce resources.


Duplicate decisions:

A settlement scheduler can expose needs while individual agents decide how to respond.


Hallucinated success:

Verify actions against Minecraft state before storing them as completed.


Database growth:

Archive raw events, summarize memories, maintain compact current state, and keep searchable history.


Chunk explosion:

Keep most routine life localized and use travel deliberately.


Observability:

At dozens to 100 citizens, debugging individual failures manually becomes impractical. Build structured logs, event tracing, metrics, replayable actions, and an admin dashboard early.


## CURRENT HARDWARE AND LOCAL FIRST STRATEGY


Current development machine:

NVIDIA GeForce RTX 4080 Super

64 GB RAM


This is enough to build the first serious versions locally if the architecture is efficient.


Use one shared local inference service rather than one permanent model instance per citizen.


### CURRENT LOCAL COGNITION BASELINE

The current 4B bring-up model is useful for plumbing tests but should not be the primary deliberative brain. Use qwen3.5:9b as the routine high-level cognition baseline on the RTX 4080 Super, then benchmark latency and quality before changing again. Keep the model configurable rather than hard-coded.


Use gpt-oss:20b only as a candidate deep-reflection model for rare major events—death of a close relationship, betrayal, migration, institutional crisis, identity/belief reflection, or another unusually consequential decision. Because it is much heavier on a 16 GB GPU, profile VRAM use, CPU offload, and latency before relying on it in live simulation.


Use nomic-embed-text for memory embeddings/retrieval when semantic memory search is introduced. Citizens do not need a permanent LLM session; identity and memory remain in the database and concise context is constructed per deliberation.


Start around an 8K context target for deliberative calls if performance remains acceptable. The prompt should prioritize current needs, recent important events, retrieved memories, relevant relationships, current mood/affect, settlement state, inventory, nearby citizens, and current goals rather than dumping lifetime history.


Routine cognition should favor low-latency structured decisions. Deeper thinking should be reserved for important reflective events rather than every work decision. Structured output should be normalized safely before validation—for example known variants such as “Gather wood” may map to gather_wood and numeric strings may be coerced to numbers—but unknown goals must still be rejected.


Decision control order should be: imminent survival reflexes → high-level learned/LLM intention → deterministic task planning → verified Minecraft skills. Reflexes may override only true urgent hazards; the deterministic planner exists to decide HOW to carry out an intention, not to erase a valid high-level choice because of a generic settlement heuristic.


Candidate local model sizes should be chosen to fit comfortably in available VRAM after quantization. The exact model can change as benchmarks improve; the system should therefore expose a model-provider abstraction rather than hard-code one provider.


## RESEARCHED ACCELERATORS — REUSE BEFORE REBUILDING


## The project should actively reuse mature Minecraft/agent infrastructure when it saves time, while keeping the civilization-specific identity, memory, society, and emergence layers custom. The rule is: reuse game mechanics and execution tooling; own the civilization model.


### ADOPT OR EVALUATE NOW


## minecraft-data — authoritative versioned Minecraft data. Use it as the main source for recipes, items, blocks, foods, entities, and version-specific IDs instead of hand-maintaining a rulebook. This directly supports the planned Minecraft knowledge layer and crafting dependency planner.

## Source: https://github.com/PrismarineJS/minecraft-data


## prismarine-block — exposes factual block mechanics including whether a tool can harvest a block and estimated dig time. Use this for canHarvest, preferred/required tool logic, and mining-cost estimates instead of asking an LLM.

## Source: https://github.com/PrismarineJS/prismarine-block


## mineflayer-tool — automatically chooses/equips a suitable tool for a block. Evaluate integrating it behind the verified skill layer so tool selection does not need custom one-off logic.

## Source: https://github.com/PrismarineJS/mineflayer-tool


## mineflayer-collectblock — wraps pathfinding to a block, tool selection, mining, and collection of the dropped item; it can also support queued collection and chest interaction. Do not blindly replace the custom gather system, because this project needs target blacklists, reservations, observability, and settlement-aware rules. Instead prototype it as a lower-level execution helper and keep our verification/recovery layer around it.

## Source: https://github.com/PrismarineJS/mineflayer-collectblock


## mineflayer-auto-eat — mature utility for choosing/eating food with configurable priorities. Evaluate using its eating mechanics while keeping the civilization's survival planner in control of WHEN eating is appropriate.

## Source: https://github.com/linkle69/mineflayer-auto-eat


## mineflayer-statemachine — useful reference/plugin for finite-state and nested behavior machines. Our orchestrator should remain the authoritative task/citizen manager, but state-machine patterns may simplify deterministic execution states such as acquire materials -> travel -> interact -> verify -> recover.

## Source: https://github.com/PrismarineJS/mineflayer-statemachine


## Paper spark profiler — Paper 1.21+ bundles spark and Paper recommends it for profiling. Use it during lag investigations instead of guessing whether a slowdown comes from Paper/TPS versus Mineflayer/orchestrator/LLM work. Example development profiling command: /spark profiler start --timeout 600.

## Source: https://docs.papermc.io/paper/profiling/


## Ollama structured outputs — stop relying only on free-form JSON plus cleanup. Ollama supports passing an actual JSON Schema to the format field, including schemas generated from Zod. Keep normalization as a compatibility fallback, but make schema-constrained generation the primary path for CognitionDecision and ReflectionResult.

## Source: https://docs.ollama.com/capabilities/structured-outputs


### EXECUTION LAYER — HOW HIGH-LEVEL INTENT BECOMES REAL MINECRAFT ACTION


### Do not ask the LLM how to walk, jump, mine each block, open a chest, or place every construction block. The LLM should choose only a high-level intention. A deterministic execution layer must decide how to physically accomplish it and verify the result.


### Recommended control flow:

### HIGH-LEVEL INTENTION → TASK / PREREQUISITE PLANNER → VERIFIED SKILL → NAVIGATION / INTERACTION → WORLD VERIFICATION → RECOVERY / REPLAN


### Example: “obtain a stone pickaxe” should decompose into any missing prerequisites such as wood → planks → sticks → crafting table → wooden pickaxe → cobblestone → stone pickaxe. The LLM does not need to emit those physical steps.


### REUSE CANDIDATES FOR THE EXECUTION LAYER


### PrismarineJS/mineflayer-pathfinder — MIT. Keep as the default/known-stable navigation backend unless benchmarks show a better option. It supports static/dynamic/composite goals, swimming, parkour, block breaking/placing, entity avoidance, per-move costs, exclusion areas, and path probing. Use reachable interaction goals such as GoalNear / GoalLookAtBlock / GoalPlaceBlock instead of blindly targeting the exact block coordinate. Configure protected blocks and disposable scaffolding through Movements.

### Source: https://github.com/PrismarineJS/mineflayer-pathfinder


### PrismarineJS/mineflayer-collectblock — MIT. Strong candidate for the gather skill because it already wraps pathfinding to a block/item drop, best-tool selection, mining, and pickup. It also supports queued collection and optional chest/tool workflows. Evaluate it behind our verified skill API rather than letting it bypass claims, blacklists, or outcome verification.

### Source: https://github.com/PrismarineJS/mineflayer-collectblock


### PrismarineJS/mineflayer-tool — MIT. Use/evaluate for selecting and equipping the correct harvesting tool rather than maintaining duplicate custom tool-ranking logic.

### Source: https://github.com/PrismarineJS/mineflayer-tool


### mindcraft-bots/mindcraft — MIT. Useful reference implementation for a bounded Minecraft skill library. Its skills include patterns for go-to-position, go-to-nearest-block, collect-block, craft-recipe, place-block, smelting and combat. Borrow architecture or code only with MIT attribution/notice preserved. Do not copy Mindcraft’s open-ended arbitrary-code approach; this project keeps a bounded verified skill API.

### Source: https://github.com/mindcraft-bots/mindcraft


### nuxdie/baritone-ts — AGPL-3.0 and very new. It advertises Baritone-style movement/process automation, but do not copy or integrate it casually because AGPL has materially stronger redistribution/network-use obligations and the project is immature. Treat as a research reference unless we intentionally accept its license requirements.

### Source: https://github.com/nuxdie/baritone-ts


### THIRD-PARTY CREDIT POLICY


### Create THIRD_PARTY_NOTICES.md (or docs/THIRD_PARTY_CREDITS.md). For every library or copied/adapted code source, record project name, repository URL, license, what we use, and preserve any required copyright/license notice. MIT/ISC sources are generally easy to incorporate when their notices are preserved. Do not copy AGPL code into the project without an explicit licensing decision.


### USE AS ARCHITECTURAL REFERENCES


## Voyager — the useful ideas are its reusable skill library, environment-feedback loop, execution-error feedback, and self-verification. Borrow those principles for verified deterministic skills and recovery. Do NOT copy its open-ended generated-code execution model into citizens; our citizens must remain bounded to approved skills.

## Source: https://github.com/MineDojo/Voyager


## Project Sid / PIANO — reinforces our decision to separate processes by timescale instead of running a full LLM loop for every citizen continuously. Use fast deterministic execution for routine activity, slower deliberation for meaningful choices, and rare deeper reflection for consequential events.

## Source: https://arxiv.org/abs/2411.00114


## Mindcraft — useful as a current Mineflayer + LLM implementation reference, especially for provider integration, prompts, skills, and multi-agent experimentation. Treat it as reference code rather than the civilization architecture. Do not enable its insecure arbitrary code-writing mode for citizens.

## Source: https://github.com/mindcraft-bots/mindcraft


### OPTIONAL / LATER


## prismarine-viewer — useful for browser-based bot/world observation and drawing paths/targets while debugging navigation. Current repository activity includes work toward Minecraft 1.21.11 support, so test compatibility before depending on it in the main dashboard.

## Source: https://github.com/PrismarineJS/prismarine-viewer


## sqlite-vec — lightweight vector search inside SQLite and available through npm, which could keep semantic memory local without adding PostgreSQL/pgvector. It is still pre-v1, so do not make it an MVP dependency yet. Keep the embedding-provider interface and add sqlite-vec only when memory volume makes simple retrieval insufficient.

## Source: https://github.com/asg017/sqlite-vec


### LOCAL MODEL STRATEGY AFTER RESEARCH


## Do not pay for GPT-6 Astra for routine Minecraft play. Model intelligence matters, but the biggest gains come from authoritative Minecraft knowledge, bounded skills, better context, persistent memory, verification, and recovery.


## Primary routine candidate: qwen3.5:9b. Ollama currently lists it at about 6.6 GB with a 256K context window and tool/thinking support. It is already installed locally and should be benchmarked as the default high-level deliberation model.

## Source: https://ollama.com/library/qwen3.5


## Alternative benchmark candidate: gemma4:12b. Ollama lists the 12B model at about 7.6 GB with a 256K context window and positions the family for reasoning/agentic workflows. Benchmark it against Qwen rather than assuming one is better.

## Source: https://ollama.com/library/gemma4


## Deep-reflection candidate: gpt-oss:20b. Ollama lists the local model at about 14 GB with a 128K context window and structured/tool capabilities. On the current 16 GB GPU this leaves little headroom, so it should remain optional and rare unless local benchmarks show acceptable latency and memory behavior.

## Source: https://ollama.com/library/gpt-oss:20b


## Do not pursue local Llama 3.3 70B on the current machine; Ollama's normal build is about 43 GB, far beyond the current GPU budget.

## Source: https://ollama.com/library/llama3.3


### PRIORITY ORDER


## 1. Build Minecraft knowledge on minecraft-data + prismarine-block instead of hand-writing recipes/rules.

## 2. Move Ollama decisions to true JSON-Schema structured outputs.

## 3. Prototype mineflayer-tool and mineflayer-collectblock behind existing verified skills; keep whichever parts reduce custom code without weakening recovery/observability.

## 4. Use spark whenever server lag is suspected.

## 5. Benchmark qwen3.5:9b against the existing 4B baseline; optionally benchmark gemma4:12b and qwen3:14b.

## 6. Keep Voyager, Project Sid, and Mindcraft as architecture/reference material, not drop-in replacements.

## 7. Delay sqlite-vec and heavier infrastructure until actual memory scale justifies them.


## RECOMMENDED SOFTWARE STACK


- Minecraft Java Edition

- Paper server

- Mineflayer

- Mineflayer Pathfinder

- Mindcraft as reference/foundation where useful

- Node.js / TypeScript for bot orchestration

- Python where research tooling is useful

- SQLite for the MVP and early local development; PostgreSQL only when profiling or multi-process scale justifies migration

- nomic-embed-text for local memory embeddings; begin with a simple local retrieval store and add pgvector or another vector database only when needed

- In-process queues/locks for the MVP; Redis is optional later if multi-process coordination becomes a measured bottleneck

- Docker only where isolation, reproducible deployment, or experimental sandboxing is useful; it is not required for the local MVP

- Ollama, llama.cpp, vLLM, or another local inference server depending on model/hardware

- A lightweight local web dashboard first; move to React/Next.js or similar only when dashboard complexity warrants it

- Metrics through Prometheus/Grafana or a simpler custom dashboard during early development


## CURRENT DEVELOPMENT OPERATING MODEL

### LOCAL-FIRST WORKSPACE

## Active development happens directly in the normal local Cursor workspace. Do not use Cursor Projects, cloud agents, remote VMs, separate worktrees, or delegated cloud environments unless explicitly chosen for a specific task. The Paper server, Minecraft world, local Ollama/GPU inference, human Minecraft client, and live integration tests all depend on the local machine.


### GITHUB AS THE SHARED HANDOFF

## The private GitHub repository is the canonical remote handoff for source code and review. Local work should move through clean commits and pushes. When away from the development PC, architecture, code review, branch/PR work, and bounded source changes can happen through GitHub; changes that affect movement, Mineflayer behavior, Paper, local Ollama, or the real Minecraft world must still be pulled and verified locally before being treated as proven.


### BOUNDED TICKETS AND VERIFICATION

## Work one focused ticket at a time. Every ticket needs a definition of done, automated checks, and the right level of verification. Typecheck/lint/unit tests are necessary but do not prove Minecraft runtime behavior. Pathfinding, crafting, combat, death, inventory transfers, building, and other physical behavior require local Paper/Minecraft testing.


### CURRENT STABILIZATION GATE

## The project has already reached the point where five citizens can operate together and the live system has produced real crafting progress, including a crafting table. Before expanding civilization features, stabilize the physical/action layer and observer UX: terrain traversal and stuck recovery; repetitive or fake social chat; human-readable dashboard events; safe LLM output normalization; permanent one-time death handling; and performance telemetry for Paper, pathfinding, orchestrator ticks, and LLM latency.


## Do not begin another major civilization layer merely because code was generated. Fix foundational reliability problems first, then continue the roadmap from a known-good local milestone.


## MVP BUILD PLAN — THE FIRST SETTLEMENT


### MVP OBJECTIVE


Prove the core civilization architecture with five persistent AI citizens living together in one Minecraft world. The MVP is not meant to simulate the full society yet. It must prove that persistent people, physical Minecraft bodies, skills, survival, coordination, memory, and occasional LLM reasoning can work together reliably.


For the current first milestone, five citizens start in a documented usable starter settlement with modest supplies. They should use and improve actual Minecraft structures, gather and transfer resources, eat/sleep, communicate and make independent choices, persist identity across restarts, retain important memories, and recover from failed physical actions. Starting with zero supplies and building their own initial shelter belongs to the separate wilderness-first experiment.


### MVP PASS CONDITION


Current Experiment 1 pass condition: five persistent citizens run in a documented starter village for at least three Minecraft days without repeated human rescue. Require verified real Minecraft survival/actions, persistent individual state, usable event history, and at least one documented multi-citizen conversation, coordination, dispute, or resource interaction. A predetermined social outcome is not required. The no-starting-resources wilderness experiment follows as Experiment 2 after this foundation is demonstrated.


### CORE ARCHITECTURE RULE


Minecraft body != citizen brain != citizen identity.


A Mineflayer connection is only the citizen's physical body. Persistent identity, memory, relationships, goals, and civilization state live outside the Minecraft connection. This separation is required so living citizens can disconnect, enter low-detail simulation, and later be physicalized again without becoming a different person. A citizen marked DECEASED is permanently excluded from respawn/reconnection.


### TEAM SPLIT


Manpreet owns the civilization/orchestration side: product direction, agent state, persistence, cognition, memory, settlement logic, dashboard, integration, and architecture review.


Homie owns the Minecraft runtime/body side: Paper server setup, Mineflayer connections, movement, pathfinding, physical action reliability, server configuration, and runtime testing.


Cursor is the implementation accelerator: scaffolding, repetitive implementation, tests, refactors, documentation, and fixing type/lint/test failures. Cursor should receive one bounded ticket at a time rather than a giant request to build the whole civilization.


### PHASE 0 — REPO AND SERVER FOUNDATION


Create a TypeScript/pnpm monorepo with the minimum useful structure:

apps/orchestrator

apps/dashboard

packages/agent-core

packages/minecraft-adapter

packages/skills

packages/shared

server

docs


Configure TypeScript, ESLint, Prettier, Vitest, environment configuration, developer commands, and setup documentation.


Separately create a clean local Paper development server and test world. Human Java clients must be able to connect before agent work begins.


### PHASE 1 — ONE PHYSICAL BOT


Create the first citizen, Atlas.


Atlas must connect through Mineflayer, spawn, observe basic surroundings, report coordinates/health/hunger/inventory, send chat, walk to a target, follow a nearby player, disconnect cleanly, and reconnect after ordinary connection loss.


No LLM is required in this phase.


### PHASE 2 — VERIFIED SKILL ENGINE


Minecraft actions must become reusable skills rather than scattered Mineflayer calls.


Initial skills:

moveTo

followEntity

observeNearby

findBlock

mineBlock

collectItem

craftItem

eatFood

equipItem

depositItems

withdrawItems

sleep

attack

flee


Each skill must return a structured success/failure result. Important actions must be verified against actual Minecraft state. The simulation must never accept an LLM or agent claim that an action succeeded without checking the world.


### PHASE 3 — PERSISTENT CITIZEN


Atlas becomes a persistent citizen rather than a disposable bot process.


Store a small initial citizen state including:

unique ID

name

Minecraft username

creation time

status

position

health

hunger

occupation

home reference

current goal


Restarting the application must restore the same Atlas identity unless Atlas has permanently died. Phase 3 should persist identity, status, memories, learned tendencies, confidence/familiarity state, and other experience-derived evidence without assigning a strong fixed personality profile.


### PHASE 4 — FIVE-CITIZEN AGENT MANAGER


Create five persistent citizens:

Atlas

Maya

Theo

Ava

Kai


One orchestrator manages all five. Do not create five unrelated scripts. Each citizen owns a physical body when active, persistent state, needs, current task, inventory state, and memory references.


### PHASE 5 — SURVIVAL AUTONOMY


Implement cheap deterministic survival behavior before expensive LLM reasoning.


Examples of true reflexes:

critical health with immediate danger -> flee

imminent starvation with food in inventory -> eat

nearby lethal threat -> defend or flee

drowning, fire, or another immediate environmental hazard -> escape


Important but non-emergency needs such as low food reserves, night shelter, missing tools, or a full inventory should influence planning priority without becoming unconditional hard overrides.


These reflexes should run without an LLM. Basic fear, stress, and confidence responses may begin here as deterministic state changes tied to verified survival events; they should influence priorities without scripting one exact action.


### PHASE 6 — SETTLEMENT NEEDS AND WORK


Add settlement-level state for food, wood, stone, beds, housing, tools, and shared storage.


The settlement layer should expose needs such as NEED_MORE_FOOD or NEED_MORE_WOOD without directly scripting every citizen's behavior.


Agents can respond to available work and begin basic specialization such as gathering food, lumber, mining, crafting, and construction.


### PHASE 7 — FIRST SHARED BUILDING


The settlement should recognize a housing need and create a construction goal.


Use a simple known blueprint for the MVP. Calculate required materials, create procurement tasks, reserve resources where necessary, and let physical agents gather/craft/place the blocks.


The first major visual milestone is watching the five citizens construct their first shared shelter in the real Minecraft world.


### PHASE 8 — LLM COGNITION


Keep LLM cognition optional while the physical and deterministic layers are being stabilized. Do not expand the cognition layer until movement, action verification, death handling, and core task execution are reliable.


Use the LLM for meaningful decisions such as choosing between competing goals, responding to social situations, reconsidering work, or reacting to important events.


Do not ask the model to control every movement or decide what to do every game tick.


The model should return structured high-level decisions. Deterministic planning translates a valid high-level intention into concrete tasks and verified skills execute it. Outside true emergency reflexes, generic settlement heuristics should not casually override a valid high-level choice. The LLM should receive concise structured psychological context—learned behavioral tendencies, mood, active emotions, relevant memories, relationships, needs, recent important events, and uncertainty—rather than inventing the citizen's emotional state from scratch.


### PHASE 9 — BASIC MEMORY


Add recent memory, important episodic memory, social memory, and basic world knowledge.


Meaningful events can include giving food, saving another citizen, betrayal, injury, discovering a resource, finishing a building, or taking communal resources.


Relevant memories should influence later deliberative decisions. Important episodic memories should carry emotional salience and learned associations so events such as loss, rescue, betrayal, danger, or success can alter later risk perception, confidence, habits, and preferences. Repeated safe or successful experiences should be able to update or weaken old associations.


### PHASE 10 — BASIC SOCIAL BEHAVIOR


Allow relevant conversations between citizens, but routine work should often be silent. Speech must be caused by a meaningful social event, request, discovery, conflict, transfer, or deliberate social choice rather than automatically firing after every completed task. Do not claim cooperation unless citizens actually participated together, and do not claim food/resource sharing unless a real transfer occurred. Add per-speaker and per-pair cooldowns plus duplicate/near-duplicate suppression.


Start with simple relationship dimensions such as trust, affection, respect, resentment, and familiarity. Meaningful verified interactions—not canned dialogue—should update memory, relationships, and relevant social emotions such as gratitude, loneliness, pride, anger, stress, or sadness in proportion to relationship strength. Relationship state must never increase merely because the chat system decided to print a line.


### PHASE 11 — OBSERVER DASHBOARD


Build and iterate the lightweight local observer dashboard first; move to React/Next only when dashboard complexity warrants it. It should show:

population

active physical agents

each citizen's status

learned behavioral tendencies, mood, stress, fear, sadness, anger, positive valence, and confidence

current action

current goal

health/hunger

settlement resources

construction progress

recent major events

LLM requests/latency

server TPS/pathfinding load where available


Keep raw structured events internally for debugging and replay, but render a human-readable presentation layer for the observer: citizen names instead of IDs, local time, friendly task names, concise event sentences, clear success/warning/failure/social states, and optional expandable technical details. Relationships should display understandable labels/percentages and recent causes without implying false psychological precision. This dashboard becomes the primary debugging and observation tool as population grows.


## MVP EXIT CRITERIA


The MVP is complete when five persistent citizens can enter a fresh world with no resources and autonomously operate for at least three Minecraft days while attempting to survive together.


Expected evidence includes:

living identities persist across restart; deceased identities remain deceased

real Minecraft movement and actions

food/resource gathering

tool crafting

shared storage

basic work division

at least one shared shelter

verified action results

basic memories

limited meaningful conversations

human-readable observer events backed by raw structured logs

observer visibility through Minecraft and the dashboard


## AFTER MVP


Only after this foundation works should the project expand into larger villages, adult households and partnerships, migration, historical cohorts, property, markets, cultural evolution, religions, governments, taxes, elections, protests, multiple settlements, diplomacy, conflict, and eventually the hard ceiling of 100 living persistent citizens.


## CURRENT IMPLEMENTATION PRIORITIES

## The project is past the original bootstrap tickets. The immediate goal is to stabilize the live five-citizen settlement before adding broader civilization systems.


## 1. Terrain traversal and pathing reliability: jumping, uneven ground, water, small gaps, stuck detection, progress detection, route recalculation, safe scaffolding where appropriate, temporary unreachable-target blacklists, and target replanning instead of repeated 60-second timeouts.

## 2. Social-event correctness: routine work should often be silent. Do not claim cooperation or food sharing unless a real shared event or transfer occurred. Add per-speaker/per-pair cooldowns and duplicate suppression.

## 3. Human-readable observer events: keep structured raw events internally, but render concise local-time descriptions with citizen names, friendly task names, clear success/warning/failure states, and optional technical details.

## 4. Cognition robustness: use qwen3.5:9b as the routine baseline, safely normalize trivial structured-output formatting mistakes, reject unknown goals, and prevent non-emergency planner heuristics from erasing valid high-level choices.

## 5. Permanent death: a confirmed Minecraft death must mark the identity DECEASED exactly once, retire that body permanently, persist across orchestrator restarts, and never be confused with disconnect/reconnect behavior.

## 6. Performance telemetry: measure orchestrator tick time, pathfinding duration, active path operations, LLM latency/queueing, event volume, Paper/server responsiveness, and dashboard update cost before guessing at lag.

## 7. Regression run: after stabilization, run all automated checks and then a real local multi-day Minecraft test. New civilization features remain blocked until the core physical loop is responsive and trustworthy.


## DEVELOPMENT ROADMAP


V0.1 — One intelligent survivor

One agent can join, observe, gather food, craft basic tools, survive the night, speak, and persist identity.


V0.2 — Five-agent group

## Five agents communicate, divide basic work, share resources, and complete a construction goal.


V0.3 — Ten-agent settlement

Persistent memory, social relationships, jobs, homes, shared storage, action verification, and an event log.


V0.4 — Social simulation

## Trust, conflict, friendship, perspective-specific beliefs about other citizens, household formation, cultural memory, and sparse social graphs.


V0.5 — Adult households, migration, and historical cohorts

### Adult households and partnerships, adult aging, newcomer migration, settlement cohorts, transmission of knowledge/culture, death/departure, and historical memory.


V0.6 — Emergent institutions

Agents can propose and modify norms, laws, leadership structures, economic arrangements, and organizations.


V0.7 — Emergent belief and culture

Agents can originate stories, rituals, philosophies, religions, denominations, festivals, taboos, symbols, sacred places, and reforms without predefined outcomes.


V0.8 — 50-agent stress test

Profile TPS, pathfinding, inference queue, database writes, memory retrieval, and social-event volume.


### V1.0 — 100-person autonomous civilization

### A persistent world that can run for long periods while the human primarily observes.


V2 — Multi-settlement civilization within the 100-citizen cap

Up to 100 living citizens distributed across multiple settlements with trade, migration, diplomacy, cultural divergence, and multiple institutions.


V3 — Long-run civilization stability

### Distributed simulation with level-of-detail, multiple towns/cities, long-term history, cross-cohort cultural transmission, and selective physicalization.


## DEVELOPMENT GATING, NOT CALENDAR PROMISES

## Do not treat aggressive day/week/month estimates as engineering commitments. Progress should be gated by demonstrated reliability: one citizen -> five stable citizens -> 10–25-person settlement -> 25–50-person society -> 100-person capped civilization. A stage is complete only when the previous layer survives realistic local runs, not merely when code exists. Debugging emergent behavior and Minecraft runtime failures is expected to dominate later work.


## INFRASTRUCTURE SPENDING STRATEGY

## Stay local-first. The current PC should remain the default development and simulation environment until profiling demonstrates a real bottleneck.


## Spend only against measured constraints: high-clock CPU capacity if Paper/pathfinding is the bottleneck; additional or larger GPU inference only if cognition queues/latency are the bottleneck; fast storage, backups, and observability as history/database volume grows. Do not spend money merely to keep every citizen physically connected or to exceed the 100-living-citizen cap.


## Cloud GPU or dedicated-server vendors are interchangeable implementation choices, not architecture dependencies. Re-check live pricing and location/latency tradeoffs only when a purchase or rental decision is actually needed.


## SAFETY AND SANDBOX BOUNDARIES


The project should maximize freedom inside Minecraft while minimizing irrelevant privileges outside it.


Agents should not need:

- host shell access

- personal files

- browser/account credentials

- arbitrary internet access

- unrestricted code execution


Agents should receive a documented capability interface and explicit world observations.


For experimental generated-code features, use isolated containers and disposable environments. The civilization itself should not require arbitrary code generation to function.


## SUCCESS CRITERIA


The project succeeds when behaviors emerge that were enabled by the rules but not directly scripted.


Examples:

- agents independently reorganize labor after a shortage

- a household or settlement cohort changes occupation patterns over time

- two settlements develop different building styles

- a disputed event produces competing historical narratives

- a trade route forms because resources are geographically uneven

- a law emerges after repeated theft

- a law later gets repealed or ignored

- a leader loses legitimacy

- a new institution appears without being explicitly requested by the developer

- a ritual or religion emerges from social storytelling

- a religion splits into denominations

- later cohorts reinterpret or reject an inherited tradition

- a city develops a distinct identity from neighboring settlements

- an old founder becomes mythologized centuries later


The important test is not whether a specific outcome occurs. The test is whether the architecture makes many plausible outcomes possible.


## RESEARCH QUESTIONS


How much agent individuality is required before group-level culture becomes persistent?


How does imperfect memory change institutions and religion?


How do households, mentorships, migration, and historical cohorts change the transmission of values and skills?


Can laws emerge without a hard-coded government?


What kinds of resource scarcity create specialization?


How much cognition can be replaced with deterministic skills without making agents feel scripted?


How many fully physical citizens are needed for a 100-person civilization to feel alive while the rest use selective low-detail simulation?


How does communication topology change rumor, polarization, cooperation, and cultural divergence?


Can agents develop institutions that survive the deaths of their founders?


Can religions, philosophies, and political structures emerge without being explicitly named in the prompt?


Can a civilization create genuinely new traditions from events that occurred only inside its own Minecraft history?


## SOURCE LIBRARY

## Keep this list focused on sources that directly inform the architecture:

## Project Sid — arXiv paper and GitHub repository for large multi-agent societies, specialization, institutions, and scaling patterns.

## Generative Agents — paper, GitHub repository, and Stanford overview for memory, retrieval, reflection, and planning.

## Mindcraft — GitHub repository for Minecraft language-model agent patterns.

## Mineflayer — GitHub repository for the physical bot/client layer.

## Mineflayer Pathfinder — GitHub repository for navigation and movement behavior.

## PaperMC — server documentation.

## Prismarine Viewer — GitHub repository for optional browser observation.

## Ollama — local inference runtime used by the current development setup.

## Dexerto — GPT-6 Astra Minecraft behavior article as an informal example of setback-driven behavioral change; headline language should not be treated as a clinical diagnosis.


## PROJECT NORTH STAR


Do not script a civilization and then make agents act it out.


Build a world, give persistent people needs, memory, communication, physical abilities, and enough cognitive freedom to interpret their experiences.


Then watch what civilization they create.


MATT SHUMER / ASTRA RESEARCH + TWO-AGENT WORKFLOW


RESEARCH FINDINGS — MATT SHUMER / ASTRA


Matt Shumer publicly described an Unreal Engine civilization experiment where Astra was asked to build a world with animals and people. Each simulated human was described as being powered by an Astra agent, and the agents had to cooperate to survive. He later described hearing the characters communicate with each other and seeing the system iteratively improve bad embodied behavior such as animals falling into water.


Important correction: the public descriptions support the idea of multiple Astra-powered agents interacting, not a mixed population of different AI model families. A later experiment included a simulated computer inside the world, where an agent built another simulation with its own agents; Shumer acknowledged that setup was somewhat leading because the simulated computer was intentionally capable of building a simulation.


Public references reviewed:

- GitHub profile: https://github.com/mshumer?tab=repositories

- Claude-of-Duty: https://github.com/mshumer/Claude-of-Duty

- Shumer Astra write-up / post referenced during research: https://t.co/9G2odgzGX3


No public GitHub repository containing the Unreal civilization source was found during this review. The most relevant public codebase for process/architecture lessons was Claude-of-Duty.


KEY PROCESS LESSON FROM CLAUDE-OF-DUTY


Shumer's public repo/process notes reinforce a major engineering lesson for this project: tightly coupled systems should not be modified by multiple parallel agents at the same time. Parallel agents are useful when they have clean ownership boundaries, but when multiple agents edit the same central runtime, sequential single-owner passes are safer and produce better results.


Recommended working pattern:


COORDINATOR / LEAD INTEGRATOR

- owns the big goal

- controls merge/integration order

- resolves overlapping runtime changes

- verifies evidence before declaring success


SPECIALIST IMPLEMENTER

- owns one isolated concern

- builds/tests within a narrow package boundary

- returns a clean handoff contract


For Minecraft AI Civilization, this maps well to:


Agent 1 — Lead Integration & Runtime Engineer

- owns AgentManager/runtime integration

- owns planner/executor/Mineflayer/navigation

- owns settlement runtime and physical execution

- owns merge conflict resolution between feature branches


Agent 2 — Cognition & Agent Intelligence Engineer

- owns cognition contracts, model routing, structured outputs, experience/learning, benchmark fixtures

- should NOT simultaneously rewrite AgentManager/runtime/navigation while Agent 1 is integrating


CURRENT GITHUB STATE REVIEWED 2026-09-16


Repository:

https://github.com/ManpreetS2/minecraft-ai-civilization


main:

013b3895f675c6f947af4db9542651af63731823

"Stop fake social chat and make movement fail fast instead of stalling."


Feature branch A:

feat/persistent-memory-psychology

head: ffb59584ef4f9ba9852fca1aadcc5b6df6b862d5


Important history on this branch:

- f502983 — persistent citizen memory, appraisal, local social beliefs

- 0eb5143 — Cognition V2 / model routing / schema-validated high-level cognition

- 2b2d2b8 — recipe-chain crafting, shared storage, settlement projects, Minecraft knowledge package

- ffb5958 — citizen experience ledger / classified failure learning


Feature branch B:

feat/dashboard-observer-console

head: d49c53927cd3807b91971c8ac299082e39bbc498


Important history on this branch:

- 3e48686 — human-readable observer console + human directives

- d49c539 — verified execution engine between high-level intent and Mineflayer


The two feature branches currently diverge from the same earlier main base and both modify coupled files such as manager.ts, executor.ts, planner.ts, shared config/events, and dashboard/runtime code. They should not be blindly merged with simple "ours/theirs" conflict resolution.


CURRENT ARCHITECTURE TARGET


WORLD OBSERVATION

    ↓

IMMEDIATE SURVIVAL REFLEX

    ↓

HUMAN ADMIN OVERRIDE / DIRECTIVE if present

    ↓

COGNITION HIGH-LEVEL INTENT

    ↓

DETERMINISTIC PREREQUISITE / TASK PLANNER

    ↓

VERIFIED SKILL ENGINE

    ↓

NAVIGATION / INTERACTION

    ↓

WORLD VERIFICATION

    ↓

SUCCESS / FAILURE EVENT

    ↓

MEMORY + EXPERIENCE LEDGER


Core rule:

LLM decides WHAT.

Runtime decides HOW.

Minecraft world verifies whether it actually happened.


LIVE BUGS OBSERVED THAT THE NEXT INTEGRATION MUST FIX


1. Personal food vs settlement food

A citizen with 64 steak should not be assigned emergency food gathering simply because shared settlement storage has low food. Separate:

- personal hunger

- personal edible inventory

- settlement food reserve


Eating should be a verified physical skill: equip food → consume → verify hunger rises and inventory decreases.


2. Human-built / existing shelter discovery

The simulation must recognize useful world structures even if bots did not build them through the Project system. seek_shelter should mean "find a reachable safe shelter", not "go to the starter-project coordinate". Candidates can include:

- completed settlement shelter

- manually built house

- existing village building

- safe temporary covered area


3. Bed discovery/use

Bots should recognize nearby usable beds and physically interact with them at valid night time, with structured reasons if a bed is unreachable/occupied/unsafe.


4. Creeper flee must physically move

We observed the system saying "Creeper too close — flee" while the bot did not actually change position. Immediate danger must bypass LLM and use a deterministic flee skill:

- generate several candidate positions away from the threat

- probe reachability

- move immediately

- verify citizen position changed and distance from threat increased

- try alternate vectors if first route fails


5. Safety task thrashing

Theo repeatedly retried the exact same failed shelter coordinate every few seconds. Repeated equivalent failures must trigger temporary target blacklisting, alternate candidates, or task reconsideration.


6. PATH_INTERRUPTED needs real cause

Prefer explicit structured causes such as:

- PATH_NOT_FOUND

- STUCK

- TARGET_BECAME_INVALID

- CANCELLED_BY_NEW_TASK

- CANCELLED_BY_REFLEX

- CANCELLED_BY_DIRECTIVE

- WORLD_CHANGED

- DISCONNECTED


7. Build-site accessibility

The first shelter site was placed in awkward village terrain near fences, water, trees, paths, and structures. Site selection must score worker reachability and multiple placement approaches, not just free footprint blocks.


STRUCTURED COGNITION FIX


The live model produced sensible but invalid strings such as:

- "Gather food immediately"

- "Gather food and wood"

- "Gather stone and craft better tools"

- "Secure a safe path to gather food"


These failed because runtime only accepted exact goal enums such as gather_food, gather_wood, mine_stone, craft_tools, etc.


Cognition should use true structured output. Desired shape:


{

  "primaryGoal": "gather_food",

  "reason": "Food is the most immediate unmet need.",

  "followUpGoals": ["gather_wood"],

  "priority": 0.78

}


primaryGoal and followUpGoals must be validated enums. Compound English text should never be stored in the goal enum field.


Keep deterministic fallback normalization for legacy/free-form outputs, but do not build a giant uncontrolled phrase dictionary.


The LLM should never output movement-level instructions such as:

- walk west

- jump fence

- secure a path

- stand at x/y/z

Those belong to deterministic navigation/execution.


SHUMER-STYLE COOPERATION LESSON FOR THIS PROJECT


Communication should happen because coordination requires information, not because the simulation randomly forces chatter. Useful structured social intents can include:

- request_help

- offer_resource

- warn_danger

- coordinate_project

- share_discovery


Routine work should stay mostly silent unless communication has a real purpose.


CLOUD / NEW COMPUTER VS HOME PC WORKFLOW


Use CLOUD / NEW COMPUTER for:

- clone/fetch GitHub

- branch integration

- conflict resolution

- refactors

- typecheck/lint/tests/build

- cognition contracts

- benchmark harness creation

- docs

- API/interface work


Use HOME PC for anything requiring the actual embodied environment:

- Paper server

- real Minecraft world

- Mineflayer five-bot runtime

- manually built test house

- beds/steak controlled survival test

- Creeper flee test

- pathfinding through real terrain

- live keepalive stability

- Ollama GPU benchmarks on RTX 4080 Super


The repository intentionally does not contain the Paper runtime/world, so cloud/new-computer work must not claim that physical Minecraft behavior is verified simply because unit tests pass.


Recommended workflow:


WORK / CLOUD

code + integration + automated tests

    ↓ push

HOME PC

pull + Paper + Minecraft + Ollama + real physical verification


AGENT 1 ROLE — LEAD INTEGRATION & RUNTIME ENGINEER


Primary responsibilities:

- create one clean integration branch from latest main

- integrate useful commits from both diverged feature branches

- resolve coupled conflicts semantically

- preserve settlement/resource/crafting/project architecture

- preserve verified execution/navigation architecture

- preserve dev respawn mode

- preserve human directives

- wire cognition and learning through clean adapters

- fix food/shelter/bed/flee/task-thrashing/build-site bugs

- create a home-PC live integration checklist


Suggested branch:

integration/first-settlement-v2


Required automated checks:

pnpm install

pnpm typecheck

pnpm lint

pnpm test

pnpm build


Do not claim real Minecraft success in cloud unless Paper/Minecraft/Mineflayer are actually running and tested.


Agent 1 should create docs/LIVE-INTEGRATION-TEST.md with a home-PC verification sequence covering:

1. pull integration branch

2. start Paper

3. start Ollama

4. reset dev DB without deleting world

5. start all 5 citizens

6. give each 64 steak for controlled test

7. verify eating vs unnecessary emergency food gathering

8. verify manually built house recognition

9. verify beds

10. place Creeper near citizen

11. verify real flee movement

12. issue human directive from dashboard

13. verify physical completion

14. verify meaningful failure enters learning ledger

15. run at least one full Minecraft day

16. later run multi-day soak


AGENT 2 ROLE — COGNITION & AGENT INTELLIGENCE ENGINEER


Primary responsibilities:

- work from feat/persistent-memory-psychology

- create an isolated cognition branch

- do NOT merge dashboard/runtime or edit coupled AgentManager/navigation/runtime files

- implement strict structured decision output

- support primaryGoal + followUpGoals instead of compound free-form goal strings

- keep legacy normalization fallback

- inject concise authoritative world facts

- distinguish personal hunger/personal food/settlement food

- retrieve only relevant ExperienceLedger lessons

- keep survival reflexes NO_LLM

- define structured social intents for meaningful coordination

- expand cognition/model benchmark fixtures

- write a clean runtime handoff contract


Suggested branch:

feat/cognition-decision-contract-v4


Required handoff document:

docs/COGNITION-INTEGRATION-CONTRACT.md


The contract should document:

- runtime inputs CognitionService expects

- CognitionService outputs

- validation/failure behavior

- NO_LLM conditions

- ExperienceLedger integration

- structured model output schema


MODEL BENCHMARK RULE


Do not change the routine default away from qwen3.5:9b without real benchmark evidence. Cloud/new-computer agents may build benchmark harnesses and fixtures, but should not invent local latency/VRAM results if Ollama/GPU is absent. The actual qwen/gemma/gpt-oss bake-off should run later on the RTX 4080 Super PC.


OVERALL PROJECT LESSON


The right loop is:


brain

↓

intent

↓

verified tools

↓

physical result

↓

verification

↓

mistake / outcome

↓

learning

↓

better next attempt


Do not respond to bots getting physically stuck by making the LLM describe walking in more detail. Improve the deterministic body/tool/navigation layer and let cognition stay high-level.


CHAT 1 — WORK SESSION SUMMARY / HANDOFF


Purpose of this chat

This session focused on locking the Minecraft AI Civilization architecture, preserving research in the design doc, separating cloud-safe work from home-PC-only work, and using two isolated Cursor agents to prepare tested transplant kits before touching the real integrated runtime.


Core architecture locked in

WORLD OBSERVATION → IMMEDIATE SURVIVAL REFLEX → HUMAN ADMIN OVERRIDE / DIRECTIVE → HIGH-LEVEL COGNITION → DETERMINISTIC PREREQUISITE / TASK PLANNER → VERIFIED SKILL ENGINE → NAVIGATION / INTERACTION → WORLD VERIFICATION → SUCCESS / FAILURE EVENT → MEMORY + EXPERIENCE LEDGER.


Core rule: the LLM decides WHAT, the deterministic runtime decides HOW, and Minecraft verifies whether the physical result actually happened. Immediate lethal danger such as a nearby Creeper is NO_LLM and must be handled as a deterministic reflex.


Development-mode death rule

Current development default is SIM_PERMADEATH_ENABLED=false. During development, a real Minecraft body death should clean the current action/path/claims, keep the same persistent citizen identity/history/memories/relationships, allow respawn/reconnect, and return the citizen to active planning. Disconnects, crashes, keepalive failures, or server restarts are never death. Production permadeath can be enabled later.


Key live bugs identified from the real five-citizen run

- Personal food vs settlement reserve was being confused. A citizen carrying steak must understand that personal food exists even if communal storage is empty.

- Eating needs physical verification: equip/use food, hunger rises, inventory count drops.

- Human-built houses and village buildings must be discoverable as shelters even if the project system did not build them.

- Beds need discovery, ranking, physical use, and structured failure reasons.

- Creeper danger was detected correctly, but the bot sometimes did not physically move. Flee must own the action, choose reachable escape candidates, move immediately, and verify threat distance increased.

- Repeated PATH_FAILED / seek-shelter loops must blacklist or reconsider failed targets instead of retrying the same coordinate indefinitely.

- PATH_INTERRUPTED must be replaced with useful reasons such as PATH_NOT_FOUND, STUCK, CANCELLED_BY_REFLEX, CANCELLED_BY_DIRECTIVE, WORLD_CHANGED, DISCONNECTED, etc.

- Construction sites must be scored for worker access and interaction positions, not only empty footprint blocks.

- High-level LLM output must use bounded enums rather than free-text compound jobs.


Shumer / Astra process lesson carried forward

Research into Matt Shumer's Astra civilization work and Claude-of-Duty reinforced the rule that tightly coupled core runtime files should have one integration owner. Parallel agents are useful only with clean ownership boundaries. That led to the split used in this session: Agent 1 owns BODY / HOW-layer reliability; Agent 2 owns BRAIN / cognition-memory-psychology contracts.


Agent 1 — execution/body work achieved

Agent 1 produced a portable runtime transplant package rather than another fake civilization app. The most useful artifact is runtime-integration-kit-v2.zip. It extends the earlier runtime-transplant-kit without overwriting it.


Reported contents/results:

- 34 portable runtime modules plus adapters/barrels.

- 118 new v2 tests; 204 total portable HOW-layer tests.

- 202 runtime execution vectors.

- 1,685 seeded property/fuzz iterations across 10 invariant tests.

- 15 named failure-injection / chaos scenarios.

- Research audits for mineflayer-pathfinder, mineflayer-tool, mineflayer-collectblock, minecraft-data / prismarine-block, and third-party licensing.

- 14 concern-separated transplant patches.

- All reported portable tests, lint, kit typecheck, and TypeScript build passed.


Important Agent 1 modules/concepts include action ownership and priority/preemption, reflex hysteresis, navigation contracts, path recovery, stuck/progress detection, occupancy vs reservations, resource target scoring, verified skill result contracts, physical verification helpers, container/item transfer contracts, prerequisite planning, shelter/bed discovery, door/night-safety policy, construction-site accessibility, build verification, connection lifecycle, scan budgets, safe scaffolding, protected-block policy, failure handoff, event grouping, and a synthetic grid harness.


Agent 1 explicitly did NOT prove live Minecraft behavior. Remaining real-PC unknowns include Mineflayer keepalive vs Node event-loop vs Paper stalls, door/pathfinder behavior, collectblock pickup races, tool durability fields, minecraft-data version alignment, dynamic threat goals, real house/fence-gate interaction cells, village reachability, and installed plugin behavior. Pure/synthetic tests do not prove Minecraft behavior.


Agent 2 — cognition/brain work achieved

Agent 2 first created a cognition decision contract from an empty cloud repo, then correctly converted the useful ideas into a transplant-oriented kit instead of continuing the fake runtime.


The useful cognition direction now includes:

- bounded primaryGoal + followUpGoals enums instead of free-text jobs;

- JSON-schema structured outputs;

- fail-closed normalization and execution-level-command rejection;

- NO_LLM reflex boundaries;

- personal hunger / personal edible inventory / settlement reserve separation;

- relevant ExperienceLedger lesson retrieval rather than dumping all history;

- world-state staleness detection;

- fact vs interpretation separation;

- memory provenance (DIRECT / WITNESSED / HEARD / RECORDED / INFERRED);

- subjective local social beliefs instead of global reputation;

- appraisal, emotion, mood, confidence/familiarity, habits, associations, memory salience/retrieval/consolidation/decay, rumor handling, communication intent, promise/obligation contracts, decision explainability, and observer-safe cognition events.


Agent 2 already produced a first cognition transplant kit with 46 test vectors and concern-separated patches. A larger cognition-integration-kit-v2 plan was then prepared to extend the BRAIN layer further without touching runtime/pathfinding/Mineflayer. The continuation prompt reached the risk / subjective interpretation section before this chat ended.


Cloud-vs-home workflow locked in

CLOUD / WORK is for architecture, contracts, portable algorithms, tests, research audits, docs, patch generation, static analysis, and transplant preparation.


HOME PC is required for Paper, the real Minecraft world, the five Mineflayer citizens, manually built house/bed/steak fixtures, real Creeper flee verification, pathfinding through real terrain, keepalive diagnosis, Ollama structured-output checks, and RTX 4080 Super model benchmarking.


Do not treat cloud simulation or pure unit tests as proof of embodied Minecraft behavior.


Artifacts to preserve from Chat 1

- runtime-transplant-kit.zip

- runtime-integration-kit-v2.zip

- runtime-test-vectors.json / runtime-execution-vectors-v2.json

- cognition-decision-contract-v4.patch

- cognition-decision-contract-v4.bundle

- cognition-transplant-kit.zip

- later cognition-integration-kit-v2.zip when Agent 2 finishes it


Real GitHub repository remains canonical

https://github.com/ManpreetS2/minecraft-ai-civilization


Real feature branches at the time of this chat:

- main

- feat/persistent-memory-psychology

- feat/dashboard-observer-console


Do not merge reconstructed cloud branches wholesale. The cloud rebuilds were reference implementations created from an empty Initialize project because the agents could not authenticate to the private repo. Use the transplant kits as reference/test material and integrate only missing behavior into the real repo.


Next-session pickup point

1. Finish Agent 2's cognition-integration-kit-v2 work.

2. Preserve/download all cloud ZIPs/patches/bundles before ending cloud sessions.

3. On the home PC, pull the real repo and inspect latest branch state before merging anything.

4. Create/refresh the real integration branch from the actual repo history.

5. Integrate the two real feature branches semantically, preserving settlement/crafting/storage/project architecture and verified execution/directives/dashboard architecture.

6. Compare runtime-integration-kit-v2 and cognition-integration-kit-v2 against the real implementation; port tests and missing behavior only, never overwrite stronger existing modules wholesale.

7. Run full pnpm install/typecheck/lint/test/build.

8. Start Paper + Mineflayer + Ollama and run the controlled five-citizen fixture: 64 steak each, manually built house, beds, nearby village, Creeper test, directive test, path-failure/backoff test, construction-accessibility test, disconnect/body-death dev-respawn test.

9. Only after real-world evidence passes should broader civilization features resume.


End of CHAT 1 handoff.


CHAT 2 — AGENT 2 CONTINUATION AFTER PART 185


NOTE

This continuation is reconstructed from the recorded Chat 1 handoff. The exact old wording of Part 185 was not preserved, but the stop point was preserved: Agent 2 was extending cognition-integration-kit-v2 and had reached the risk / subjective-interpretation section. Continue from there without repeating Parts 1–185.


MASTER CONSTRAINTS FOR AGENT 2

- Stay inside the BRAIN layer: cognition, memory, psychology, structured decisions, model routing, ExperienceLedger use, cognition observability, benchmark fixtures, tests, contracts, and transplant packaging.

- Do NOT rewrite AgentManager, Mineflayer runtime, navigation, pathfinding, deterministic execution, dashboard runtime, or other BODY/HOW-layer systems owned by Agent 1.

- Do NOT create another fake standalone civilization app. Produce portable modules, tests, vectors, docs, and concern-separated patches that can be transplanted into the real repository later.

- The LLM decides WHAT. The deterministic runtime decides HOW. Minecraft verifies the physical result.

- Immediate lethal danger remains NO_LLM. Cognition may interpret remembered danger later, but it never replaces the deterministic emergency reflex.

- Keep objective world facts separate from citizen-specific interpretations.

- Never invent local Minecraft, Paper, Ollama GPU, VRAM, latency, or live-runtime results in the cloud workspace.

- qwen3.5:9b remains the routine default until real home-PC benchmarks justify changing it.


PART 186 — SUBJECTIVE RISK INTERPRETATION

Implement the distinction between objective danger and learned subjective risk.


Requirements:

- Objective immediate hazards come from authoritative world state and may trigger NO_LLM reflexes.

- Subjective risk belongs to the citizen and is derived from memories, associations, previous outcomes, confidence, familiarity, provenance, and current affect.

- Two citizens may assign different risk to the same non-immediate situation because their histories differ.

- Do not encode universal social rules such as “creeper seen = permanent fear” or “theft = trust -0.10.”

- Risk estimates must remain updateable. Repeated safe experiences should be able to weaken obsolete learned fear; repeated failures may strengthen caution.

- Generalization must be scoped. A bad event at one location should not automatically make the entire world dangerous.


Add deterministic tests proving that identical current facts can produce different subjective risk context when citizen histories differ.


PART 187 — RISK EVIDENCE AND CONFIDENCE

Add confidence and evidence tracking to subjective risk beliefs.


Requirements:

- Track the evidence supporting a learned risk belief.

- Preserve provenance such as DIRECT, WITNESSED, HEARD, RECORDED, and INFERRED.

- Direct verified experience should usually carry more evidential weight than rumor, without making provenance a magical truth score.

- Conflicting new evidence should update confidence rather than blindly overwrite the old belief.

- A single safe event must not instantly erase a strongly reinforced association.

- A single bad event must not create an irreversible permanent trait.


PART 188 — FACT VS. INTERPRETATION RECORDS

Create or strengthen a portable contract that explicitly separates verified facts from subjective interpretation.


Example:

Objective fact: Theo took 6 bread from a chest Atlas had been using; Atlas was hungry; Maya witnessed it; authorization was unknown.

Atlas interpretation: “Theo may not respect my needs.”

Maya interpretation: “Theo probably thought the food was communal.”


Requirements:

- Objective event payloads remain factual and provenance-aware.

- Citizen interpretations are stored separately and reference the underlying event/memory when possible.

- Multiple citizens can hold incompatible interpretations of the same event.

- Observer tooling may inspect both layers, but citizens must not gain access to a magical global truth beyond what they observed or learned.


PART 189 — LOCAL SOCIAL BELIEFS

Strengthen perspective-specific social beliefs.


Requirements:

- No global reputation variable available to citizens.

- Social beliefs are keyed from observer citizen -> subject citizen.

- Useful dimensions may include trust, affection, respect, resentment, familiarity, perceived reliability, or perceived threat, but they should be learned summaries rather than rigid personality scripts.

- Beliefs should record recent supporting evidence and uncertainty.

- A citizen should be able to say, in structured observer-safe form, why their view changed without exposing hidden chain-of-thought.


PART 190 — RUMOR AND HEARSAY PROPAGATION

Add portable rumor/hearsay contracts.


Requirements:

- HEARD information must preserve who told the citizen, what was claimed, and confidence/provenance.

- Rumor must not instantly become objective truth or shared world knowledge.

- Multiple retellings may lower certainty or introduce summarized/distorted wording while preserving a traceable source chain where available.

- Citizens may reject, accept, suspend judgment, or later revise a rumor based on direct evidence.

- Tests should include conflicting rumors about the same citizen/event.


PART 191 — APPRAISAL PIPELINE

Strengthen the event-appraisal pipeline.


Important appraisal dimensions can include:

- desirability

- goal impact

- loss magnitude

- threat

- controllability

- novelty

- responsibility

- social impact

- relationship relevance


Requirements:

- Appraisal is citizen-specific.

- Appraisal consumes factual event data plus that citizen's memories/state.

- Appraisal updates affective state and future decision context; it must not directly script a Minecraft action.

- Immediate survival reflexes remain outside this appraisal path.


PART 192 — EMOTION VS. MOOD TIMESCALES

Keep short-lived emotion separate from longer-lived mood.


Requirements:

- Event reactions may cause temporary fear, anger, gratitude, sadness, pride, joy, stress, or positive/negative valence.

- Mood changes more slowly through repeated experiences, safety, social support, achievement, repeated failure, or major loss.

- Add bounded decay/recovery behavior.

- Relationship relevance should modulate social emotional impact: loss of a close partner/friend should generally matter more than loss of a stranger, without hard-coding one exact numeric response for every citizen.

- Do not assign simulated psychiatric diagnoses.


PART 193 — CONFIDENCE, FAMILIARITY, AND LEARNED TENDENCIES

Extend experience-derived behavioral evidence.


Requirements:

- Repeated successful activities may increase familiarity and confidence.

- Repeated failure may increase caution or avoidance depending on context and interpretation.

- Learned tendencies should summarize observed patterns such as caution, curiosity, persistence, sociability, assertiveness, empathy, ambition, or preference for familiarity.

- These summaries are descriptive, not immutable personality causes.

- Do not initialize citizens with strong developer-authored personality archetypes.


PART 194 — HABITS AND ASSOCIATIONS

Implement portable habit/association logic.


Requirements:

- Experiences can create associations such as location -> unsafe, activity -> rewarding, entity type -> threat, coworker -> reliable.

- Associations need strength/confidence, evidence, update time, and decay/reversal behavior.

- Repeated safe counter-evidence must be capable of weakening old associations.

- Habits may affect goal scoring through familiarity or expected utility but must never directly execute physical actions.


PART 195 — MEMORY SALIENCE

Strengthen memory salience rules.


Requirements:

- Do not store every game tick as an important memory.

- Salience can consider novelty, goal impact, emotional intensity, social/relationship relevance, rarity, danger, achievement, loss, promise/obligation relevance, and long-term usefulness.

- Major events such as rescue, betrayal, death, major discovery, important construction completion, serious conflict, or institutional change should survive longer than trivial routine events.

- Salience remains separate from objective truth.


PART 196 — MEMORY RETRIEVAL SCORING

Create a compact deterministic retrieval scorer for cognition context.


Candidate factors:

- semantic/task relevance

- recency

- salience

- current goal relevance

- social-person relevance

- location/context cues

- active learned associations

- provenance/confidence


Requirements:

- Retrieve a small relevant set instead of dumping lifetime history.

- ExperienceLedger lessons should be retrieved separately and only when relevant to the current goal/failure context.

- Add tests proving unrelated dramatic memories do not always crowd out more relevant memories.


PART 197 — CONSOLIDATION, SUMMARIZATION, DECAY, AND FORGETTING

Add portable long-run memory maintenance behavior.


Requirements:

- Old low-value episodic memories may decay or be summarized.

- Important memories may be consolidated into semantic/social/cultural knowledge.

- The observer/admin raw event history may remain available even when a citizen forgets details.

- Citizens are allowed to forget, disagree, or misremember; they must not share a perfect global memory database.

- Consolidation must preserve provenance/uncertainty where practical.


PART 198 — PROMISES AND OBLIGATIONS

Add structured promise/obligation contracts.


Requirements:

- A promise exists only when backed by a meaningful interaction/event, not because flavor chat printed a sentence.

- Store promisor, recipient/group, promise content, creation event, expected condition/time when applicable, status, and evidence of fulfillment/breach/uncertainty.

- Fulfillment should ultimately depend on verified world/runtime outcomes supplied later by the integration layer.

- Cognition can consider obligations when selecting goals, but obligations do not bypass the verified execution system.


PART 199 — STRUCTURED SOCIAL INTENTS

Finalize structured communication intent contracts.


At minimum support bounded intents such as:

- request_help

- offer_resource

- warn_danger

- coordinate_project

- share_discovery


Requirements:

- Routine work should usually remain silent.

- Communication should happen because information/coordination has value.

- Social intent should include target/audience, purpose, relevant factual payload, urgency, and optional referenced event/resource/project.

- Do not claim cooperation until real participants actually performed coordinated work.

- Do not claim sharing until a real resource transfer occurred.


PART 200 — DECISION EXPLAINABILITY WITHOUT CHAIN-OF-THOUGHT

Create observer-safe explanations for cognition decisions.


Requirements:

- Never expose or depend on hidden chain-of-thought.

- Record concise inspectable factors such as current needs, retrieved memories, relevant lessons, relationship context, subjective risk, mood/affect, obligations, settlement need, candidate goals, and final validated high-level goal.

- Allow the observer to answer questions like “Why did Atlas choose gathering instead of exploring?” using structured factors/evidence.

- The explanation should distinguish authoritative facts from citizen interpretation.


PART 201 — OBSERVER-SAFE COGNITION EVENTS

Create structured cognition events suitable for the dashboard later.


Useful event families:

- cognition_requested

- cognition_decision_validated

- cognition_fallback_used

- cognition_rejected

- memory_retrieved

- lesson_retrieved

- appraisal_updated

- social_belief_updated

- rumor_received

- promise_created_or_updated

- reflection_applied


Requirements:

- Include citizen ID/name where supplied, timestamps, safe summaries, referenced evidence IDs, model/provider metadata where applicable, and failure category.

- Do not expose hidden chain-of-thought or giant raw prompts by default.


PART 202 — WORLD-STATE STALENESS GUARDS

Strengthen stale-context handling.


Requirements:

- Cognition inputs should carry observation/snapshot timestamps or versions.

- A delayed LLM result must be rejectable if the authoritative world state changed enough to invalidate it.

- Stale high-level intent should produce a structured retry/reconsider result, not blindly execute old assumptions.

- Immediate reflexes and runtime verification remain authoritative over stale cognition.


PART 203 — MODEL ROUTER BOUNDARIES

Finalize portable model-routing behavior.


Requirements:

- qwen3.5:9b remains the routine local baseline.

- Rare deep reflection may target a heavier model only through a configurable provider/router abstraction.

- Do not change defaults using invented cloud benchmarks.

- JSON-Schema-constrained structured output is the primary path.

- Compatibility normalization may repair trivial known formatting variants, numeric strings, capitalization, or surrounding text when safe.

- Unknown goals, compound movement instructions, unsupported fields, or execution-level commands must fail closed.


PART 204 — ADVERSARIAL AND REGRESSION TEST VECTORS

Expand cognition-integration-kit-v2 test vectors substantially.


Include cases for:

- citizen has food personally while settlement storage is empty

- personal hunger high vs settlement food shortage

- immediate Creeper danger -> NO_LLM

- remembered Creeper loss without immediate threat -> subjective risk context only

- repeated safe evidence weakens learned fear

- conflicting direct vs heard social evidence

- two citizens interpret the same event differently

- rumor with uncertain source chain

- promise created, fulfilled, breached, and unresolved

- unrelated memories excluded from retrieval

- relevant ExperienceLedger failure lesson retrieved

- stale cognition result rejected

- compound free-text goal rejected or safely normalized only when unambiguous

- movement-level command rejected

- observer explanation contains factors but no chain-of-thought


Keep all tests deterministic where possible. Seed any controlled randomness.


PART 205 — PROPERTY / FUZZ INVARIANTS FOR THE BRAIN LAYER

Add seeded property-style tests for core invariants.


Examples:

- valid bounded goal enums never mutate into execution-level instructions

- NO_LLM hazard classification cannot be overridden by ordinary deliberation output

- objective fact records are not mutated by subjective interpretation updates

- one citizen's local social belief cannot silently mutate another citizen's belief

- rumor provenance never becomes DIRECT without a direct event

- memory retrieval stays within configured limits

- confidence/salience values remain bounded

- stale decisions do not pass freshness validation

- model normalization never accepts arbitrary unknown goals

- observer-safe events do not contain hidden reasoning fields


PART 206 — FAILURE INJECTION FOR COGNITION

Create named failure scenarios for the portable cognition kit.


Include:

- malformed JSON

- valid JSON with unknown goal

- valid enum plus illegal movement instruction

- model timeout

- provider unavailable

- stale world snapshot

- missing memory provider

- malformed memory record

- ExperienceLedger unavailable

- contradictory rumor records

- corrupted optional psychology state

- deep-reflection provider unavailable


Each scenario must have an explicit safe fallback or fail-closed result.


PART 207 — COGNITION INTEGRATION CONTRACT

Create or finalize docs/COGNITION-INTEGRATION-CONTRACT.md.


Document clearly:

- runtime inputs CognitionService requires

- optional inputs

- authoritative vs subjective fields

- personal hunger / personal edible inventory / settlement reserve separation

- world snapshot timestamp/version expectations

- CognitionService output schema

- primaryGoal + followUpGoals contract

- structured social-intent output contract

- validation and normalization behavior

- NO_LLM conditions

- stale-result behavior

- memory retrieval interface

- ExperienceLedger interface

- psychology/appraisal interface

- observer-safe events

- model-router/provider configuration

- expected runtime handoff points

- fields Agent 1/runtime must verify before execution


PART 208 — TRANSPLANT MAP

Create a concise transplant map describing where each portable BRAIN concern should connect to the real repository later.


Requirements:

- Map modules/interfaces to the real feat/persistent-memory-psychology branch concepts when known.

- Identify likely conflict zones but do not edit Agent 1-owned runtime files.

- Classify each artifact as ADD, ADAPT, TEST-ONLY, DOC-ONLY, or ALREADY-PRESENT/COMPARE-FIRST.

- Never recommend overwriting a stronger real module wholesale.


PART 209 — CONCERN-SEPARATED PATCH SET

Generate concern-separated patches/bundles so the real integration owner can apply or inspect them independently.


Suggested patch groups:

1. subjective risk + fact/interpretation

2. local social beliefs + rumor provenance

3. appraisal + emotion/mood

4. confidence/familiarity + habits/associations

5. memory salience/retrieval/consolidation

6. promises/obligations + communication intents

7. cognition explainability + observer-safe events

8. staleness + model router/structured validation

9. regression/property/failure tests

10. docs + integration contract + transplant map


PART 210 — BUILD cognition-integration-kit-v2.zip

Produce the final portable Agent 2 artifact without replacing the earlier cognition-transplant-kit.zip.


The ZIP should contain, at minimum:

- portable source modules

- all new/updated tests

- cognition test vectors in machine-readable form

- seeded property/fuzz fixtures

- failure-injection scenarios

- docs/COGNITION-INTEGRATION-CONTRACT.md

- transplant map / manifest

- concern-separated patches

- README with exact scope and limitations

- a machine-readable manifest of files and checks


PART 211 — FINAL AUTOMATED CHECKS

Run every check available in the isolated cognition workspace, including as applicable:

- install

- typecheck

- lint

- unit tests

- property/fuzz tests

- vector validation

- build/package checks


Report exact pass/fail counts. Fix failures before declaring the kit ready.


Do NOT claim:

- Paper was tested

- Mineflayer was tested live

- pathfinding was tested live

- Ollama GPU latency/VRAM was measured

- five citizens ran successfully

unless those things actually happened on the home PC.


PART 212 — FINAL HANDOFF REPORT AND STOP

Return a concise final handoff containing:

- exact files/modules added

- exact test/vector/property/failure counts

- automated checks and results

- cognition-integration-kit-v2.zip location

- patch/bundle locations

- the integration contract location

- known limitations

- items requiring home-PC verification

- any decisions the real integration owner must make


Then STOP. Do not begin merging the real feature branches. Do not rewrite runtime/navigation. Do not continue into broader civilization features.


AFTER AGENT 2 FINISHES

The next project step is not another cognition expansion. Preserve/download cognition-integration-kit-v2.zip and all patches/bundles. Then return to the real GitHub repo on the home PC, create/refresh integration/first-settlement-v2 from actual history, semantically integrate the two real feature branches, compare both transplant kits against the integrated implementation, port missing behavior/tests only, run full pnpm install/typecheck/lint/test/build, and finally perform the real controlled five-citizen Paper + Mineflayer + Ollama fixture.


## RUNTIME SIMPLIFICATION & DEVELOPMENT RULES


### WHY THIS FEELS COMPLICATED

The project combines three hard problems: AI cognition, Minecraft robotics, and civilization simulation. We should not solve all three from scratch. The goal is to reuse mature Minecraft infrastructure and keep our custom code focused on civilization behavior, reliability, memory, and coordination.


### WHICH MODEL IS DOING WHAT

• Minecraft citizen brain: qwen3.5:9b is the current routine cognition target when the real simulation runs on the home PC.

• Cursor Cloud coding agent: this is separate from the Minecraft brain. Do not assume it is running Qwen; check the Cursor run metadata/model selector for the coding model used by that cloud job.

• Cloud work must not invent local Ollama, GPU, Paper, Mineflayer, latency, or VRAM results.


### KEEP THE REPO PRIVATE

Making the repository public is not a fix for pathfinding or runtime bugs. Keep the repo private unless there is a separate reason to open-source it. Cloud agents should work against the actual authenticated private repository, not rebuild the project from an empty workspace.


### STOP REINVENTING BASIC MINECRAFT MECHANICS

Prefer mature libraries for generic Minecraft behavior:

• mineflayer-pathfinder — navigation, goals, jumping, swimming, obstacle handling

• mineflayer-collectblock — move to a block, mine it, collect the drop

• mineflayer-tool — choose/equip appropriate tools

• minecraft-data / prismarine-block — recipes, items, blocks, harvest/tool facts


Our code should WRAP these libraries instead of replacing them.


### WHAT SHOULD STAY CUSTOM

• task ownership, suspension, resumption, and preemption

• hazard avoidance and Creeper backoff

• reservations so citizens do not target the same block/location

• unreachable-target blacklists and retry policy

• settlement-safe movement rules

• action verification against the real world

• failure classification and learning

• persistent identity, memory, psychology, relationships, and social interpretation

• multi-citizen coordination and civilization systems


### TARGET CONTROL FLOW

Citizen brain (WHAT)

→ validated high-level goal

→ deterministic task/prerequisite planner

→ proven Minecraft libraries (HOW)

→ our reliability/safety wrapper

→ real Minecraft action

→ world verification

→ memory / learning


### CLOUD VS HOME PC

Cloud / Cursor:

• contracts, algorithms, tests, docs, patches, static analysis, transplant kits


Home PC:

• Paper server

• real Minecraft world

• Mineflayer citizens

• pathfinding and interaction tests

• Creeper flee verification

• bed/house/door/fence behavior

• Ollama structured-output and RTX 4080 Super benchmarks


### NEXT CLEANUP STEP

After cognition-integration-kit-v2 finishes, do a runtime dependency audit before adding more systems. For every major runtime component, classify it as:

• KEEP — custom logic that is civilization-specific and already strong

• REPLACE — custom code that duplicates a mature Minecraft library

• WRAP — keep our safety/verification layer around a proven library

• DELETE — redundant or obsolete code


Immediate runtime bug after the cognition job: fix Creeper task-thrashing with hazard persistence, hysteresis, suspended tasks, escape-position reservations, and destination revalidation before resuming work.


Engineering rule: do not respond to physical movement failures by making the LLM explain movement in more detail. Improve the deterministic body/tool/navigation layer and keep cognition high-level


UPSTREAM MINECRAFT BODY-LAYER ACCELERATORS — 2026-09-17


The current screenshots show that the project can already craft and place functional blocks, but placement and task semantics are still weak: beds can appear outdoors, doors can be placed without a real doorway, and workstations can be scattered without a coherent worksite. The fastest path is to reuse mature Minecraft execution infrastructure instead of continuing to hand-build generic mechanics.


USE / ADAPT NOW


MINDcraft — https://github.com/mindcraft-bots/mindcraft

Use as a primary Mineflayer mechanics reference. Audit its bounded skills, world helpers, crafting, item goals, build goals, combat, smelting, and multi-agent execution patterns. Reuse mechanics and architecture where licensing permits, but do not adopt open-ended arbitrary code execution. Preserve our civilization-specific cognition, memory, psychology, relationships, settlement state, and verified action contracts.


Phoenix — https://github.com/CybersharpX/Phoenix

Use as a deterministic task-engine reference. Study its WorldModel, task trees, planner, executor, recovery system, inventory manager, crafting manager, navigation, survival, recursive obtain-item behavior, cancellation, timeouts, and failure recovery. The important lesson is hierarchical deterministic task execution beneath high-level cognition.


mineflayer-collectblock — https://github.com/PrismarineJS/mineflayer-collectblock

Evaluate as the low-level gather/mining helper. It can cover path-to-target, tool selection, digging, drop collection, and queued collection. Wrap it with our claims, reservations, protected-block rules, cancellation, verification, and ExperienceLedger classification rather than exposing it directly.


mineflayer-tool — https://github.com/PrismarineJS/mineflayer-tool

Use/evaluate for choosing and equipping the right harvesting tool instead of maintaining duplicate custom tool-ranking logic.


mineflayer-auto-eat — https://github.com/linkle69/mineflayer-auto-eat

Use/evaluate for the physical eating mechanics only. Our survival planner still decides WHEN eating is appropriate; the plugin can help with HOW to execute food selection/eating reliably.


minecraft-data + prismarine-block — https://github.com/PrismarineJS/minecraft-data and https://github.com/PrismarineJS/prismarine-block

Keep these as the authoritative version-aware mechanics substrate for recipes, items, blocks, entity IDs, food data, harvestability, tool requirements, and related static facts. Do not make the LLM memorize deterministic Minecraft rules.


DEVELOPMENT / TEST HARNESS CANDIDATE


Minecraft MCP Server — research the current 1.21.11-compatible Mineflayer MCP implementations, including https://github.com/yuniko-software/minecraft-mcp-server and https://github.com/AhmadTariq1337/minecraft-mcp-server . Do not make production citizens depend on MCP. Evaluate it as a developer test harness so Cursor can issue bounded live interactions through a probe/test bot when debugging crafting, doors, containers, placement, mining, furnaces, and entity interaction.


REFERENCE ONLY — DO NOT INSTALL AS THE MAIN RUNTIME


MineMind — https://github.com/Boyan253/minemind

Different stack/version, so use only as architecture reference. Relevant pattern: LLM chooses WHAT, deterministic mechanics decide HOW; recursive recipe resolution; physical verification; failed-target suppression; replanning.


AltoClef — https://github.com/gaucho-matrero/altoclef

Older Fabric-based automation project. Use as reference for nested tasks, priority chains, survival preemption, unreachable-target handling, and long-running obtain-item task decomposition. Do not migrate the Paper/Mineflayer project to Fabric just to use it.


PLACEMENT POLICY REQUIRED ABOVE ALL UPSTREAM HELPERS


Do not blindly inherit any upstream behavior that places a functional block in the nearest free space. Functional blocks need semantic intent:

- Bed -> valid shelter/interior sleeping location.

- Door -> actual doorway/entrance geometry.

- Chest -> registered storage/worksite context.

- Crafting table -> registered or explicitly temporary worksite; reuse existing valid tables first.

- Furnace -> registered or explicitly temporary worksite.

Temporary workstations should be tracked and cleaned up. The desired control flow is: need function -> choose legitimate site -> validate geometry/reachability -> place -> verify -> register purpose.


TARGET BODY ARCHITECTURE


Cognition chooses WHAT.

Deterministic task engine decomposes the goal.

MinecraftKnowledge supplies rules and prerequisites.

Proven Mineflayer libraries perform generic physical mechanics.

Our safety/reliability wrapper enforces claims, protection, retries, cancellation, purpose, and observability.

Minecraft world verification proves success.

ExperienceLedger classifies the result.

Memory/psychology only learn from valid experience.


Adoption rule: reuse game mechanics and task-execution infrastructure; keep the civilization model custom.

.


## MULTI-PROVIDER FREE LLM MODEL LEASING


### PURPOSE

The civilization should not require one permanently loaded language model per citizen. Persistent identity, memories, relationships, mood, beliefs, goals, obligations, and history remain in our database. The currently assigned LLM is only a temporary reasoning engine used for meaningful cognition calls.


FreeLLMAPI was identified as a candidate multi-provider router. At the time of research it advertised hundreds of free model endpoints (635 was the observed figure), but this number, provider availability, quotas, and model lists are external and can change. Treat the service as an optional experimental inference pool, not as a guaranteed permanent dependency.


### MODEL LEASE CONCEPT

Each physically or cognitively active citizen may hold a temporary model lease containing fields such as citizenId, provider, model, assignedAt, lastSuccess, request/error counters, cooldown/rate-limit state, and fallback order.


Example:

Atlas -> active free model A

Maya -> active free model B

Theo -> active free model C

Ava -> active free model D

Kai -> active free model E


The lease should normally remain sticky for a period of time so a citizen is not routed to a different model every call without reason. The citizen identity does not live inside the model, so replacing the leased model must not create a new citizen.


### FAILOVER

When the active provider/model becomes unavailable, rate-limited, quota-exhausted, repeatedly invalid, or too slow, release or cool down that lease and route the next cognition request to another compatible model.


Desired flow:

citizen -> leased free model -> alternate free model(s) -> local Ollama fallback


A model failover must NOT disconnect the Minecraft body. Atlas remains Atlas; only the inference backend for later cognition calls changes.


### LOCAL OLLAMA REMAINS THE SAFETY NET

The existing local Ollama route remains available even if every external free provider fails. Routine physical behavior, emergency reflexes, movement, crafting, mining, combat, farming, and verified task execution must continue without cloud inference.


The free-provider pool is therefore an optimization for meaningful deliberation, not a requirement for basic survival.


### ONE ROUTER ENDPOINT DOES NOT MEAN ONE MAGIC FREE PROVIDER KEY

The project may expose one OpenAI-compatible endpoint/key internally, but external providers may still require their own accounts, API keys, eligibility, and provider-specific quotas. Multiple keys do not necessarily multiply quota when a provider limits usage at the account or project level.


Never assume that hundreds of listed endpoints means unlimited free inference.


### CITIZEN CONTEXT HANDOFF

Do not depend on provider chat-session history for citizen continuity. Our CognitionContextBuilder should construct the compact citizen context for every call from authoritative persistent state:

- current needs and verified world facts

- current high-level goals

- relevant memories

- relationships and obligations

- mood/affect and learned tendencies

- subjective risk

- settlement context

- relevant ExperienceLedger lessons


This makes switching models safe because the new model receives the same citizen state.


### MODEL DIFFERENCES MUST NOT BECOME HARDCODED PERSONALITY

Different model families may naturally produce slightly different reasoning styles. This may create useful behavioral diversity, but model assignment itself must not become the citizen's permanent personality.


Personality and behavioral tendencies should continue to emerge from the citizen's own decisions, experiences, memories, relationships, confidence, habits, and history.


### ROUTING QUALITY GUARDS

Every provider/model must pass the same bounded cognition contract:

- JSON-schema/structured output

- allowed high-level goal enums only

- no raw movement commands

- no arbitrary code execution

- no invented inventory/world facts

- stale-world-state rejection

- fact/interpretation separation

- safe timeout and malformed-output handling


A model that repeatedly violates the contract should be cooled down or removed from the eligible lease pool.


### PROVIDER OBSERVABILITY

Record observer-safe inference metadata:

- citizen

- provider

- model

- latency

- validation success/failure

- fallback count

- rate-limit/quota/error category

- lease changes


Never log provider API keys.


### ROUTING POLICY

Initial recommendation:

1. Keep LLM_INFERENCE_ROUTE=LOCAL as the stable default while the body engine is still being stabilized.

2. Add the free multi-provider pool behind an explicit experimental route.

3. Benchmark candidate free models against our cognition fixtures.

4. Only allow models that meet minimum schema/factual-quality requirements into the citizen lease pool.

5. Use sticky per-citizen leases with automatic failover rather than random model selection every request.

6. Fall back to qwen3.5:9b through local Ollama when the external pool cannot serve a valid response.


### COMPUTE STRATEGY

Do not waste free inference on deterministic Minecraft mechanics. Language-model calls should remain reserved for meaningful high-level decisions, social interpretation, reflection, goal selection, institutional/cultural decisions, and other genuinely cognitive moments.


This allows a relatively small amount of free-provider quota to support many persistent citizens because most Minecraft actions remain deterministic.


### SCALING IDEA

At five citizens, each citizen can have a different active model lease if enough compatible providers are available. At larger populations, only currently deliberating citizens need an active lease. A 100-citizen civilization does not need 100 simultaneous provider sessions or 100 permanent models.


### MODEL LEASE MANAGER — PROPOSED COMPONENT

Future implementation may add a ModelLeaseManager above the existing ModelRouter.


Responsibilities:

- maintain eligible model/provider pool

- assign sticky leases

- track cooldowns and failures

- rotate on quota/rate-limit/provider outage

- preserve per-citizen continuity through our own context builder

- route to local Ollama when external routes fail

- expose metrics to the dashboard


This component must not own citizen identity, memory, psychology, or goals.


### SAFETY / RELIABILITY RULE

FreeLLMAPI or any similar router is replaceable infrastructure. The civilization must remain runnable if the router disappears completely. The durable architecture is our provider abstraction + persistent citizen state + deterministic Minecraft body + local fallback.


## CITIZEN-CONTROLLED AGENT ARCHITECTURE — TARGET MODEL


### THIS SUPERSEDES A SIMPLE “CENTRAL AI GIVES NPC COMMANDS” INTERPRETATION

The intended simulation is not one manager AI assigning jobs to obedient Minecraft bots. Each citizen is its own persistent autonomous AI agent. Atlas, Maya, Theo, Ava, Kai, and future citizens each maintain an independent mind-state and independently decide what to care about, what to do, who to trust, what to avoid, what to say, and when to change course.


The deterministic body engine is not the citizen’s boss. It is the citizen’s motor system. The citizen AI forms intentions; the body engine turns those intentions into reliable Minecraft actions.


Conceptual loop:

PERCEIVE -> INTERPRET -> FEEL / APPRAISE -> REMEMBER -> DELIBERATE -> CHOOSE INTENTION -> ACT THROUGH BODY -> OBSERVE RESULT -> UPDATE SELF


Each citizen runs this loop independently.


### PERSISTENT PERSON VS TEMPORARY MODEL

A citizen is not identical to whichever LLM is currently serving inference. The persistent person is the durable combination of:

- identity

- autobiographical memories

- relationships and beliefs about specific others

- current needs and goals

- mood / emotional state

- values and expressed beliefs

- habits and learned tendencies

- obligations and promises

- fears / safety associations

- confidence and familiarity

- current projects and commitments

- subjective interpretation of past events


The leased model is temporary cognitive compute. If a provider/model changes, the same citizen continues from the same persistent mental state.


### ONE ACTIVE AI MIND PER ACTIVE CITIZEN

When a citizen is actively deliberating, route cognition as that citizen’s own agent, not as a shared manager choosing actions for everybody.


Example:

Atlas Mind -> Atlas model lease -> Atlas intention -> Atlas body

Maya Mind -> Maya model lease -> Maya intention -> Maya body

Theo Mind -> Theo model lease -> Theo intention -> Theo body


A settlement may expose shared facts such as food shortage, danger, unfinished wall, or available jobs, but those are observations/opportunities, not commands. Different citizens may react differently, ignore them, argue about them, or pursue competing priorities.


### HUMAN-LIKE COGNITION GOAL

The target is human-like decision behavior, not literal human consciousness and not a perfect rational optimizer.


Citizens should behave as bounded, situated agents with incomplete information. They should often act from:

- immediate perception

- remembered experience

- current emotion / mood

- personal goals

- relationships

- habits

- social expectations

- promises

- risk perception

- uncertainty

- limited attention

- recent salient events

- practical constraints


They should not behave as omniscient database queries with perfect knowledge of the whole world.


### PERCEPTION BEFORE DECISION

A citizen should reason from what that citizen could reasonably know.


Inputs may include:

- nearby blocks/entities/items

- carried inventory

- current health/hunger

- weather/time

- recently visited locations

- remembered structures/resources

- messages heard from others

- known relationships

- personally observed settlement conditions

- trusted or distrusted reports from others


Do not silently inject global truth into personal cognition unless the mechanic is intentionally universal.


### APPRAISAL AND EMOTION

Meaningful events should be appraised relative to the individual.


The same event may affect citizens differently.


Examples:

A Creeper explosion may produce strong fear in one citizen, anger in another, and relatively little reaction in a citizen with repeated successful encounters.

A gift may increase warmth/trust if interpreted as generous, or suspicion if the relationship is poor.

A failed promise may matter greatly when trust was high and barely matter when trust was already low.


Use:

event -> personal appraisal -> immediate emotion -> slower mood influence -> memory salience -> behavioral effect


Emotion should influence decisions without becoming a fixed scripted reaction table.


### MEMORY SHOULD BE SELECTIVE, NOT PERFECT

Humans do not retain every event equally.


Store high-salience autobiographical memories and useful summaries rather than an infinite perfect replay of every tick.


Memory relevance should depend on factors such as:

- recency

- emotional intensity

- personal importance

- relationship relevance

- goal relevance

- repetition

- threat/safety association


A citizen may forget minor details while retaining important lessons or impressions.


### RELATIONSHIPS ARE OBSERVER-SPECIFIC

There is no magical universal reputation score.


Atlas can trust Maya while Theo distrusts Maya.


Pairwise beliefs may include:

- familiarity

- trust

- affection

- resentment

- fear

- obligation

- admiration

- reliability estimate

- confidence in those beliefs


These values should emerge from interactions and interpretations rather than being assigned as static personalities.


### PERSONALITY SHOULD EMERGE FROM HISTORY

Do not assign simplistic permanent labels such as “Atlas is brave” and force every future decision to match.


Instead infer tendencies from repeated behavior:

- often helps others

- avoids caves after repeated danger

- takes initiative on construction

- prefers working alone

- keeps promises

- becomes cautious around skeletons

- frequently seeks company


These inferred tendencies can feed future cognition while remaining changeable.


### GOALS, DESIRES, AND COMMITMENTS

Citizens should support multiple simultaneous motives.


Examples:

- satisfy hunger

- finish own house

- help a friend

- avoid a dangerous region

- gather iron

- repay a debt

- rest

- investigate something unusual

- improve settlement defenses

- spend time with someone

- protect personal possessions

- pursue a longer-term project


The agent should choose among competing motives rather than following a fixed global job queue.


### ROUTINE ACTION VS DELIBERATION

Human-like control does not mean sending every footstep to an LLM.


Once a citizen decides:

“I am going to mine stone for the wall,”


the body may continue routine pathing/mining deterministically until something meaningful changes.


Re-deliberate on meaningful triggers such as:

- goal completed

- important resource discovered

- tool breaks / nearly breaks

- hunger becomes important

- threat appears

- another citizen speaks or asks for help

- unexpected failure

- route becomes impossible

- meaningful relationship event

- major environmental change

- new opportunity

- prolonged task boredom/fatigue if such systems are modeled

- citizen voluntarily reconsiders


This preserves genuine agent control without wasting inference on every motor action.


### REFLEXES ARE NOT A CENTRAL MANAGER

Urgent reflexes may bypass deliberation temporarily:

- drowning

- fire

- imminent lethal threat

- very close Creeper

- critical health

- emergency food use when starvation is imminent and food is already carried


These are analogous to protective reflexes. After the emergency, the citizen AI resumes control and interprets what happened.


### SOCIAL AUTONOMY

Citizens may:

- initiate conversation

- refuse requests

- negotiate

- cooperate

- compete

- form friendships

- form rivalries

- make promises

- break promises

- share resources

- withhold resources

- ask for help

- join or leave groups

- propose projects

- disagree about priorities


Do not force consensus merely because the settlement planner sees a need.


### SETTLEMENT STATE IS INFORMATION, NOT ORDERS

The settlement system may expose:

- food reserve low

- housing shortage

- wall incomplete

- iron stock low

- danger near road

- available communal chest

- active building project


A citizen may decide to respond, defer, ignore, delegate, argue, or pursue something else.


This is critical for emergent civilization.


### DECISION OUTPUT SHOULD BE BOUNDED, NOT SCRIPTED

The citizen AI should have freedom at the intention level while remaining inside safe action interfaces.


Example high-level output:

- intention

- target / subject if known

- urgency

- short observable reason

- optional message / social act

- expected completion condition


Do not expose arbitrary shell, filesystem, network, code execution, raw SQL, or unrestricted Mineflayer calls to citizen models.


### NO HIDDEN CHAIN-OF-THOUGHT STORAGE REQUIREMENT

Do not require or store private step-by-step model reasoning as the citizen’s “mind.”


Persist structured state, memories, appraisals, goals, decisions, and concise decision reasons that are useful to the simulation.


The system should be explainable without pretending that a generated hidden monologue is ground-truth consciousness.


### HUMAN-LIKE IMPERFECTION

Citizens should not always make the globally optimal move.


Permitted sources of realistic imperfection include:

- incomplete information

- uncertain beliefs

- competing goals

- mood

- habit

- familiarity

- social loyalty

- recent experiences

- limited attention

- bounded planning horizon

- small tie-breaking randomness


Avoid artificial stupidity. Mistakes should arise from believable limitations, not broken mechanics.


### MODEL LEASES UNDER THIS ARCHITECTURE

The ModelLeaseManager supports each citizen’s independent mind.


A typical active citizen loop:

CitizenMind -> retrieve relevant personal context -> leased model -> validate bounded decision -> body executes -> verified outcome -> CitizenMind updates


If the leased free model fails:

CitizenMind -> another compatible model -> same context -> same citizen continues


If external providers fail:

CitizenMind -> local Ollama


The Minecraft body remains connected throughout model rotation.


### SCALING TO MANY CITIZENS

A logical mind exists for every persistent citizen, but not every citizen must consume an LLM continuously.


Citizens doing routine work can continue established intentions deterministically.

Citizens who are sleeping, distant, or low-detail can update less frequently.

Citizens involved in important social, dangerous, novel, or strategic situations receive more cognition.


This allows the simulation to preserve individual agency while scaling toward the 100-living-citizen cap.


### TARGET EXPERIENCE

The desired result should feel like:

“Atlas decided to do this because of what Atlas knows, remembers, feels, wants, and believes.”


Not:

“The settlement manager assigned Atlas task #42.”


The body engine exists to make Atlas capable of carrying out his own intentions reliably in Minecraft.


## ACTIVE MINECRAFT BODY STRATEGY — COPY A WORKING BODY FIRST


### CURRENT PRIORITY

The current priority is the Minecraft BODY, not personality or civilization logic. We want a premade runtime that can already expose Minecraft perception to an AI, accept high-level actions, and physically play the game reliably.


The project is explicitly allowed to copy/fork an existing open-source implementation instead of rebuilding low-level mechanics.


### CO-PRIMARY BODY CANDIDATE: MINECRAFT-FOR-ASTRA

Repository:

https://github.com/teletemagame-dev/minecraft-for-astra


This remains a co-primary body/runtime candidate to test alongside Mindcraft.


Why it fits the project:

- Astra is treated as the brain.

- The Minecraft integration is treated as the body.

- The body exposes structured Minecraft state instead of forcing the AI to reason from pixels.

- The AI receives perception/status, decides what to do, then calls bounded Minecraft tools.

- The body already exposes actions such as navigation, collection, digging, placement, crafting, smelting, equipping, dropping, giving, chest use, attacking, defending, eating, sleeping, and speaking.

- It also exposes reactive events such as damage, low health, death, spawn, disconnect, and chat.

- The researched version reports support through Minecraft 1.21.11.

- License observed during research: MIT.


This is much closer to our target architecture than a monolithic autonomous swarm tuned to somebody else's world.


### TARGET FLOW

Minecraft world

-> body/perception

-> structured status

-> citizen AI

-> bounded intention/tool call

-> body executes

-> verified world result

-> updated perception


### BODY AS SENSES

The body should provide facts such as:

- position and facing

- health, hunger, air

- time/weather/biome

- inventory/equipment

- nearby players/citizens

- nearby mobs

- nearby relevant blocks/features

- current action

- recent damage/events

- task/action failures


The AI should not receive raw world omniscience.


The status layer is refined by the LOCKED PERCEPTION & SENSORY CONTRACT later in this document, including line-of-sight, coordinates, 360-degree orientation-aware vision, sound, uncertainty, motion, memory rules, and citizen-specific knowledge.


### BODY AS ACTION INTERFACE

The AI should choose intentions and call bounded body capabilities.


Examples:

- go to a target

- collect wood

- dig a visible block

- craft an item

- smelt

- equip

- open/use chest

- give/drop items

- attack/defend

- eat

- sleep

- say something


Do not expose unrestricted shell, filesystem, arbitrary code execution, or raw server control to the citizen AI.


### REFLEX LAYER

minecraft-for-astra is especially relevant because its architecture keeps a small fast-reflex layer for situations where LLM latency is too slow.


Desired reflex examples:

- escape lava / drowning

- emergency eating

- immediate close-range self-defense

- very close Creeper -> move away


These reflexes protect the body. They do not become the citizen's personality or long-term decision-maker.


### HOSTILE MOB POLICY

Hostile does NOT automatically mean flee.


Normal combat situations should be surfaced to the AI with:

- mob type

- exact target ID / coordinates for execution

- relative direction

- distance

- visibility / line of sight

- whether it is approaching/targeting the citizen

- citizen health

- armor / weapon state

- nearby allies

- cover / escape possibilities if known


The AI may choose:

fight

retreat

hide

avoid

ask for help

help another citizen

ignore and continue


Only immediate lethal situations use reflex behavior.


### NAVIGATION / PATCHED-GOTO

The researched minecraft-for-astra body references AIRI-derived patched navigation behavior.


The important design idea is progress-aware navigation:

- moving toward goal counts as progress

- intentional mining/building for the route can count as progress

- standing stuck does not

- navigation must eventually resolve success/failure rather than hanging forever


This directly matches the reliability problems exposed by MechProbe and the swarm candidate.


TEST THIS LIVE BEFORE TRUSTING IT.


### FAILURE FEEDBACK TO THE AI

Body failures should be actionable, not vague booleans.


Example:

MISSING_RESOURCE:

cannot craft wooden_pickaxe

missing oak_planks and sticks


The AI can then choose what to obtain next.


This is preferable to fake success or generic "failed" responses.


### FIRST TEST PLAN

minecraft-for-astra has already been cloned separately; its installation and real Minecraft live body tests are still pending. Keep it isolated from the active Mindcraft test and from the civilization project.


Do NOT integrate our civilization repo first.


Run the body's existing live tests against a real Minecraft server.


Test the same body tools the AI would call:

- status/perception

- goto

- collect wood

- dig

- craft

- smelt

- equip

- chest

- drop

- give

- attack

- defend

- eat

- sleep


Watch the body physically in Minecraft.


Do not integrate a body that has not passed a small real-Minecraft visual/behavioral gate. Then prioritize five individual persistent minds in the starter village rather than endlessly expanding body skills.


### ACCEPTANCE

We should be able to issue body-level commands with no AI personality involved and visibly observe:

- competent movement

- resource collection

- crafting

- inventory use

- combat

- food use

- sleep

- storage

- item transfer


If the body cannot do these reliably, reject it quickly.


### SECONDARY SOURCE / ARCHITECTURE: PROJECT AIRI

Repository:

https://github.com/moeru-ai/airi


AIRI is the larger open-source AI companion project whose Minecraft work is relevant to this body strategy.


Its Minecraft architecture is valuable because it cleanly separates:

- perception

- fast reflexes

- conscious/LLM reasoning

- action/task execution


That architecture strongly matches our intended design.


Relevant upstream ecosystem/components include mature Minecraft libraries such as:

- mineflayer

- mineflayer-pathfinder

- mineflayer-tool

- mineflayer-collectblock

- mineflayer-pvp

- mineflayer-auto-eat

- minecraft-data

- prismarine-block


Do not automatically copy every dependency. Use the proven body/runtime as a whole first, then only customize where necessary.


### AIRI FABRIC DIRECTION

Research noted that AIRI's Mineflayer Minecraft service is on a deprecation path and the project intends to move toward a Fabric-based runtime.


Do not block current work waiting for that migration.


Current strategy:

NOW -> visually compare/test Mindcraft and minecraft-for-astra in separate sandboxes before integrating either into the civilization repo

LATER -> monitor AIRI's Fabric body direction as a possible stronger physical substrate


### FALLBACK 1: FRENS

Repository:

https://github.com/wcfcarolina13/Frens


Keep Frens as the first fallback if Mineflayer-based Astra body mechanics still show unacceptable physics/pathing problems.


Why keep it:

- Fabric/server-side style body may avoid some remote Mineflayer/Paper issues

- current researched branch targeted modern 1.21.x versions

- body-oriented capabilities include mining, woodcutting, hunting, fishing, storage, shelter, eating, sleep/day-night behavior, hostile defense, and recovery

- license observed during research: MIT


Do not test Frens until both active co-primary Mineflayer candidates — Mindcraft and minecraft-for-astra — get bounded visual attempts.


### FALLBACK 2: MC_AIPLAYER / AIBOT

Repository:

https://github.com/zoyluoblue/mc_aiplayer


Keep as a secondary deterministic-body fallback.


Useful because it exposes many explicit tools/task state machines for:

- mining

- crafting

- smelting

- building

- farming

- combat

- fishing

- trading

- storage

- survival

- equipment


The researched version targeted Fabric 1.21.3, so it requires a separate compatible test server.


License observed during research: MIT.


### REMOVED FROM ACTIVE BODY PLAN

The following are no longer active priorities and should not consume near-term engineering time:

- minecraft-agent-swarm

- mineflayer-baritone as a standalone body candidate

- UnionClef

- MineBot

- mc-fleet-bot

- Phoenix as a runtime

- Mindcraft is no longer removed; it has been restored to the active co-primary runtime shortlist


Reason:

Updated after reviewing Emergent Garden / Mindcraft demos: minecraft-for-astra and Mindcraft are now the two active Mineflayer body/runtime candidates. AIRI remains an architecture/source reference. Frens and mc_aiplayer remain explicit fallbacks if Mineflayer reliability is unacceptable.


These older projects can be rediscovered later if the active shortlist fails, but they should not clutter the current plan.


### BODY / MIND BOUNDARY

For now:

BODY = premade Minecraft runtime + perception + bounded actions

MIND = future per-citizen AI


Final target:

Citizen AI

-> receives personal perception

-> interprets situation

-> chooses intention

-> body executes

-> Minecraft changes

-> body reports result/perception

-> citizen AI thinks again


Do not let the body become a central settlement manager.


### VISUAL ACCEPTANCE RULE

Logs and unit tests are insufficient.


The body wins only when we can watch it in Minecraft and see it:

- move competently

- stay connected

- avoid stupid terrain behavior when alternatives exist

- gather

- craft

- use inventory

- fight when appropriate

- retreat when appropriate

- eat

- sleep

- store/transfer items


The goal is not to build the body ourselves if somebody else already solved it.


### DECISION RULE

Test Mindcraft and minecraft-for-astra as co-primary candidates. Mindcraft is especially valuable because there are real public demos of LLM agents continuously playing Minecraft, communicating, sharing knowledge, coordinating, and operating as multiple agents. minecraft-for-astra remains attractive for its smaller brain/body-oriented interface, bounded tools, event triggers, reflex layer, and progress-aware navigation.

Keep our civilization cognition separate from either runtime: persistent citizen identity, memory, relationships, beliefs, gossip, emergent jobs, goals, and history stay ours. Use AIRI as an additional architectural/source reference.

Choose between Mindcraft and minecraft-for-astra based on observed physical reliability, action coverage, failure feedback, perception hooks, multi-agent stability, and how cleanly we can place our PerceptionSnapshot + citizen mind above the body. If both Mineflayer bodies are still unreliable, test Frens.

If Frens is insufficient, test mc_aiplayer.


Stop broad repo hunting until this shortlist is exhausted.


TOMORROW STARTING POINT

Take point on the body decision. Start with Mindcraft vs minecraft-for-astra, inspect the current repos/code paths needed for perception and bounded actions, then make a concrete visual test plan before touching the main civilization integration.


CIVILIZATION BEHAVIOR BENCHMARK

Use Project Sid / Emergent Garden-style emergent society as the behavior target, not as a drop-in runtime: citizens should be able to develop work roles through repeated behavior and social demand, talk to one another, share knowledge, gossip with source attribution, form opinions/reputations, coordinate, disagree, and change goals without a central manager hard-coding professions or assignments.


## FUTURE COGNITION RESEARCH — TYPESAFE JEV / SYSTEM-ONE MODELS


### WHY SAVE THIS

TypeSafe's Jev / System-One model approach is not a Minecraft body and should not distract from the current body-first work. It is worth preserving as a future fast-decision layer once the physical runtime is reliable.


### CORE IDEA

Jev is designed around fast structured decisions from state rather than long-form chat. A future citizen could provide a compact state plus a bounded set of choices and receive a typed decision/confidence result.


Potential Minecraft example:

health low

skeleton nearby

food carried

shelter nearby

current task active


Possible choices:

attack

flee

eat

seek shelter

continue task


Jev could score/select among those choices quickly while a larger LLM remains responsible for deeper planning, reflection, relationships, long-term goals, culture, and complex social reasoning.


### TWO-SPEED MIND ARCHITECTURE

Potential future split:


FAST SYSTEM 1

- rapid threat/reward judgments

- task interruption decisions

- choose among a small bounded action set

- quick social/appraisal judgments

- low-latency prioritization


SLOW SYSTEM 2

- long-term planning

- reflection

- relationship interpretation

- life goals

- negotiation

- institutional/cultural reasoning

- unusual novel situations


Both layers would still act through the same proven Minecraft body.


### IMPORTANT LIMIT

Jev does not solve:

- navigation

- ladders

- water exit

- mining

- inventory

- farming

- crafting

- building

- combat execution


It is a cognition/routing candidate only.


### DO NOT USE EVERY TICK

Even a fast model should not be queried continuously for routine motor actions. Deterministic skills should continue established intentions until a meaningful trigger occurs.


Good triggers include:

- threat appears

- health/hunger changes materially

- task completes

- tool breaks

- another citizen interrupts

- route fails

- important opportunity appears

- social event occurs


### CITIZEN CONTROL

If adopted later, Jev should operate per citizen, not as a central settlement manager.


Example:

Atlas state -> Atlas fast decision

Maya state -> Maya fast decision

Theo state -> Theo fast decision


Persistent identity/memory remains ours.


### STRUCTURED OUTPUT CONTRACT

Any Jev integration should remain bounded:

- fixed/validated decision schema

- no raw movement keys

- no arbitrary code execution

- no invented world facts

- confidence exposed as metadata, not truth

- result checked against current world state before execution


### RELATIONSHIP TO MODEL LEASING

Jev could eventually sit alongside the existing ModelRouter / ModelLeaseManager rather than replacing it.


Possible future route:

urgent reflex -> deterministic NO_LLM

fast bounded judgment -> Jev/System-One

deep cognition -> leased LLM

physical execution -> premade Minecraft body


### COST / AVAILABILITY

Treat Jev as optional external infrastructure. Pricing, access, latency, and product availability can change. Do not make the civilization dependent on it.


### CURRENT DECISION

Save for future cognition experiments.


Do not integrate Jev until:

1. a premade Minecraft body is visibly reliable;

2. the five citizens can run autonomously;

### 3. we have a real need for a faster cognitive layer than the normal LLM route.


LOCKED PERCEPTION & SENSORY CONTRACT — BODY TO CITIZEN MIND


STATUS

### This section is now the authoritative perception design and supersedes earlier ambiguous notes about vision, hearing, nearby entities, and threat handling.


CORE LOOP

Minecraft world

-> body senses

-> PerceptionSnapshot

-> citizen AI interprets

-> citizen AI chooses intention

-> body executes

-> verified result

-> body senses again


### The body reports facts. The citizen mind decides what those facts mean and what to do.


VISION — 360-DEGREE SITUATIONAL AWARENESS

Citizens use 360-degree visual awareness within a maximum range of approximately 64 blocks.


Reason:

A strict human camera cone is likely to make AI agents brittle when they are already managing many tasks. We still preserve orientation awareness so the citizen knows what is in front, behind, left, and right relative to its current facing.


360-degree awareness is NOT X-ray vision.


A visual target must still pass:

- range

- line of sight / occlusion checks

- loaded/available world data

- reasonable visual relevance


### A mob behind a solid wall is not visually perceived merely because the server knows it exists.


FACING / ORIENTATION

Every perception snapshot includes the citizen's own:

- exact position

- yaw / facing direction

- pitch when useful


Every visible moving target includes:

- stable entity ID

- exact Minecraft coordinates

- distance

- relative bearing / relative side

- elevation difference when useful

- line-of-sight state

- motion trend when derivable


The stable entity ID and exact coordinates are authoritative for target identity.


Relative phrases such as "behind" or "front-right" are convenience metadata only.


### This prevents target confusion when the citizen turns its head or multiple mobs are nearby.


VISUAL POSITION PRECISION

For actually visible entities and important visible objects, provide exact Minecraft coordinates.


Example:

zombie_1842

position = 143.2, 69.0, -381.7

distance = 8.4

relative = behind-left

visible = true


### The AI may reason naturally from the direction/distance, while the body uses stable IDs and exact coordinates for execution.


DISTANCE-SCALED VISUAL DETAIL

Use distance-scaled detail rather than identical detail at every range.


Close targets:

- exact identity/type

- exact coordinates

- distance

- motion

- state/details when observable


Far targets near the 64-block limit:

- broad type/category

- approximate count/grouping

- exact or clustered coordinates where useful

### - reduced detail


### Do not flood the model with unnecessary micro-detail from far away.


MOVING ENTITY MEMORY

When a mob/animal leaves current perception, remove it from current awareness.


Do NOT preserve exact last-known coordinates for moving mobs as if they remain trustworthy.


Reason:

they may have moved immediately after leaving sight.


### A citizen may remember an encounter conceptually later, but current tactical perception must not pretend the mob is still there.


STATIC / IMPORTANT LOCATION MEMORY

Static or mostly static locations may be remembered.


Remember:

- houses / shelters

- villages

- cave entrances

- mine entrances

- farms

- animal pens

- chests / storage areas

- furnaces / crafting areas

- useful tree areas

- ore-work entrances/sites

- bridges / paths

- large water sources

- dangerous pits / lava zones

- other important work or safety locations


Do not remember every random door, puddle, or minor terrain feature.


For these remembered locations:

- retain the exact coordinates originally observed

- retain what the citizen believed the place was

- attach observation time

- attach confidence

### - allow confidence to fade over time


### Old memory is not current world truth.


OTHER CITIZENS — LAST KNOWN LOCATION

When another citizen leaves current perception, do not preserve them as an exact GPS target.


Use a rough recent memory such as:

"Maya was near the farm recently."


No live tracking.


### Exact coordinates are available only while the citizen is currently perceived or through explicit fresh information.


HEARING — MAJOR SENSORY CHANNEL

Hearing is a major part of perception, not a minor fallback.


Normal useful hearing range:

approximately 32 blocks.


### Exception:

### very loud events such as explosions or thunder may carry farther.


HEARING OUTPUT FORMAT

Hearing provides:

- sound category

- rough direction

- rough distance band

- confidence

- identified source when reasonably inferable

- whether the source is currently visible

- age / time since heard for short-term audio memory


Do NOT provide exact coordinates from sound alone.


Example:

zombie groan

direction = behind-left

distance = nearby

confidence = 0.82

visibleSource = false


This allows:

### "I hear something behind that wall"

### without granting supernatural sound triangulation.


SOUND DISTANCE BANDS

Recommended qualitative bands:

- very close

- nearby

- medium

- far / faint


### The body may maintain precise engine-level numbers internally, but the mind should normally receive the rough auditory band unless the source becomes visible.


OCCLUSION / MUFFLING

Walls and obstacles muffle sound rather than making sound binary.


Obstacles may reduce:

- confidence

- direction precision

- distance precision


Example:

### "Muffled zombie sound, somewhere left, probably nearby, confidence 55%."


Open-air sounds should be clearer.


AUDIO CATEGORIES TO EXPOSE

Expose important and useful environmental audio, including:

- hostile mob sounds

- passive animal sounds

- footsteps / movement when useful

- block breaking

- block placement when detectable

- doors opening/closing

- chest/container interaction

- water

- lava

- fire

- bow shots

- arrow impacts

- damage sounds

- explosions

- thunder

- citizen speech


### Do not expose every trivial Minecraft sound event.


Filter noise before it reaches the AI.


IDENTIFIABLE AUDIO SOURCES

When the body can reasonably infer who caused a sound, include the identity.


Examples:

"Maya opened a chest nearby behind you."

"Theo is breaking stone somewhere to the left."


When the source is not identifiable:

### "Block breaking sound, left, nearby."


Do not invent identity when evidence is weak.


SHORT-TERM AUDIO MEMORY

Recent sounds remain in short-term awareness for roughly 10–30 seconds.


Confidence decays quickly.


Example:

### "I heard a zombie behind that wall a few seconds ago."


### This is recent sensory memory, not proof the zombie is still there.


VISION + AUDIO TOGETHER

Server truth, visual perception, auditory perception, and citizen belief are distinct.


Example:

Server truth:

a zombie exists behind a wall.


Visual perception:

no zombie visible.


Auditory perception:

muffled zombie groan behind-right, nearby, confidence 0.7.


Citizen belief:

"there is probably a zombie behind that wall."


The citizen may then:

- investigate

- avoid

### - prepare a weapon

### - warn another citizen

- ignore it


This uncertainty is intentional.


THREAT / COMBAT POLICY

Hostile mob detected does NOT automatically mean flee.


The body reports threat facts.


The citizen AI chooses among responses such as:

- fight

- approach and fight

- retreat

- hide / use cover

- avoid

- ask for help

- help another citizen

- ignore / continue if safe


Provide useful tactical facts when available:

- hostile entity ID

- coordinates

- distance

- motion / approaching or leaving

- whether it appears to be targeting the citizen

- line of sight

- citizen health

- hunger

- equipped weapon

- armor

- nearby allies

- nearby obvious cover

- viable escape direction if body can determine it without choosing the goal


### The body must not turn these facts into a hardcoded personality decision.


EMERGENCY REFLEX EXCEPTION

Deterministic reflexes remain allowed only for immediate lethal situations where waiting for LLM inference is unreasonable.


Examples:

- drowning with critically low air

- standing in lava

- on fire at critical health

- a very close Creeper already in the explosion phase

- immediate fall / movement emergency when a deterministic recovery exists


After the reflex:

- return control to the citizen AI

- report what happened

- let the citizen interpret the event


### Normal zombie/skeleton/spider encounters are not automatically reflexive flee events.


MOTION / CHANGE AWARENESS

Perception should derive meaningful change over time.


Useful derived facts:

- approaching

- moving away

- following

- appeared

- disappeared

- stopped following

- citizen approaching

- daylight fading

- water directly ahead

- health just dropped

- item just picked up


### Do not force the LLM to infer every trend from raw repeated coordinates.


BODY / PROPRIOCEPTION

The citizen should know what its own body is currently doing.


Expose:

- walking

- sprinting

- swimming

- falling

- climbing

- mining

- attacking

- eating

- using a workstation

- opening a container

- sleeping

- stuck / no progress


Include useful progress information.


Example:

"Trying to navigate for 7 seconds; moved only 0.4 blocks."


### This lets the mind reconsider instead of blindly repeating a failed intention.


ATTENTION / COMPRESSION

Do not dump every loaded entity/block into the model.


Prioritize:

- threats

- citizens

- current task targets

- food/resources relevant to current needs

- important structures

- unusual events

- nearby interactable objects


Group repetitive distant objects.


Example:

Instead of 30 individual cow entries:

### "cow herd: ~30 east, 15–35 blocks away"

### plus one or two closest relevant cow IDs if needed.


PER-CITIZEN PERCEPTION

Each citizen receives its own perception.


Atlas and Maya may know different things about the same world.


No magical shared global awareness.


Information may become shared only through:

- direct observation

- speech/messages

### - shared records later

- explicit systems that reasonably transmit knowledge


UNCERTAINTY

Perception may include confidence.


Suggested interpretation:

- direct clear vision: very high confidence

- occluded/muffled hearing: lower confidence

- recent sound memory: decaying confidence

- old landmark memory: fading confidence

### - another citizen's report: source-attributed belief, not direct observation


Do not present confidence as objective truth.


PERCEPTION TIMING

The body may sense continuously, but the LLM should not be invoked every game tick.


Use:

- meaningful event triggers

- action completion/failure

- periodic compact snapshots when idle or continuing long tasks


Important triggers include:

- threat appears

- citizen speaks

- health changes materially

- hunger crosses threshold

- item/tool breaks

- task succeeds/fails

- unusual sound

- new structure/resource discovered

- current route becomes blocked

- major environmental change


### The current physical task may continue deterministically between deliberations.


REQUESTING MORE INFORMATION

The citizen AI may choose to gather more perception before committing to a major action.


Example:

heard skeleton west

-> intention: investigate carefully

-> body turns/moves toward safe vantage point

-> new perception

-> skeleton becomes visible

-> citizen decides fight/avoid


This supports:

### observe -> think -> inspect -> think -> act


### rather than demanding one perfect decision from one snapshot.


PERCEPTION SNAPSHOT — TARGET SHAPE

Conceptually:


PerceptionSnapshot {

  self

  vision

  hearing

  recentChanges

  messagesHeard

  inventory

  relevantRememberedLocations

  nearbyCitizens

  immediateThreatFacts

  currentAction

  progress

### affordances

### }


### The exact schema can evolve, but these semantics are locked.


AFFORDANCES

The body may expose physically available actions such as:

- walk_to

- inspect

- gather_visible_resource

- attack_visible_target

- retreat

- open_container

- use_workstation

- eat_carried_food

- talk_to

- continue_current_task


### Affordances tell the AI what is physically possible.


### Affordances do NOT choose the citizen's goal.


LONG-RANGE DETAIL CHOICE

Final choice: distance-scaled detail.


Within the 64-block visual range:

- near = detailed

- far = compressed / grouped

### - exact stable coordinates/IDs remain available for directly visible targets when needed for execution


### This balances reliable AI control with manageable context size.


FINAL DESIGN RULE

BODY = senses + physical capability + verified outcomes.

MIND = interpretation + intention + choice.


The body should never say:

"I should hunt the cow."


It should say:

"Cow visible at X/Y/Z, 9 blocks away, healthy, moving east."


The citizen decides what that means.


## ECONOMY AND MULTI-COMMUNITY ROADMAP — REUSE AND PROOF PLAN (SEPTEMBER 2026)


### STATUS / INTEGRATION RULE

This is the planned expansion of the first five-citizen Minecraft settlement, NOT a claim that any economy feature is implemented or that the listed repositories are plug-and-play together on Paper 1.21.4. These are documented capability/research candidates from the 10-idea feasibility review. Inspect each repository's current license, maintenance, supported Minecraft version, API and dependencies before adopting; independently smoke-test selected integrations in an isolated sandbox. The current physical-body acceptance gate and first five-citizen survival/social run remain prerequisites. Keep citizen minds, Minecraft world truth and authoritative economic records separate. Reuse physical/game mechanics; keep independently chosen social behavior and the experiment's provenance custom.


### 1 — ONE-LINE STARTING PERSONALITY (KEEP, ALLOW CHANGE)

Each adult citizen can begin with one concise initial disposition; it is a mutable starting tendency, not a hard-coded lifelong personality, occupation, religion or governance preference. Experiences, remembered outcomes and relationships may change later behavior. Preserve separate memory, beliefs, needs, goals, and perspective-specific relationships for each citizen. Candidate reference: Generative Agents research implementation — https://github.com/joonspk-research/generative_agents . Reuse patterns for memory, retrieval, reflection and planning, not the 2D environment as a Minecraft body. We still implement the citizen identity/profile schema, memory updates and Minecraft perception connection. Proof: observe independently recorded decisions in comparable situations across repeated runs and after meaningful new experience; avoid claiming a trait from one dialogue line.


### 2 — MULTIPLE COMMUNITIES WITH DIFFERENT STARTING DIRECTIVES (KEEP, LATER)

After one five-citizen village works, create a second and then third geographically distinct settlement, each with a clearly logged initial collective objective (e.g., food/shelter security; production/trade; exploration). A directive is shared initial context, not mandatory individual actions. Citizens may disagree, migrate, form affiliations, negotiate or leave. Candidate infrastructure: Towny (town membership, territory, banks/plots and permissions) — https://github.com/TownyAdvanced/Towny ; WorldGuard (region definition, permissions, world-action protection) — https://github.com/EngineHub/WorldGuard . Do not let Towny's built-in mayor/tax mechanics predetermine the emergent community's leadership or policies. Custom work: personal/community membership, shared goals, migration, inter-community communication, and experimental controls. Proof: two communities maintain distinct starting objectives and membership without leaking hidden world facts; record differences in terrain, resources, model prompts and initial inventories so directive effects are not assumed from an uncontrolled comparison.


### 3 — REAL MINING AREAS AND PRODUCTION (KEEP)

Citizens physically discover a productive area, then may establish a named mine, paths, lighting, storage, access rules and work orders. A claimed mine does not generate ore: mineable deposits are finite and items enter ownership/ledger only after actual extraction and pickup. Candidates: mineflayer-collectblock (movement + tool/dig/pickup helpers) — https://github.com/PrismarineJS/mineflayer-collectblock ; WorldGuard (region protections/permissions) — https://github.com/EngineHub/WorldGuard . Custom work: ore-area discovery using citizen-limited perception, mine claims/rights, inventory proofs, extraction logs, depletion awareness, task reservations, and labor agreements. Proof: with known initial inventory, one citizen extracts a bounded quantity of real ore, physically obtains drops, deposits them and produces an extraction record that matches world and inventory deltas.


### 4 — MATERIAL VALUE, RECIPE COSTS, AND ACTUAL MARKET PRICES (KEEP, EDIT)

Make three separate concepts: (a) reference values used for initial comparison, (b) use/production value from recipes, equipment, nutrition, scarcity, durability, and labor, and (c) actual negotiated transaction price. Do not hard-code permanent market prices or assume material cost equals selling price. Candidate: minecraft-data for versioned blocks, items and crafting inputs — https://github.com/PrismarineJS/minecraft-data . Custom work: personal valuations, time-series trade prices, reference-value table, supply/demand estimates, and links to verified owned inventories. Proof: citizens can agree on different actual prices when local conditions change, and the ledger records the paid price instead of silently replacing it with a reference estimate.


### 5 — ITEM, TRANSACTION, INCOME AND EXTRACTION TAXES (KEEP, START WITH ONE TYPE)

A tax is triggered by a precisely defined taxable event, not because an item has been labeled “valuable.” Possible future events: completed sales, wages, extracted ore, and property-period assessments. The first experiment uses one tax type (e.g., a percentage of a completed sale) so the same resource is not accidentally taxed several times through inconsistent plugins. Candidates for evaluating existing mechanics: QuickTax — https://github.com/tjtanjin/QuickTax ; VaultAPI economy interoperability — https://github.com/MilkBowl/VaultAPI ; better-sqlite3 transactions — https://github.com/WiseLibs/better-sqlite3 . These candidates are not proof that QuickTax implements our specific extraction, item-value, or citizen-negotiated taxation, nor that its current version supports our Paper server. Custom work: taxable-event classifier, community jurisdiction, exemptions, accounting entries and rollback/recovery. Proof example: for a 100-credit sale with a 5% seller-side sales tax, the buyer pays 100, seller receives 95 and the correct treasury receives 5; a failed trade collects no tax.


### 6 — COMMUNITY-CHOSEN TAX RULES (KEEP, SOCIETY LAYER)

A community may propose, deliberate, negotiate, approve, amend, repeal or dispute rules about taxable events, rates, exemptions and enforcement. The decision method is itself a persistent community choice, not necessarily a preset mayor or universal voting procedure. Towny is a reference for town banks, tax settings, residents and plots — https://github.com/TownyAdvanced/Towny — but its administrative conventions must not silently predetermine our AI societies. Our custom proposals record author, jurisdiction, legal state, agreed procedure, effective date, eligible payers and historical amendments. The deterministic economy engine executes only adopted, in-force rules; citizens may object, negotiate, contest or leave subject to actual world mechanics. Proof: two settlements can adopt different rules; identical taxable events are processed against the correct active rule; an unapproved or expired proposal does not collect revenue.


### 7 — INFLATION / ECONOMIC ANALYST AI (KEEP, READ-ONLY FIRST)

Introduce a separate observational economic analyst, NOT a hidden mayor, omnipotent economy controller, or mandatory central planner. Feed it verified time-series from sales, traded-item quantities, production, food reserves, wages, currency issue/destruction, labor and community finances. A deterministic statistics layer computes relevant price indexes for explicitly defined comparable baskets and periods, with volume/sample-size and scarcity context. An increase in bread price from a crop shortage is not by itself sufficient to claim economy-wide monetary inflation. The analyst can explain, flag uncertainty and propose optional responses; citizens/communities decide whether to act. Candidates: better-sqlite3 — https://github.com/WiseLibs/better-sqlite3 ; optional economy interface Treasury — https://github.com/ArcanePlugins/Treasury . Treasury is a provider API, not an AI economist. Custom work: statistical measures, provenance, analyst prompt/tools, explanations and permissions. Proof: give the analyst a controlled series of real ledger events; reported price changes match the independently computed data, and low-volume markets are reported as uncertain, not given fabricated percentages.


### 8 — CITIZENS BUY BUILDINGS / FARMS / SERVICES FROM THE HUMAN (KEEP)

The human spectator may separately participate as a real external contractor offering explicit services: a fixed house, farm, storage, road, or infrastructure job. A citizen may request a quote, accept/refuse, compare alternatives, and pay only from owned resources/credits. Distinguish human-built/creative-pasted work from a citizen's independently performed construction in research logs. Candidates: WorldEdit for controlled Minecraft world edits — https://github.com/EngineHub/WorldEdit ; prismarine-schematic for reading/checking block patterns — https://github.com/PrismarineJS/prismarine-schematic ; WorldGuard for access/protection — https://github.com/EngineHub/WorldGuard . Treat the referenced mineflayer-builder as a work-in-progress candidate, not proven drop-in survival construction — https://github.com/PrismarineJS/mineflayer-builder . Custom work: offer/acceptance, escrow, materials, building-site rights, deliverables, world-verified completion, ownership and failure/refund handling. Proof: one named citizen pays for a fixed house in a designated plot, required blocks/door/bed are verified, ownership transfers and payment is released exactly once.


### 9 — TREASURY, ASSISTANCE, AND COMMUNITY INFRASTRUCTURE (KEEP)

A settlement may raise revenue and then choose to spend it on food assistance, housing, roads, public storage, farm expansion, construction, tools, or reserves. The community determines its spending decision procedure and recipient selection, not a global economy AI. The treasury is an actual account; approved expenditures debit its balance and credit a recipient or fund a verifiable purchase/contract. Candidates: Towny town-bank reference — https://github.com/TownyAdvanced/Towny ; VaultAPI for selected plugin economy compatibility — https://github.com/MilkBowl/VaultAPI ; better-sqlite3 for our authoritative treasury/approval records — https://github.com/WiseLibs/better-sqlite3 . Custom work: community authority, proposal/approval, budgets, payments, public-project verification, aid eligibility as a community-defined choice, failure handling. Proof: a 500-credit treasury approves and executes a 200-credit transfer exactly once; the beneficiary gains 200, treasury retains 300, and an unauthorized request cannot spend funds.


### 10 — PRIVATE FARMS, HIRING, WAGES, AND CONTRACTS (KEEP)

One citizen may possess or operate a real farm or mine and offer another citizen paid work. Start with measurable, finite contracts: a specified field harvest/replant and delivery, ore haul, or construction subtask. An individual can accept, decline, negotiate or seek another employer; a job is not an identity trait. The employer's actual account reserves the wage; settlement rules may define any taxes. Candidates: Jobs Reborn as a reference for Minecraft activity/occupation rewards — https://github.com/Scot-Survivor/JobsReborn ; QuickShop-Hikari as a reference for physical player-operated item buy/sell stores — https://github.com/QuickShop-Community/QuickShop-Hikari ; Mineflayer for body interactions — https://github.com/PrismarineJS/mineflayer . Jobs Reborn does not itself prove our citizen-to-citizen employer-paid contract system; do not enable duplicate item-action reward currency. Custom work: job offers and negotiation, contract ownership, reserved wages, beneficiary/produce rights, task completion predicates, partial/cancelled work and wage disputes. Proof: ABC offers DEF an agreed field job, DEF chooses whether to accept, then physically harvests/replants and deposits output; if work satisfies contract, reserved wages transfer once from ABC to DEF. Failure/cancellation follows recorded contract terms, not a fabricated completed shift.


### CROSS-CUTTING FOUNDATION — ONE AUTHORITATIVE ECONOMIC LEDGER

Implement once before features 4–10 depend on it. Track citizens, businesses and treasury accounts; credits issuance/destruction; item stacks/storage/property and claims; offer/reservation/escrow; sales, gifts, barter, wages, mining output, taxes, debts and construction agreements; and verified physical events. A citizen's belief about a debt or ownership dispute must be distinct from ledger status and world truth. The economic event stream should distinguish sale vs gift vs loan vs wage vs own-container transfer. Use unique transaction IDs and idempotency guards so retries cannot mint money, pay twice or double-collect taxes. Database transactions alone cannot atomically commit a Minecraft inventory/world change: reserve funds and goods, execute the real-world action, re-observe inventories/blocks, then settle or reconcile after a crash/disconnect. One ledger must be the authoritative money source; avoid combining plugins that independently award credits for the same action. Candidate: better-sqlite3 — https://github.com/WiseLibs/better-sqlite3 . Begin with explicit non-mineable credits and optional barter; decide and log issuance rules instead of spawning balances on demand. Diamonds/gold/food retain physical consumption and crafting uses even if used in a trade. Proof: a failed, cancelled, timed-out or repeated item exchange cannot duplicate goods, payment or tax; persisted records reconcile with actual Minecraft inventories and treasury balances.


### IMPLEMENTATION ORDER — DO NOT BLOCK THE FIVE-CITIZEN MILESTONE

Phase 0: pass the physical Minecraft body comparison and run one starter village with five persistent independent citizens; document actual social/resource interactions. Phase 1: one farm, two citizens, one real finite wage contract and verified item/payment transfer; add minimal ownership, offers, barter, credit accounts and ledger. Phase 2: small market with actual negotiated prices, basic item-production costs, bounded mining/farm claims and contracts. Phase 3: one community treasury, one explicitly adopted taxable event, and one approved assistance or human-built infrastructure contract. Phase 4: second and third communities with different logged starting directives, independently chosen arrangements, inter-settlement exchange and migration. Phase 5: read-only economic analyst with measurable price data; add more complex labor markets, resource taxes, exemptions and public projects only when the underlying transactions are reliable. This sequencing is a dependency order, not a calendar promise.


### EARLIEST INTEGRATED DEMO — ABC HIRES DEF

ABC owns or holds a valid use claim over a real wheat field and possesses enough reserved credits. ABC offers DEF a short contract to harvest and replant a defined area for a negotiated wage. DEF accepts or refuses as an independent citizen. If accepted, the physical body harvests and replants; the world and inventory confirm crop delivery; the ledger settles DEF's wage once from ABC's reserved funds. Record offer, acceptance, task, physical result, inventory deltas, money deltas, failure/recovery and any citizen-to-citizen speech. This one demonstration provides a verifiable foundation for trade, item valuation, ownership, payroll, later taxation and economic analysis. If DEF refuses or the job fails, report that actual outcome rather than forcing a success story.


### COMPATIBILITY / ATTRIBUTION / EXPERIMENT CHECKLIST

Treat each linked repository as a candidate or reference until its current state is inspected and the selected subset passes an isolated local Minecraft integration. Check license and attribution requirements, server version (currently Paper 1.21.4 for the Probe test), plugin API and loaders, cross-plugin economy behavior, security, transaction duplication, and whether a feature is truly player-autonomous or a scripted server reward. Do not silently switch Paper to Fabric or assume WorldEdit, Towny, Vault, Jobs Reborn, QuickTax, WorldGuard and a custom agent runtime will work together unmodified. Prefer minimal tested integrations; maintain THIRD_PARTY_NOTICES.md when code or dependencies are adopted. Record precisely which interventions, starting directives, human-built structures, item/credit issuance and admin/creative actions influenced each experiment. A credible result is a documented observed behavior under known starting conditions, not proof that AI has human feelings or that an entire human civilization spontaneously appeared.


## 🏰 OPTION A — WORLD, CONSTRUCTION & AUTOMATION (CONFIRMED)

[Embedded illustration in original Google Doc; image not included in Markdown export]

CONCEPT ART  |  Illustrative starter settlement; actual Minecraft terrain and structures will be tested separately.

DECISION: Start with spacious natural terrain and a small, functioning five-citizen village. The citizens determine later expansion; the human supplies optional construction and automation services. No giant content modpack or preassigned civilization.

### 1  🌍  WORLD & STARTING CONDITIONS

Choose a reproducible survival-friendly world with a large plains/valley building area, a river, a nearby forest, accessible natural caves and mining resources, simple paths, and plenty of empty plots. The world should look inviting without forcing a fixed future city layout.

World choices to test: (A) a roomy naturally generated plains/river seed (default fallback); or (B) a downloadable custom terrain map such as Kyldros (candidate only). For any custom world, check 1.21.11 compatibility, ore distribution, real survival resources, navigation, creator permissions and performance before adopting it. Do not mistake a creator's advertised features for a live-tested result.

STARTER SETTLEMENT — PROVIDED BY THE HUMAN, NOT EMERGENT

- Three modest, accessible houses with at least five usable beds and doors.

- One small working crop farm with modest recorded food and seed supplies; no infinite food.

- One shared storage/work area with usable chests, crafting tables and furnaces.

- Basic connected paths, nearby renewable wood, finite accessible stone/ore and water.

- Several large open plots for future housing, farms, businesses and infrastructure.

Record the world seed, map/version, provided structures, starting inventories, gamerules, terrain changes and admin interventions. The first settlement is a research scaffold, not evidence that citizens independently built a village.

### 2  🗺️  STARTER VILLAGE LAYOUT

[Embedded illustration in original Google Doc; image not included in Markdown export]

FIGURE 02  |  Illustrative settlement map: initial homes, farm, storage, natural resources and open plots.

NORTH — River and natural terrain. WEST — Two small houses and the original starter farm. CENTER — A modest common area and simple paths. EAST — Third house, shared storage and crafting. SOUTH / OUTER RING — Open expansion plots and routes toward forest and mining areas.

Keep doors, beds, chests and workstations reachable by the current bot body; avoid maze-like interiors, steep drops and difficult water crossings. The layout is a starting suggestion, not a zoning law. Citizens can later renovate, repurpose or abandon any part of it.

### 3  🧠  THE CITIZENS CHOOSE WHAT TO BUILD

YOU PROVIDE THE WORLD AND BUILDING CAPABILITY; CITIZENS CHOOSE THE GOAL, LOCATION AND WHETHER TO COMMISSION IT.

Example, not a scripted outcome: Atlas notices dwindling food; Maya suggests expanding the farm; Theo prefers exploring; the citizens discuss options and may request a quote for a new farm. They can accept, refuse, disagree, postpone construction or try manual building.

CONSTRUCTION REQUEST FLOW

Observed need → citizen conversation / independent choice → proposed structure and site → human quote → optional acceptance / payment → human pastes structure → actual world-state verification and recorded ownership.

The human is a contractor, not the civilization's ruler. The AI must not receive unrestricted OP, WorldEdit or RCON authority. Human-pasted structures must never be presented as physically constructed block-by-block by the AI.

### 4  🧱  INSTANT-BUILD CATALOG

Offer a small, curated catalog of vanilla-block schematics rather than a gameplay modpack that adds ores, mobs, machines, recipes or currencies. Each catalog entry should list its purpose, footprint, land requirements, estimated materials/service cost, accessibility and ownership rules.

- SMALL HOUSE — beds, doors, lighting and basic storage; a citizen or community can request housing.

- MEDIUM FARM — a larger irrigated crop field, access path and collection/storage area.

- WAREHOUSE / MARKET STALL — capacity for real items, reachable containers and clear access rights.

- AUTOMATED FARM — a tested vanilla redstone/hopper or villager-assisted mechanism, with measurable real output.

Paper-side tools to TEST IN A COPY: BuildPaste for a prebuilt structure catalog and command-based construction; or WorldEdit for loading/pasting .schem structures. InstaSchem is an optional item-bound right-click route if its current FastAsyncWorldEdit dependency and Paper 1.21.11 compatibility pass isolated tests. Do not assume BuildPaste's mod-loader Build Placer item works in its Paper plugin. Pick the smallest working set rather than installing all alternatives.

### 5  ⚙️  HUMAN-PROVIDED AUTOMATION

Citizens do not need to hand-build every observer, piston and hopper. They may commission automation as infrastructure while the human installs the actual Minecraft mechanism. Examples: a sugar-cane/bamboo collection farm, a villager-assisted crop farm, or later an iron farm after its economic effects are evaluated.

Citizen requests automation → contractor offers specifications and cost → citizen accepts or rejects → human installs and checks access → real crops/items enter physical containers → citizens collect, use, trade or dispute access.

No imaginary production per tick, instant-grown crops, invisible deposits or duplicate ledger credits. Record who built the machine, who supplied its materials, its operator/owner, inputs, outputs, throughput and maintenance. Villagers or redstone that generate output are external automation, not independent AI citizen labor.

ECONOMIC CONSEQUENCE TO OBSERVE

Automation could make one citizen more productive, alter demand for wage labor and affect resource prices; those are possible observations, not a prescribed story. Preserve manual-farming baseline runs and introduce automation as a separately logged experimental condition.

### 6  👥  FIVE-CITIZEN FIRST PLAYABLE VERSION

Atlas, Maya, Theo, Ava and Kai start as five persistent adult citizens with separate memories, observations, needs and choices. Do not preassign farmer/miner/leader roles, a government, a market price system, friendships or social outcomes. Give them modest survival supplies and functional access to shelter, food, tools and storage.

Before commissioning large projects, prove the chosen bot body can cross doors, path through this settlement, inspect unknown chests, collect actual drops, eat, sleep, interact with citizens and recover from ordinary failures. Then run a documented multi-citizen survival/social baseline for at least three Minecraft days without repeated human rescue.

### 7  🚀  IMPLEMENTATION ORDER & NEXT MILESTONE

- Back up minecraft_ai_sim, Paper configuration and current worlds; use a separate COPY for plugin/world tests.

- Select one terrain candidate, verify compatibility with the actual Paper 1.21.11 setup, and identify an accessible starter area.

- Add three simple houses, five usable beds, a small farm, shared storage, crafting and open expansion plots.

- Trial ONE instant-building tool with a small house and farm; test placement, undo, safe pathing and usable doors/chests/beds.

- Pass the live Minecraft body gate; introduce five persistent citizens and record baseline interactions.

- Introduce a citizen-requested, appropriately paid building contract; verify world changes and account/item settlement exactly once.

- Test one real automated farm and its physical storage output; only then explore larger production, wages and economic institutions.

ACCEPTANCE RULE — KEEP THE EXPERIMENT HONEST

Preserve the existing body's physical acceptance criteria and documented intervention log. First prove that the citizens can live together and make actual requests; later test paid construction and automation in controlled, logged stages. A provided world, human construction, or automated output must never be misreported as spontaneous AI-built infrastructure.

LOCKED DIRECTION: Option A is the first experiment. The initial settlement is small; the surrounding world is spacious; construction is citizen-directed; human-provided automation is optional, physical and accountable.

### 8  🐄  LIVESTOCK FEEDING TROUGHS — CITIZEN-CONTROLLED AUTOMATION

DESIGN ADDITION  |  Citizens decide how many animals to keep and how much feed to supply. A physical trough handles repetitive feeding and breeding; it does not make herd-management decisions.

Rather than requiring a Mineflayer citizen to hand-feed every cow or sheep, offer a feeding-trough structure: citizens deposit appropriate real breeding food into an accessible inventory, and a compatible server-side mechanism consumes that stock when eligible nearby animals breed. Every animal and food item must remain part of the real Minecraft world.

HOW IT WORKS

- Citizen chooses whether to raise animals, sets its own desired herd size, and commissions or acquires a pen/trough when appropriate.

- Citizen farms, obtains or trades for wheat or other species-appropriate feed, then deposits a chosen quantity into the trough.

- The trough automates eligible feeding/breeding, consumes actual stored feed, honors vanilla breeding cooldown and baby growth, and records actual offspring.

- Citizen observes real adult/baby counts, available feed and pen capacity; it can stop stocking the trough, change its plan, collect products or decide whether to slaughter an animal.

COMPATIBILITY & IMPLEMENTATION GATE

The discussed Animal Feeding Trough-style mod is a concept reference, NOT an installed component or verified Paper 1.21.11 plugin. Fabric/NeoForge mod files cannot simply be placed in Paper's plugins folder. Keep the live server on Paper; Red may investigate an existing Paper-compatible feeding-trough plugin or a narrowly scoped custom Paper plugin on an isolated server copy only. Verify exact version, permissions, dependencies, hopper support, item consumption, breed eligibility, range, caps and server performance before adoption.

Prefer simple chest/hopper-style inventory access so the existing Minecraft bot can inspect, fill and retrieve real items. A configurable safety cap can prevent entity explosions, but the cap is an infrastructure limit, not a centrally assigned citizen herd target. Log all human installations, automation-generated offspring, feed consumption and ownership distinctly from AI physical labor.

ACCEPTANCE TEST — DO NOT ASSUME IT WORKS

In WORLD-LAB, demonstrate a citizen putting known real wheat into a trough, record pre/post feed counts, observe one verified breeding event and resulting offspring, then verify cooldown/cap behavior and no duplication. Also demonstrate that an empty trough stops producing offspring. No live-world installation or automated breeding until this passes.

Companion food sources remain optional: Blue can later test shore-based fishing, animal observation/pen interaction and item handling; citizen decisions about farming, fishing, livestock and food sharing are not pre-scripted. No compulsory livestock occupation or fixed rationing policy.

### 9  🏡  PERSISTENT HOMES & PERSONAL STORAGE — CITIZEN-CHOSEN

DESIGN REQUIREMENT  |  A citizen returns to its established home to sleep and to its designated personal storage to put away belongings—not whichever bed or chest is closest.

Offer accessible starter houses with enough usable beds and clearly identified personal chests. The current three-house/five-citizen plan can support shared households, with separate beds and private storage per resident; five modest houses remain an alternative if the experiment requires the option of living alone. Housing must be available without prescribing which specific citizen occupies each building.

CHOICE, OWNERSHIP & ACCESS

- A citizen selects or negotiates a home and optional housemates. Persist its chosen home and claimed bed/chest, rather than assigning homes by roster order.

- Record dimension, home/entrance coordinates, bed position and personal-chest position using the existing citizen state architecture. Distinguish private storage, agreed household storage and communal warehouse storage.

- On normal sleep tasks, navigate to the citizen's claimed home bed even when another bed is closer. For personal deposit and retrieval, use the citizen's designated chest instead of the nearest container.

- Avoid accidental exclusive double-claims; multiple residents may share a house with separate beds and personal chests, or share designated household storage by agreement.

- Preserve the home association across reconnects and respawns. Verify doors, paths, bed and chest are still present and reachable; if not, report the failure and allow a temporary shelter or a citizen-chosen move without silently changing ownership.

BODY VERSUS CITIZEN DECISION

MechProbe must be able to target recorded coordinates, navigate home and interact with the correct bed and chest; the independent citizen chooses where to live, with whom, whether to move and what resources to share. A vanilla bed respawn point alone is not persistent knowledge of household ownership or private storage. Do not treat nearby public chests as automatically owned or accessible personal storage.

ISOLATED ACCEPTANCE TESTS

Test: (1) citizen travels to its claimed bed past a nearer free bed; (2) deposits and retrieves at its own chest past a nearer communal/other-owned chest; (3) two residents share a house without colliding exclusive claims; (4) home persists after reconnect and respawn; (5) blocked or destroyed home triggers an explicit failure/temporary alternative rather than a silent permanent reassignment. Run only on isolated Paper 1.21.11 after Red and Blue coordinate server access. This is a new requirement, not a verified current capability.

### 10  🌾  BLUE AGRICULTURE IMPLEMENTATION STATUS — NOT YET FULLY LIVE-VERIFIED

STATUS UPDATE  |  The previous farm gauntlet demonstrated one-cell till/plant after a test-control /give and harvesting RCON-placed mature wheat. It did NOT prove a complete naturally grown 3×3 field → harvest → replant → bread → food-chest cycle.

IMPLEMENTED / TESTED IN CODE

Blue reports findTillablePlot, selectHydratedPlot, tillAndPlantPlot, harvestCropAt, harvestPlot and inspectCrop in packages/skills/src/farm.ts; gatherFood now invokes harvestCrop rather than mineBlock for wheat. Hoe equipping exists if a hoe is held, but obtaining/crafting a hoe remains a gap. Wheat → bread recipe logic and generic chest inventory transfers are unit-tested; the end-to-end food chain is not live-verified.

EXPERIMENT 1 ROLE SAFETY

SIM_ASSIGN_WORK_ROLES defaults to false to stop roster-order work assignments and round-robin NEED_FOOD jobs; older role-based modes require explicitly enabling the flag. Blue reports that HeuristicProvider still routes NEED_FOOD to gather_food for every citizen if LLM_ENABLED is enabled; do not claim that independent food-task selection has been established under that configuration.

LIVE-TEST GATE & SERVER HANDOFF

Blue prepared mechanics:farm, but has NOT run the actual live 3×3 test. The harness must be explicitly enabled with MECHANICS_FARM_TEST_ENABLED=true and FARM_TEST_ALLOW_WORLD_MUTATION=true and refuses ports 25565 (original Paper) and 25566 (unrelated 1.21.4 test server). Red/user must supply idle isolated Paper 1.21.11 WORLD-LAB at 25567, RCON 25577, and an approved FARM_TEST_ORIGIN outside spawn protection and away from the chosen village. Human scouting and Red terrain tests must stop before Blue takes lab control.

FOOD SUPPLY IS NOT YET PROVISIONED

Blue reports that simulation citizens currently spawn with empty inventories; the planned modest starter-food supply is NOT implemented. Before a survival baseline, Red and Blue must agree on real food in designated world chests, accessible starting tools/seeds, logged human setup, and an explicit no-infinite-food rule. Test-control /give for harness fixtures must not be counted as emergent citizen production.

TEST RESULT — BLUE'S REPORTED DIRTY-TREE RUN

Vitest: 245 passed, 4 failed (249 total). New agriculture tests reportedly pass; four pre-existing uncommitted compact-hut/entity-target WIP tests still fail. Do not call the full test suite green or mutate another agent's dirty files. The current full-cycle live farm test remains unverified.

NEXT INTEGRATION CHECKPOINT

After Red finishes terrain inspection, stop simultaneous world use, choose a disposable farming test patch in WORLD-LAB, run the guarded test and retain exact world/inventory/chest deltas, logs and failure details. Do not merge a full food economy or declare farming complete until live growth, harvest, replant, bread, chest storage and eating all pass.

### 11  🚪🌙  DOOR RECOVERY, NIGHTLY RETURN HOME & MINING REUSE

NEW USER DIRECTION  |  Keep the physical wooden house doors. A moving citizen should first attempt a short, controlled forward passage; if it does not progress because of the door, open the door once and continue. Every citizen—including a miner—must plan to return to its chosen home by a configurable Minecraft in-game curfew, then sleep in its own bed.

DOOR HANDLING — MOVEMENT-FIRST, NOT BLIND RIGHT-CLICK

- At an approached wooden door, attempt a brief forward move from a safe nearby standing cell; do not hold forward against the door indefinitely. Measure displacement and identify the actual blocking door cell, not just a generic stalled path.

- If the citizen passes an open doorway, do not activate the door. If progress stalls at the door, inspect its lower/upper-half and open state; activate the closed wooden door once, verify it changed to open, and proceed. An already-open door must not be toggled closed because movement failed for another reason.

- If a path planner refuses to route through a closed door, allow a narrowly scoped approach-to-door step and controlled interaction; do not dig doors, break walls, jump at the door or bypass it by teleportation.

- For non-door obstructions, use the shared bounded jump/replan/stuck recovery. Respect headroom, safe footing, water, drops, collision, retries, timeouts and cancellation. Iron doors require a powered mechanism; report failure when unavailable. Optional closing behind the bot is a separate safe action, never while a bot/entity occupies the doorway.

BEDTIME POLICY — PROPOSED CONFIGURABLE DEFAULT, NOT HARD-CODED REAL-LIFE TIME

- Use each bot's Minecraft overworld time-of-day, not the PC clock: 0 sunrise, 6000 noon, 12000 sunset, 18000 midnight; 24000 ticks per Minecraft day. Read bot.time.timeOfDay from Mineflayer. Source: https://github.com/PrismarineJS/mineflayer/blob/master/docs/api.md

- Proposed first-experiment defaults (user-adjustable): home-arrival goal at tick 12000 (sunset); attempt sleep at tick 13000 when legal. Do not equate return-home deadline with actual bed-use start: arriving early allows storing supplies and preparing for sleep.

- Before starting any mining, fishing, farm or long travel job, estimate a conservative RETURN trip duration based on actual traversable route, elevation, known hazards and current world tick. Reserve extra margin for navigation failures, tool/inventory work and doors; decline or shorten a job that cannot fit before the home-arrival goal.

- Re-evaluate remaining travel time as tasks progress. Begin return early enough to arrive by tick 12000; do not wait until 12000 to leave a distant cave. When mining return starts: stop excavation safely, mark the mine entrance and return route, collect only safe reachable drops, take inventory/tools and navigate home; stop optional work.

- When at home, deposit chosen personal resources into claimed personal storage (shared goods only into authorized shared storage); go to the persisted OWN bed rather than a nearer bed. Sleep only when permitted by actual Minecraft conditions. If trapped, too far away, missing a bed or unable to reach home, report ETA, location and explicit failure; do not teleport, silently claim another bed or claim an on-time return.

- On multiplayer servers, vanilla sleep may skip the night as soon as a configured fraction of players sleep. Decide whether the experiment needs synchronized citizens/observer sleep, and test this separately before adding a sleep-skipping plugin. The user may set different curfew and sleep ticks later.

SOURCE-BACKED REUSE — VERIFY PROJECT VERSIONS AND INSTALLED DEPENDENCIES FIRST

Mineflayer base API: world time via bot.time.timeOfDay; actual own-bed use via bot.sleep(bedBlock); bot.activateBlock for an obstructing wooden door and blockAt for door-state readback. These are API capabilities, not a complete bedtime or door-recovery system. https://github.com/PrismarineJS/mineflayer/blob/master/docs/api.md

PrismarineJS/mineflayer-pathfinder: keep BLUE's single shared navigation stack; reuse path goals, obstacle/block updates and bounded goto/replan. Its README describes canOpenDoors as unreliable and presently refers to fence gates. An unmerged September 2026 pull request proposes wooden-door support: do not assume it ships in our installed version, auto-update blindly or install a competing pathfinder. https://github.com/PrismarineJS/mineflayer-pathfinder | https://github.com/PrismarineJS/mineflayer-pathfinder/pull/375

PrismarineJS/mineflayer-collectblock: candidate for GREEN's physical mining of already-discovered reachable ore, tool use, drop pickup and permitted storage; inspect how its movement settings interact with BLUE's shared navigation before adding it. https://github.com/PrismarineJS/mineflayer-collectblock

PrismarineJS/mineflayer-tool: candidate for selecting/equipping a suitable pickaxe; a separate harvest-tier check is still necessary. https://github.com/PrismarineJS/mineflayer-tool

Optional Paper plugin to EVALUATE, not install: SleepSkipUltra implements smooth multiplayer night skipping and its repo reports a Paper 1.21.11 smoke test, but this does not schedule bots to return from mines, nor does it prove compatibility with our exact Paper 1.21.11 build 132. Only consider it if default sleep-skipping behavior becomes a verified blocker. https://github.com/Etoryx/SleepSkip

NO FULL FABRIC/FORGE MODPACK for movement or bedtime. Paper's official migration documentation states Paper cannot load Fabric/Forge mods. Avoid moving servers, changing vanilla items/ore generation, or installing a hybrid server for a task that the existing Mineflayer body can handle. https://docs.papermc.io/paper/migration/

COORDINATION & ACCEPTANCE GATES

- BLUE owns shared movement, short-forward-then-door-open recovery, home time policy, own-bed sleep routing and cancellation. GREEN owns bounded ore search/mining and must expose progress/ETA and honor BLUE's return-home interrupt; RED owns the physical village/test fixtures. Do not let two agents edit the same adapter modules simultaneously.

- Live two-bot acceptance: a HomeProbe walks through an already-open H1 door without toggling it, stalls at a closed wooden door and opens it once, then reaches its claimed H1 bed/chest; MineProbe searches/mines legitimate visible ore in a separately approved test area and returns via a walkable route before the configured curfew; both handle nighttime sleep attempts without a global /time teleport workaround.

- Test overnight timing with a short near-village job, a distant safe job requiring early departure, a route blockage, insufficient return time, a missing/occupied bed, and early multiplayer night skip. Capture observed Minecraft ticks, route/ETA, actual movement and bed coordinates. A single FarmProbe or unit test is not a successful simultaneous two-bot bedtime test.

LATEST REPORTED PROJECT STATE — PRESERVE HISTORICAL FARM AUDIT ABOVE

Blue subsequently reported FarmProbe full-cycle LIVE PASS at the isolated WORLD-LAB test pad: 9/9 planted/grown/harvested/replanted, 8 real wheat collected, 1 bread crafted and eaten through chest transfer; farming checkpoint 7d3e645. This is Blue's report, not an independently re-run test nor proof of five independent citizens making food choices.

Blue also reported SQLite persistent-home claims and designated own-bed/personal-chest routing UNIT-TESTED, with HomeProbe live test not yet verified at that report. Red subsequently installed five empty single chests in Site C houses H1/H2/H4/H5/H9 and handed the stopped lab to Blue. Do not conflate these statuses with a proven two-bot bedtime/mining test. RED's installation record: docs/RED_SITE_C_CHEST_INSTALLATION.md.

### 12  🎣⛏️  RESOURCE SKILLS REUSE AND AGENT ASSIGNMENTS

INTEGRATION DIRECTION | Keep the five existing independent MechProbe citizens and the Paper 1.21.11 WORLD-LAB. Reuse proven Mineflayer APIs inside bounded citizen-selected skills. RED and BLUE are already working; GREEN is free to implement fishing/item handling without taking over WORLD-LAB or editing BLUE's shared movement files.

FISHING — GREEN OWNS NEXT

Inspect the installed Mineflayer API and existing skills before implementing a new fishing layer. Mineflayer exposes bot.fish() and inventory/block interactions. Build a bounded shore-based FishProbe skill with a real fishing rod, safe standing/casting position, observed item pickup, optional real cooking, permitted chest transfer, no swimming requirement, cancellation, inventory/durability checks and curfew-aware return home. Do not create a sixth citizen or continuous autonomous fishing daemon. https://github.com/PrismarineJS/mineflayer/blob/master/docs/api.md

MINING — KEEP GREEN'S EXISTING WORK

GREEN reports mineKnownOre and planOreSearch implemented with 81 targeted tests but NO live MineProbe run. Its existing mineflayer-tool integration equips a suitable harvest-tier pickaxe and uses BLUE's shared mineflayer-pathfinder; mining undiscovered ores and two-bot concurrency remain unverified. Inspect mineflayer-collectblock as a reference only; GREEN reported that installing it as-is can turn on unsafe digging and chest tool pulls. Do not install competing pathfinding stacks, auto-reveal hidden ore, /setblock ore or assign a permanent miner. https://github.com/PrismarineJS/mineflayer-tool | https://github.com/PrismarineJS/mineflayer-pathfinder | https://github.com/PrismarineJS/mineflayer-collectblock

WORLD TRAVERSAL AND TERRAIN AWARENESS — BLUE OWNS

Preserve one shared mineflayer-pathfinder integration for home, farming, fishing and mining. BLUE should complete the user-requested controlled movement: one-second stall check; brief forward attempt at doors, interact only when a closed wooden door truly obstructs; safe forward+jump on verified one-block terrain; otherwise remember observable obstacle coordinates and replan around it. Avoid lava and magma, safely retreat from imminent lava and permit real, authorized block placement only after checking footing, lava flow and return route. prismarine-viewer may visualize surrounding blocks and movement during debugging; it is not a complete citizen memory or a server-side map of unseen blocks. https://github.com/PrismarineJS/mineflayer-pathfinder | https://github.com/PrismarineJS/prismarine-viewer

FARMING — PRESERVE CHECKPOINT

BLUE reported the FarmProbe full-cycle physical farming PASS and checkpoint 7d3e645; do not replace its existing farm skills. mineflayer-farmbot and Sprout are source references, not separate bots to add to the civilization. Farming a known test plot does not prove autonomous citizens choose a farm or coordinate food needs. https://github.com/JagritThukral/mineflayer-farmbot | https://github.com/kxnqss/sprout

ITEM INTERACTION — USE EXISTING PERMISSIONS

GREEN should audit existing actual item pickup, equip/use (rod, pickaxe, hoe, food), recipe crafting, furnace with real fuel, bot.openContainer, deposit/withdraw exact quantities, inventory deltas and SQLite private versus communal chest permissions before adding wrappers. Use actual vanilla items. A designated personal chest is not physically private in vanilla Minecraft; enforce access in simulation. https://github.com/PrismarineJS/mineflayer/blob/master/docs/api.md

AGENT HANDOFF AND TEST SCHEDULING

BLUE: finish HomeProbe, movement/door/jump/stall recovery and stable bedtime/return-home interfaces. Provide GREEN with navigation, position, cancellation, return-trip/ETA, claimed-home destination and curfew-check contracts, marking any still unimplemented. Do not overwrite GREEN's skills or declare simultaneous two-bot PASS from a single probe.

GREEN: audit current fishing/item APIs, implement bounded fishing and optional real-fish cooking/storage as minimal new skill work, retain mining code, unit-test cancellation and bedtime integration; prepare but do not launch FishProbe/MineProbe while BLUE owns WORLD-LAB. Deliver docs/GREEN_FISHING_AND_ITEMS.md with exact test evidence, dependencies and blockers.

RED: once BLUE expressly releases exclusive WORLD-LAB access, scout verified solid-shore fishing fixture with safe spectator and authorized communal/test chest; separately identify a safely reachable naturally generated visible coal/iron site outside Site C and the old farm patch; verify walking routes and bedtime return budgets. Do not manufacture ore or modify the village. Deliver docs/RED_RESOURCE_TEST_SITES.md and obtain approval before mutation.

TEST ORDER: (1) BLUE single HomeProbe live gate; (2) RED site handoff; (3) GREEN single FishProbe and MineProbe live tests in separate approved windows; (4) two distinct temporary bot identities concurrently with verified safe return by Minecraft tick 12000. No pnpm sim:start/full five-citizen run, and no assertion of production readiness until live evidence exists.

MINDCRAFT BODY BAKEOFF — POSSIBLE MOVEMENT REFERENCE, NOT A SILENT REPLACEMENT

The previously evaluated MindcraftProbe (Mindcraft + Mineflayer with local Ollama qwen3.5:9b) visibly moved, chopped wood, crafted basics, ate and fought on a separate throwaway Paper 1.21.4 server on port 25566. That session did not establish a stable five-bot society or actual 1.21.11 gameplay; chat-spam kick, placement/tool selection, drops, disconnect stability and task control were unresolved. The active civilization body remains MechProbe on Paper 1.21.11. Mindcraft's current official README advertises support up to Minecraft Java 1.21.11 but recommends 1.21.6: advertised support is NOT our own verified 1.21.11 pass. https://github.com/mindcraft-bots/mindcraft

Optional research-only side-by-side movement bakeoff should run in an isolated test instance/port and separate identity after agent coordination; do not swap MindcraftProbe into the active civilization, reuse 25565, or modify WORLD-LAB without an approved test window. Keep insecure LLM code execution disabled (allow_insecure_coding=false).

### 13  📌  IMPLEMENTATION CHECKPOINT — 2026-09-19 (README SOURCE OF TRUTH)

STATUS BASIS: The results below are reported by the user's local Cursor agents BLUE, GREEN and RED; the user also personally observed MineProbe mining coal, depositing it, and leaving. This is an evidence-based project checkpoint, not an independent audit of current GitHub HEAD or a claim that all five citizens are already autonomous. Treat earlier 'not yet tested' notes and old body-candidate discussions elsewhere in this evolving document as historical snapshots where they conflict with this dated update.

#### ENVIRONMENT AND PROTECTED WORLD

Current isolated test environment: Minecraft Java / Paper 1.21.11-132; WORLD-LAB seed 20260919, game port 25567, RCON 25577. Site C is the starter village near -1032,64,888. RED installed five empty ordinary single personal-chest fixtures in houses H1/H2/H4/H5/H9, preserved other houses, beds and communal tannery chest. Paper's original civilization server 25565 and the separate Mindcraft experiment on 25566 are not the WORLD-LAB test server. Do not run pnpm sim:start as part of the disposable probe gates. World changes are real, persist across probes and are not reset casually.

#### COMPLETED OR DIRECTLY REPORTED SINGLE-BOT PHYSICAL GATES

FARMING — BLUE reported a complete isolated FarmProbe live cycle: 9/9 cells planted, naturally grown under temporarily accelerated randomTickSpeed=300, harvested and replanted; 8 actual wheat collected, bread crafted, transferred/stored and eaten as part of the test. Tick speed was restored to 3; no /give wheat/bread or /setblock mature wheat. Reported farming checkpoint commit: 7d3e645. This demonstrates one physical test body's farming actions, NOT autonomous citizen selection of farming or a five-person food economy. Evidence pointers: docs/BLUE_FARMING_REUSE_EVALUATION.md and docs/BLUE_AGRICULTURE_LIVE_RUN_6.log.

HOME / SLEEP / STORAGE — BLUE reported live HomeProbe PASS in WORLD-LAB: walked village paths to the assigned H1 stoop (-1095.6,69.0,732.5) rather than a nearer house, entered through an already-open oak door without toggling it, and slept at designated yellow-bed HEAD (-1097,69,728). Deposited and withdrew paper in own H1 personal chest (-1096,69,729); H4 chest access was denied; communal tannery bread and leather helmet remained unchanged. Home claim survived disconnect and replacement body walked back to H1 interior. Missing-bed scenario failed explicitly as BED_MISSING, without destroying furniture. These are single-probe tests; all five citizens independently choosing/using homes remains unproven. Evidence: docs/BLUE_HOME_LIVE_TEST.md.

MINING / CHEST DEPOSIT — GREEN reported live MineProbe PASS on Paper 1.21.11-132. A probe at standing origin (-953,58,945) itself observed naturally generated exposed coal_ore at (-953,58,946), mined it using one explicitly test-provided wooden pickaxe, picked up one real coal, and deposited it in the RED-approved dedicated single test chest (-954,58,944). Post-run server readback showed the mined ore cell became air and chest slot 0 contained minecraft:coal count 1; inventory 0→0 after the stored deposit. No manufactured ore, /give coal, or hidden ore survey fed to the probe; temporary OP was removed and no forceload remained. The user witnessed digging, coal deposit and exit. This proves ONE bounded natural-ore operation and storage, not general cave exploration, tool acquisition, autonomous ore choice, safe nighttime return or repeated full-scale mining. Evidence: docs/GREEN_MINING_LIVE_RUN.md; RED fixture record: docs/RED_GREEN_MINING_TEST_HANDOFF.md. Do NOT reset the test world or rerun on the already mined ore cell.

#### IMPLEMENTED / UNIT-TESTED BUT NOT FULLY LIVE-VERIFIED

ORE SKILLS — GREEN reports 81 targeted tests for mineKnownOre and planOreSearch; the citizen supplies a resource and bounded search area, while the body checks visibly exposed ore, line of sight, tool/harvest tier, hazards and legitimate item transfer. Ore elevation/biome knowledge is statistical, not exact vein coordinates or a server-world X-ray. mineflayer-tool 1.2.0 and BLUE's mineflayer-pathfinder 2.4.5 were reused; collectblock was inspected, not installed, due to unsafe canDig/chest-tool behavior in this context. Live PASS scope is the specific coal extraction above.

FISHING / ITEMS — GREEN implemented fishShore, furnace helpers and executor wiring for fishing plus claimed-bed returnHome on mining/fishing; nine fishing unit tests reportedly pass. FishProbe has NOT run live and no real caught fish, cooking or authorized fishing-storage transfer has been established in WORLD-LAB. Files reported: packages/skills/src/fish.ts, fish.test.ts, furnace.ts, furnace.test.ts, index.ts and packages/agent-core/src/executor.ts. Source-review document: docs/GREEN_MINDCRAFT_RESOURCE_REUSE.md. RED's safe-shore fixture and an exclusive live test window are next gates.

SHARED MOVEMENT — BLUE reports approximately one-second progress/stall checks with waiting exemptions, a recovery lock, halt-then-forward+jump, observable obstacle-coordinate mapping/replanning, smart wooden-door interaction, lava halt/retreat/bypass, opt-in real-inventory hazard bridge, magma avoidance, cancellation controls, and evaluateReturnHome/HAZARD_BLOCKED/MiningRequest.returnHome interfaces implemented and unit-tested. H1 already-open-door behavior passed LIVE. Closed-wooden-door opening remains LIVE-UNVERIFIED. At disposable pad (200,67,400), the 1.21 player_input hop started but one-block elevated landing FAILED; one lava-detour live attempt fell in a pit. Do not claim reliable terrain/lava handling or autonomous cave safety until both are corrected and retested. Evidence: docs/BLUE_HOME_LIVE_TEST.md and BLUE's subsequent movement report.

BEDTIME — Proposed adjustable Minecraft-day schedule: target arrival at the citizen's own home before tick 12000 (sunset), attempt own-bed sleep at tick 13000 when permitted. Return-trip ETA, claimed home and mining returnHome contracts reportedly pass unit tests. No MineProbe/FishProbe has demonstrated an end-to-end timed work→early departure→walk home→own-bed sequence LIVE. A probe exiting its mining test area is not proof it returned home before bedtime.

#### MINDCRAFT REUSE AND THIRD-PARTY ATTRIBUTION

BLUE inspected upstream mindcraft-bots/mindcraft develop commit 5f3acc87 (reported MIT; copyright 2024 Kolby Nottingham), compared pathfinder 2.4.5, upstream Mineflayer ^4.33.0 vs our 4.39.0, and kept the current shared MechProbe navigator. Smoothness was attributed to settings plus an upstream node_modules patch, not a proven Java 1.21.11 input fix. BLUE reports only the prior canOpenDoors=true adaptation remains; other navigation/cheat patterns were rejected. BLUE reported README.md and THIRD_PARTY_NOTICES.md updated; GREEN reviewed Mindcraft resource patterns but copied NO Mindcraft source. Attribute accurately: Mindcraft was studied as a reference; do not claim its code powers our farming, mining or fishing without a documented actual copy. License: https://github.com/mindcraft-bots/mindcraft/blob/develop/LICENSE; review local notice and git diff before publishing.

#### CURRENT BLOCKERS AND NEXT REAL MILESTONE

1) BLUE: fix one-block jump LANDING and unsafe lava/pit-detour cell selection, with bounded retries and fail-closed hazard handling; live-test closed-door opening, cancellation and timed return-home from a work site, preserving passing H1/farming behavior. 2) RED: after exclusive WORLD-LAB handoff, document a safe shore, authorized FishProbe test container, walkable village return route and spectator position; no unapproved new structures, natural-ore fabrication or test-world reset. 3) GREEN: preserve the verified mining checkpoint/evidence, run guarded single FishProbe only after RED's fixture and exclusive approval, recording real catch/inventory/chest states and curfew. 4) INTEGRATION: only after safe movement/return-home and separate skill gates, test TWO distinct temporary bodies simultaneously with separate identities, designated chests, independent actions and genuine return/sleep. 5) EXPERIMENT 1: connect high-level intentions and separate SQLite citizen identity/memory to reliable physical skills; introduce five citizens without assigned jobs, then observe an evidence-backed multi-day social/survival run. Never equate single-probe success with five-citizen autonomous society.

#### README-READY PROGRESS SUMMARY — COPY / ADAPT AFTER REPO CHECK

Minecraft AI Civilization is a local-first experiment in five independent, persistent Minecraft citizens who may choose their own work, homes and social relationships. Citizen minds choose WHAT to do; bounded Mineflayer skills perform HOW; real Minecraft world and inventory changes verify results. The starter village is an experimenter-provided scaffold, not AI-built civilization. The current development environment uses an isolated Paper 1.21.11 WORLD-LAB, a TypeScript/pnpm skill stack and persistent SQLite home claims.

Live milestones demonstrated in separate tests: (1) a complete physical wheat farm cycle with verified harvest/replant and food handling; (2) an assigned-home probe navigating through a real village door to its recorded bed, using its own chest and retaining its home claim after reconnecting; and (3) a natural-coal mining probe extracting one actual ore, collecting the dropped coal and depositing it in a dedicated test chest. The mining test used an explicitly test-provided wooden pickaxe; none of these single-bot probes proves independent citizen task selection.

In progress: fishing and furnace/item skills (unit-tested, not live-proven); terrain-awareness, controlled jumping and lava/magma avoidance (one-block landing and one unsafe detour remain live failures); a curfew-aware return-home routine (unit-tested, not live-proven); and concurrent two-bot integration. Five-citizen autonomous survival, spontaneous specialization, resource sharing, emergent institutions and a three-Minecraft-day experiment are goals, NOT current achievements. Third-party Mineflayer/Mindcraft references and licenses are documented separately. Evidence and test results are retained in docs/BLUE_HOME_LIVE_TEST.md, docs/GREEN_MINING_LIVE_RUN.md and related probe reports.

Publication check before changing GitHub README: verify the local repository's current commit, exact dependency/license files, screenshots/logs and failing/passing tests; distinguish this dated agent/user-reported checkpoint from the state of any unmerged feature branches. Do not present the newly written Google Doc section as proof that the GitHub README has already been edited or pushed.

### 14  📸🎬  CONTROLLED SHOWCASE CAPTURE POLICY — LINKEDIN / GITHUB

USER DECISION — DO NOT RECORD ROUTINE DEVELOPMENT RUNS. The project owner wants screenshots and video only after a feature demonstrably works and a controlled, reproducible showcase is ready. Do not request filming while a probe is still experimental, fails, lacks a fixture, or waits for approval. Only after a verified live PASS, identify whether the milestone deserves a screenshot, video, both, or neither. Give explicit alerts to the user in ALL CAPS: “TAKE A SCREENSHOT” and “RECORD A VIDEO” when the right moment arrives.

#### CAPTURE GATE — WHAT MUST BE TRUE FIRST

(1) An agent provides an actual live test result and logs/world/inventory evidence; unit tests, a generated implementation, or a test fixture alone are not a filming trigger. (2) The result is reproducible with an approved, non-destructive starting state, safe spectator camera and known test duration; do not reset or restore older worlds over current progress to manufacture footage. (3) The requested action can be observed end-to-end without invented drops, teleports portrayed as autonomous travel, or OP/RCON test controls passed off as citizen skills. (4) The human knows what the replay will show, when to start/stop recording, and what proof screenshot to collect. Filming may be declined if the feature is already documented or footage adds no useful information.

#### CURRENT FISHING GATE — NOT YET A SHOOT

RED reports legal fishing shore FISH_TEST_ORIGIN=-1043,63,980 with dry standing ground and water to the west. An empty test chest at -1042,63,980 is proposed and awaits actual placement/readback under explicit user approval. When Red last checked, WORLD-LAB Paper was down; Green's guarded pnpm mechanics:fish had not started. GREEN reports ten fishing unit tests and a ready harness; FISHING_LIVE and RETURN_HOME_LIVE are not yet a live PASS. DO NOT RECORD THE FIRST FISHPROBE ATTEMPT OR TAKE A SCREENSHOT JUST BECAUSE A CHEST WAS INSTALLED. After Red confirms installation, Green may test normally. If the full fishing workflow passes and a safe repeat is feasible, schedule a short controlled showcase showing real rod cast → real catch/pickup → actual item deposited in the permitted fishing chest; capture the terminal result and chest item count as evidence only after the run.

#### SUCCESSFUL EARLIER PROBES — OPTIONAL REPLAY, NOT AN URGENT SHOOT

FarmProbe, HomeProbe and MineProbe already have separately reported physical successes. These do not require immediate replays; schedule a controlled video only when there is a clear public story and the original working state can be reproduced without endangering the world, confusing test-provided materials with citizen acquisition, or rerunning mined-out ore. Good candidate: a citizen walking the village path to its claimed home, opening/using only permitted storage and sleeping in its own designated bed. Mining footage must use a separately approved naturally generated exposed ore site, not fabricate or replace the already mined coal.

#### CAPTURE MOMENTS AFTER FUTURE LIVE GATES

FIRST LIVE FISHING PASS: If a controlled repeat is approved, say “RECORD A VIDEO” before the verified showcase cast; after genuine chest deposit, say “TAKE A SCREENSHOT” for the item in the chest and the result/log. Avoid film prompts if casting/pickup/deposit still fails.

FIRST TWO-BOT CONCURRENT PASS: Only after two distinct simultaneous bodies successfully perform approved tasks without interference, schedule “RECORD A VIDEO” of both physically active at once; “TAKE A SCREENSHOT” of the two visible named bodies plus the independent success evidence. Do not film merely because two bots connected.

FIRST COMPLETE WORK→HOME→SLEEP PASS: After a late-day work task, actual early departure, walk to its OWN claimed house, valid own-bed sleep and reliable exit are proven, schedule “RECORD A VIDEO” with the work site, homeward walk and sleep in sequence; a standalone early-day H1 entrance walk does not pass this whole gate.

FIVE-CITIZEN TRIAL: Only when all five independently running citizens have completed the first approved multi-day survival/social gate, say “TAKE A SCREENSHOT” of the five named citizens in the actual settlement and “RECORD A VIDEO” showing distinct chosen tasks or a genuine interaction. Do not equate human-provided starter houses, one-off bot probes or canned chat with emergent social behavior.

#### SHOOT PROCESS AND PUBLICATION RULES

Before any controlled replay: preserve the original successful test logs and current world backup, agree on an exclusive lab or protected world window, decide the vantage point and exact user-visible prompt, and avoid another agent mutating the same fixture. Film only approved actions, retain the raw footage and corresponding commit/test identifiers, and edit a short public clip after collecting actual evidence. In captions and GitHub/LinkedIn posts, distinguish test-control supplies, human-built fixtures, single-bot physical ability, five-citizen autonomy, and still-failing behaviors. The assistant should call out ALL-CAPS capture instructions only for verified, worthwhile showcase opportunities—not after every agent report.

#### LATEST STATUS CORRECTION FOR THE 2026-09-19 CHECKPOINT

Later BLUE report supersedes the earlier movement-failure snapshot in section 13: safe one-block jump LANDING now live PASS (201.2,68.0,400.4 on the disposable pad); focused lava and magma handling returned HAZARD_BLOCKED without entering them; a separate HomeProbe physically walked from a test-controlled work origin to claimed H1 entrance at Minecraft clock 1778. However, the two-block oak-log detour still timed out, the return-home harness suffered a post-walk keepalive/disconnect hang before lifecycle correction, and the early-day home-arrival test did NOT establish late-day work-to-own-bed sleep. GREEN mining was checkpointed at commit e7d594d. These scoped changes belong in future README edits; no two-bot, live fishing, full curfew/sleep or five-citizen PASS has been established by the reports available here.


### 15  ☁️  CLOUD DEVELOPMENT FREEZE & MAIN-PC TRANSPLANT — 2026-10-13

STATUS: CLOUD WORK COMPLETE / MAIN-PC INTEGRATION NOT STARTED

This section records the October 2026 Cursor Cloud reports for the Minecraft AI Civilization project. It supersedes older implementation-status summaries where they conflict, but preserves earlier test history. All cloud PASS claims below mean reported unit/static/test-harness results, NOT witnessed Minecraft behavior, unless a separate historical LIVE PASS is explicitly named. The cloud/public branch differs from the richer main-PC working tree; public main is not a substitute for inspecting the main-PC files and databases.

#### CLOUD PASSES 1–6 — REPORTED DELIVERABLES

PASS 1 — 81/81 tests; typecheck PASS. Provider-neutral ModelRouter with Ollama/Gemini/NVIDIA NIM adapters and bounded retry/fallback; action tracing; fail-closed property guards; bounded water safety; housing edge cases; fishing regression harness; guarded one-citizen WORLD-LAB dry-run. No real server/bot interaction.

PASS 2 — 85/85 tests; typecheck PASS. Separated eight logical commits and created docs/CLOUD_TO_MAIN_TRANSPLANT.md. Added mocked provider failure matrix, cognition output contract, property/water failure cases, trace invariants and launcher guard matrix. Explicitly separated safe new-file cherry-picks from risky edits requiring manual transplant.

PASS 3 — 102/102 tests; typecheck PASS. CitizenBrain with bounded deterministic cognition input; WHAT/WHY-only decision schema; citizen-specific relevant memory retrieval; evidence-based learned tendencies with confidence/decay; directional relationship beliefs; commitments; decision cooldowns; social speech gating; NO_LLM/routine/important/deep-reflection routing; subjective mood vs belief vs objective truth separation; synthetic multi-citizen scenarios. CitizenBrain was not connected to the richer main-PC AgentManager.

PASS 4 — 121/121 tests; typecheck PASS; commit cb7861d. Added durable brain persistence for commitments, directional relationships/evidence, learned behavior evidence and high-level cognition state; idempotent event application; transaction boundaries after independently verified Minecraft events; CitizenBrainAdapter behind CITIZEN_BRAIN_V2_ENABLED=false; per-citizen model budgets, optional global budget; restart scenarios and temp-DB migrations. New tables: commitments, relationship_beliefs, relationship_belief_evidence, learned_behavior_evidence, cognition_state and brain_applied_events. Legacy tables reportedly preserved.

PASS 5 — 129/129 tests; typecheck PASS; commit 73c0429. Durable model usage-budget accounting with llm_calls counts_toward_budget / decision_id / mc_day fields; structured item-transfer commitment predicates requiring positive integer quantity and verified evidence; commitment_progress_events ledger; BrainReconciler; deterministic replayBrainState; event provenance (source_event_id and effect_role); durable pending_reconsideration; reconsideration precedence; read-only schema preflight. New tables: commitment_progress_events, pending_reconsideration. Additive changes to llm_calls and relationship_belief_evidence require schema reconciliation.

PASS 6 — 133/133 tests; typecheck PASS; freeze commit 863a7c5, accompanying commits 73aed78 and ce55b9b. Added .github/workflows/ci.yml to install/typecheck/test without Minecraft or secrets; CI secret-independence test; docs/MAIN_PC_INTEGRATION_RUNBOOK.md; docs/TRANSPLANT_ORDER.md; docs/PUBLIC_MAIN_COMPARISON.md; docs/CLOUD_FREEZE.md; pnpm cloud:integration-check (reported exit 0); pnpm cloud:db-copy-check; read-only BrainReconciler.report()/dryRun mode. Workflow creation is reported; independently verify GitHub check results before treating hosted CI as green.

#### FREEZE / SOURCE CONTROL STATUS

Draft PR #3: https://github.com/ManpreetS2/Minecraft-Ai-Civilization/pull/3. Its base is cursor/cloud-dev-skeleton-07c8, NOT the richer main-PC branch. PR is marked “TRANSPLANT SOURCE — NOT DIRECT MAIN MERGE”; it was NOT merged. Cloud branch is frozen. No Pass 7, broad features, speculative AgentManager rewrite, or direct merge from the laptop. Preserve commits, manifests and reports as source material for a deliberate integration.

Reported final cloud checks: typecheck PASS; 133/133 tests PASS; cloud integration check exit 0; CI workflow and no-secrets unit verification implemented; DB-copy and reconciler dry-run harnesses prepared. LIVE_TESTS_RUN=NONE. REAL_DATABASES_MODIFIED=NONE. No Paper startup, RCON, bots, time/weather/gamerule changes, WORLD-LAB mutation or production DB migration was performed during these cloud passes.

#### ALREADY WITNESSED ON THE SEPARATE MAIN-PC BASELINE — DO NOT MISATTRIBUTE TO CLOUD

Existing controlled live mechanics include a FarmProbe wheat/food cycle; an H1 HomeProbe walk/bed/personal chest and reconnect check (temporary test identity, NOT a genuine citizen choosing/claiming H1); natural coal extraction with test-provided pickaxe and real chest deposit; safe one-block jumping and two-block obstacle detour; bounded hazard handling; and Kai + Atlas simultaneous owner-aware fishing with 2 new catches deposited per body. These are isolated controlled successes, not evidence that the cloud branch was live tested, that real citizens have persisted homes, or that five citizens have completed an autonomous multi-day society trial. Re-run fishing/navigation only when integration changes affect their actual live code paths.

#### INTEGRATION BLOCKERS — MAIN PC ONLY

1. Record the exact current main-PC repository SHA and working-tree state; do not use public main as a stand-in. Snapshot/back up the original main-PC civilization and WORLD-LAB databases and relevant working files. Never experiment on the original SQLite databases.

2. Work on a dedicated integration branch. Read docs/MAIN_PC_INTEGRATION_RUNBOOK.md and docs/TRANSPLANT_ORDER.md. Reconcile the true main-PC schema, especially dual relationships vs directional beliefs, schema_migrations version/order, llm_calls columns, event-id/provenance assumptions, and richer manager/fishing/home/navigation interfaces.

3. Run read-only schema preflight against an explicitly made DB COPY; inspect primary keys, table/column names, migration collisions and existing data. Test brain_persistence_v2 and later additive schema changes only on copies or temporary databases. Refuse migration on ambiguity; do not silently overwrite/reset legacy history.

4. Transplant dependency-aware waves, favoring isolated new files first. Manually integrate shared config/events/exports, cognition router/index/ollama wiring, store/persistence/migrations, property and water hooks, agent-core executor and launcher scripts. Do not blind-cherry-pick everything or directly merge draft PR #3. Run typecheck and tests after each wave.

5. Keep CITIZEN_BRAIN_V2_ENABLED=false while integrating CitizenBrainAdapter into the real AgentManager tick. Preserve emergency NO_LLM reflexes, verified-world-before-SQLite semantics, per-citizen state isolation, no preset occupations, and existing real fishing/home/navigation stacks. A recorded commitment may complete only after matching verified physical evidence; inventory plus SQLite is NOT an atomic transaction.

6. Re-run pnpm typecheck, pnpm test, pnpm cloud:integration-check where applicable, pnpm cloud:db-copy-check on copies, and the reconciler dry-run; log discrepancies and reconcile before any real runtime feature enablement. ModelRouter/NVIDIA smoke tests need a real key and may be rate-limited or chargeable; do not assume all NVIDIA catalog models are free.

7. Only when the user explicitly says live testing is possible, use the guarded isolated one-citizen WORLD-LAB workflow (127.0.0.1:25567 and separate world-lab-civilization.sqlite; verify launcher behavior against real branch). Never use bare pnpm sim:start with unsafe .env values, protected 25565/25566 servers, role forcing, unapproved teleports/time changes/fixtures or unobserved automated testing.

#### LIVE GATES STILL OUTSTANDING AFTER MAIN-PC INTEGRATION

Cloud property denial/replan against another citizen's protected chest or home block; safe water fall/shore/air recovery; Atlas autonomously traveling from saved pond position toward eligible housing via catalog knowledge, then physically reaching claim range and making a genuine persisted claim; late-day curfew interruption, real walk to that claimed home, WAIT_INSIDE_HOME if early and sleep in that citizen's bed without test time-setting; an observed continuous guarded Atlas day; cloud-change regression of any changed fishing/navigation behavior; optional cost-aware NVIDIA API smoke. None of these is proved by 133/133 synthetic/cloud tests.

#### NEXT MILESTONE / FREEZE DECISION

CLOUD DEVELOPMENT = COMPLETE. CLOUD BRANCH = FROZEN. PR #3 = DRAFT TRANSPLANT SOURCE ONLY. MAIN-PC INTEGRATION = READY TO BEGIN AFTER MAIN-PC SHA AND DB-COPY PREFLIGHT. CLOUD ADDITIONS LIVE VERIFICATION = NOT STARTED. Full five-citizen autonomous survival/social behavior and the three-Minecraft-day trial remain future gates. Do not manufacture progress or replace physical world evidence with model narration or unit tests.

## NEW OPEN-SOURCE REFERENCE GATE — MINECRAFT BODIES & SOCIAL SIMULATION (24 OCTOBER 2026)

Decision: research these three external projects as bounded references only. They are NOT installed or integrated and must not supersede the existing five-citizen Paper/Mineflayer runtime, settled navigation, isolation rules, persistence, or live-test gates. Current priority remains main-PC integration, database-copy preflight, and safe one-citizen WORLD-LAB verification.

### MINECRAFT FOR ASTRA — TOOL/BODY REFERENCE (EVALUATE, DO NOT REPLACE)

Repo: https://github.com/teletemagame-dev/minecraft-for-astra

What to study: Mineflayer-based toolbox with 23 exposed actions, six triggers, follow/stop, targeted navigation, collect/dig/place, crafting/smelting, survival reflexes, error messages, and integration tests. Especially useful: reflexes that handle hazards quickly without an LLM call; bounded action contracts; navigation stagnation detection; missing-resource failures that explain the next safe step; third-party chat isolation.

Integration gate: independently compare individual adapters/ideas against existing Green/Blue implementation and real Paper 1.21.11 behavior. Do not install the Astra host/plugin or introduce a second planner/brain; reuse only small tested algorithms through current citizen body adapters. MIT license with AIRI-derived notices; preserve attribution if copying.

### CODEX MINECRAFT GAMEPLAY — VISION-ONLY CONTROL EXPERIMENT

Repo: https://github.com/wz1119/Codex-Minecraft-Gameplay

What to study: Windows screenshot → agent decision → bounded keyboard/mouse control, explicit observation before/after actions, guarded sequences, progress/stall checks, stop controls, and synthetic-image tests. It does not expose Minecraft world state or supply an autonomous planner.

Best fit: isolated separate vision-only probe or future benchmark versus the structured Mineflayer body. NOT the main movement loop for five citizens: screenshot-based control needs an interactive Windows client, can consume substantial model calls, and must never be allowed to mutate the real settlement or access hidden world data during blind tests. Apache-2.0 license. If tested, use a disposable world and measure success, latency, resource use, and recoverability.

### MIROFISH — PERSISTENT SOCIAL-AGENT DESIGN REFERENCE

Repo: https://github.com/666ghj/MiroFish

What to study: graph-building from seed material, agent personas, temporal social interactions, relationship/memory mechanisms, scenario injection, simulation reports, and inspection of individual agents. Candidate ideas for the civilization's relationship/evidence ledger, memory retrieval, competing narratives, rumor propagation, social dynamics, and admin visualization.

Hard boundary: MiroFish simulates social behavior through CAMEL OASIS and Zep Cloud; it is not a ready-made Minecraft physics/body engine. Its simulated outcomes are hypotheses, not validated real-world predictions; prevent a central simulator or narrator from dictating citizens' motivations or revealing omniscient state. Costs can increase with agent count/rounds; it needs separate LLM API and Zep credentials. AGPL-3.0: favor independent implementation of concepts or license review before code reuse.

### DETERMINISTIC EVALUATION BEFORE ADOPTION

1. Produce a one-page mechanism comparison against our existing navigation, brain persistence, low-level reflexes, and event contract. 2. Identify a concrete failing local test that the external reference could help solve. 3. Build a single narrow prototype on copies/throwaway worlds only. 4. Verify permissions, rate limits, no X-ray/hidden-state access, bounded costs, citizen autonomy, and unchanged existing tests. 5. Adopt only if measured results beat or materially simplify existing code; document license and provenance in the project map.

Cross-project observation: MiroFish's relationship graph / temporal event display may also inspire Agent Mindmap visualization, but that is a separate codebase and requires an independent requirements review. No Agent Mindmap integration is authorized by this note.
