# Cloud Freeze Record

**Status:** CLOUD WORK FROZEN for major architecture (Pass 6).  
**Do not** add new civilization systems, economy, government, religion, or AgentManager production wiring from cloud unless a main-PC integration problem specifically requires a fix.

---

## Freeze coordinates

| Field | Value |
| --- | --- |
| Freeze branch | `cursor/brain-persistence-07c8` |
| Last cloud commit (pre-Pass-6 tip) | `73c042989d2ba5b7f6c864f37db3d8c36106e187` |
| Pass 6 freeze commit | `863a7c5d55f7e61400db17f0bfd60caff3da36d3` |
| Public main compared | `15c13c885a825deb0f83a9386f2270fb05711689` |
| PR | [#3](https://github.com/ManpreetS2/Minecraft-Ai-Civilization/pull/3) **DRAFT — TRANSPLANT SOURCE** |
| PR base | `cursor/cloud-dev-skeleton-07c8` (**not** main-PC `main`) |

---

## Validation at freeze

| Check | Result |
| --- | --- |
| `pnpm typecheck` | PASS |
| `pnpm test` | PASS — **133** tests (Pass 6 hardening included) |
| `pnpm cloud:integration-check` | PASS (exit 0; may warn on default DB path / port) |
| Live Minecraft / Paper / RCON | **NONE** |
| Real DB mutation | **NONE** |
| PR merged | **NO** |

---

## Feature flags (safe defaults)

| Flag | Default | Note |
| --- | --- | --- |
| `CITIZEN_BRAIN_V2_ENABLED` | **false** | Must stay false until main-PC Phase F–G |
| `LLM_ENABLED` | false | CI forces false |
| `AUTO_START_PAPER` | true in schema default | Cloud CI sets false; do not start Paper in cloud |
| Model budgets | `LLM_MAX_*` | Durable via `llm_calls` |

---

## Schema versions

| Migration name | Purpose |
| --- | --- |
| `brain_persistence_v2` | Core brain tables |
| `brain_integrity_v3` | Budgets, progress ledger, pending reconsider, provenance |

---

## Cloud-only assumptions

1. Public/`cursor/*` tree is a **subset** of possible main-PC reality.  
2. All persistence tests use **temp SQLite** only.  
3. Provider tests are **mocked** — no NVIDIA/Gemini/Ollama required.  
4. Water safety / fishing-cycle / housing planner are **not** proven live on this branch.  
5. `CitizenBrainAdapter` is **not** wired into production `AgentManager`.  
6. Minecraft inventory and SQLite are **not** one distributed transaction.  
7. WORLD-LAB and `data/civilization.sqlite` are forbidden mutation targets in cloud.

---

## Known unverified runtime behavior

- Live Mineflayer pathing + water recovery integration  
- Live property denial against real chests/homes  
- Live fishing concurrency (main-PC baseline may already prove this)  
- Curfew → own-home sleep autonomy  
- ModelRouter against real NVIDIA/Gemini endpoints  
- AgentManager tick + CitizenBrain together  
- Reconciler against a real main-PC event history volume  

---

## LIVE evidence that existed **before** cloud work

Documented elsewhere as **LIVE PASS — EXISTING MAIN-PC BASELINE** (not re-proven in cloud):

- Concurrent fishing (Kai + Atlas) on main-PC runtime  
- Other main-PC milestones recorded in README / prior reports  

Cloud unit harnesses must not be cited as that live proof.

---

## What must happen on main-PC next

1. Follow `docs/MAIN_PC_INTEGRATION_RUNBOOK.md` Phases A→H.  
2. Use `docs/TRANSPLANT_ORDER.md` waves — not blind PR merge.  
3. Schema preflight + migrate **copies** only (`pnpm cloud:db-copy-check`).  
4. Keep `CITIZEN_BRAIN_V2_ENABLED=false` until unit/dry-run green.  
5. Manual live verification only in Phase H.  
6. Keep PR #3 draft; do not retarget to `main` as a shortcut.

---

## Pass 6 hardening delivered at freeze

- GitHub Actions CI (`typecheck` + `test`, no Minecraft/secrets)  
- `docs/MAIN_PC_INTEGRATION_RUNBOOK.md`  
- `docs/TRANSPLANT_ORDER.md`  
- `docs/PUBLIC_MAIN_COMPARISON.md`  
- `pnpm cloud:integration-check` (read-only)  
- DB copy harness + `pnpm cloud:db-copy-check`  
- `BrainReconciler` dry/report mode  
- This freeze document  
