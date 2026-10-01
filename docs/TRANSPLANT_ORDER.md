# Transplant Order (Cloud Passes 1–5)

**Branch tip:** `cursor/brain-persistence-07c8` @ `73c042989d2ba5b7f6c864f37db3d8c36106e187`  
**Public main base for these commits:** `15c13c885a825deb0f83a9386f2270fb05711689`  
**PR #3 base:** `cursor/cloud-dev-skeleton-07c8` — **not** main-PC `main`.

Do **not** cherry-pick all blindly. Apply bottom-up in dependency order. Prefer additive files first; manually merge conflict-prone runtime files.

---

## Recommended waves

### Wave 0 — Foundations (Pass 1 shared)

| SHA | PURPOSE | DEPENDENCIES | SAFE CHERRY-PICK? | MANUAL MERGE? | EXPECTED CONFLICT FILES | TESTS AFTER |
| --- | --- | --- | --- | --- | --- | --- |
| `acb803e516f7abdace0140a87f8cd429238135f7` | Config knobs, error codes, action tracing scaffolding | none | Partial | Yes for `config.ts` / `action-result.ts` / `events.ts` | `packages/shared/src/config.ts`, `action-result.ts`, `events.ts` | `pnpm --filter @civ/shared test` / `pnpm test` |

### Wave 1 — Cognition providers (Pass 1)

| SHA | PURPOSE | DEPENDENCIES | SAFE CHERRY-PICK? | MANUAL MERGE? | EXPECTED CONFLICT FILES | TESTS AFTER |
| --- | --- | --- | --- | --- | --- | --- |
| `e5cf6653bf8efa30bad26dbde7329c0c11b6b2a4` | Provider-neutral `ModelRouter` | Wave 0 | Yes if no local router | Yes if main-PC has provider code | `packages/cognition/src/router.ts`, `index.ts`, `ollama.ts` | `packages/cognition/src/router.test.ts` |
| `15c4d5f799cacb57a9cb59f11e795d3d04562bf0` | NVIDIA NIM + Gemini adapters | Wave 1 router | Yes if absent | Low | new `gemini.ts`, `openai-compatible.ts` | router tests (mocked) |

### Wave 2 — Safety / skills (Pass 1–2)

| SHA | PURPOSE | DEPENDENCIES | SAFE CHERRY-PICK? | MANUAL MERGE? | EXPECTED CONFLICT FILES | TESTS AFTER |
| --- | --- | --- | --- | --- | --- | --- |
| `95ac01a33c0a84755d0e6c9074bf5ec5849810b0` | Fail-closed property protection | shared | Partial (new `property.ts` yes) | Yes for gather/inventory | `gather.ts`, `inventory.ts`, `context.ts` | `property.test.ts` |
| `c7652c02581e7b194be5777d8bc9d2326308ab5e` | Water safety state machine | shared types | **Yes** if absent | Medium if live swim/pathing exists | `pathing.ts` (main-PC), `index.ts` | `water-safety.test.ts` |
| `10c8ddd3138ad8bfe31c7351cf23106b79aaa09c` | Housing planner + action traces in executor | shared traces | Housing module yes | Executor yes | `executor.ts`, `manager.ts` | `housing.test.ts`, `action-trace.test.ts` |
| `9f8d9c7e63e8aefbbd79558341849a8551be8b3c` | Guarded one-citizen dry-run launcher | config | Partial | Yes for scripts | `apps/orchestrator/*`, root `package.json` | `one-citizen.test.ts` |
| `667743fc0bd03698175c05991cb14161d9c92f80` | Fishing regression harness + transplant docs | none for harness | **Yes** as parallel harness only | **Never** replace LIVE fishing | any `mineflayer-fish*` on main-PC | `fishing-cycle.test.ts` |

### Wave 3 — Brain cognition (Pass 3)

| SHA | PURPOSE | DEPENDENCIES | SAFE CHERRY-PICK? | MANUAL MERGE? | EXPECTED CONFLICT FILES | TESTS AFTER |
| --- | --- | --- | --- | --- | --- | --- |
| `b48f2e411c32fcaaa70616ae8ef86edcb64ce14a` | Brain-layer types + cognition events | shared | **Yes** | Low | `events.ts`, `index.ts` | shared tests |
| `e435bf243a4011733ebe549341d41b2931d497d4` | Memory retrieval + learned behavior | brain-types | **Yes** if absent | Index exports | `packages/memory/src/index.ts` | `memory.test.ts` |
| `0a0cedb74a77e17ea13a0af85087ac319526f303` | Asymmetric relationship beliefs + speech gating | society | Beliefs yes | Speech director yes | `packages/society/src/index.ts` | `relationship-belief.test.ts`, `society.test.ts` |
| `871b25ee0a63bb444a841045ac411b0f6fd1ef29` | CitizenBrain input/schema/routing/scenarios | Waves 1+3 | Brain modules yes | `cognition/index.ts`, package.json deps | `packages/cognition/src/index.ts`, `package.json` | `brain.test.ts` |
| `4ac2c6f92bf0bfd537a36cdd77d57b2e6319322e` | Pass 3 transplant docs | docs only | **Yes** | No | docs | n/a |

### Wave 4 — Persistence (Pass 4)

| SHA | PURPOSE | DEPENDENCIES | SAFE CHERRY-PICK? | MANUAL MERGE? | EXPECTED CONFLICT FILES | TESTS AFTER |
| --- | --- | --- | --- | --- | --- | --- |
| `cb7861d55f3c289cfad364f9bdb4cc2d996d4d0c` | Brain SQLite persistence + adapter flag=false | Wave 3 + store | New brain-* files yes | **`store.ts` / `manager.ts`** | `store.ts`, `config.ts`, `.env.example` | `brain-persistence.test.ts`, `citizen-brain-adapter.test.ts` |

### Wave 5 — Integrity (Pass 5)

| SHA | PURPOSE | DEPENDENCIES | SAFE CHERRY-PICK? | MANUAL MERGE? | EXPECTED CONFLICT FILES | TESTS AFTER |
| --- | --- | --- | --- | --- | --- | --- |
| `73c042989d2ba5b7f6c864f37db3d8c36106e187` | Durable budgets, predicates, reconciler, replay, preflight | Wave 4 | New integrity modules yes | migrations + adapter + store | `brain-migrations.ts`, `brain-persistence.ts`, `citizen-brain-adapter.ts` | `pass5-integrity.test.ts` |

### Wave 6 — Hardening (Pass 6; after this freeze commit)

Apply Pass 6 commit (CI, runbook, integration-check, db-copy harness, reconciler dry-run, freeze docs) last. Safe docs/scripts first; no runtime AgentManager wiring.

---

## Anti-patterns

- Do not `git cherry-pick origin/main..cursor/brain-persistence-07c8` as one blob onto main-PC.
- Do not enable `CITIZEN_BRAIN_V2_ENABLED` during Waves 0–5.
- Do not migrate production DB during cherry-picks — use Phase D/E of the runbook.
