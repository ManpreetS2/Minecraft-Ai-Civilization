# Operator Pre-Flight Checklist: Live 1v1 Survival Trial

**Applicable Stage:** Future Authorized Live Gate A 1v1 Survival Test  
**Prerequisite:** All 21 offline verification tests in `experiments/gate-a-provider-readiness/` passing.  
**Rule:** Do NOT proceed with this checklist until written owner authorization has been granted.

---

## Phase 1 — Environment & Secret Configuration

- [ ] **1.1 Dedicated API Keys Acquired:**
  - [ ] OpenAI Platform Project API key (`sk-proj-...`) with prepaid credit balance at `platform.openai.com`.
  - [ ] Anthropic Console API key (`sk-ant-api03-...`) with prepaid credit balance at `console.anthropic.com`.
  - [ ] CONFIRMED: Neither key is a ChatGPT subscription session token or a Claude Code OAuth token (`sk-ant-oat...`).
- [ ] **1.2 Environment Variables Configured:**
  - [ ] Set `KEY_GPT_A=<sk-proj-...>` in secure shell environment.
  - [ ] Set `KEY_CLAUDE_A=<sk-ant-api03-...>` in secure shell environment.
  - [ ] Verify keys are NOT committed to Git, logged to console, or written to world files.
- [ ] **1.3 Paid Request Gate Authorization:**
  - [ ] Generate unique run ID: e.g. `SIM_RUN_ID="live-1v1-trial-$(date +%Y%m%d%H%M%S)"`.
  - [ ] Set `CIV_APPROVE_PAID_RUN="${SIM_RUN_ID}"`.
  - [ ] Verify `ownerApprovalReference` is recorded in preflight manifest.
  - [ ] Set budget cap: `spendAllowanceUsd=1.00`, `maxRequestsPerRun=80`.

---

## Phase 2 — Dedicated Minecraft World & Server Setup

- [ ] **2.1 Isolated Paper 1.21.6 Server:**
  - [ ] Paper Build #48 installed on dedicated port (e.g. `25565` loopback or isolated LAN).
  - [ ] Server running in online-mode=false or managed auth proxy with whitelist enabled.
  - [ ] Verified server is NOT connected to public Internet.
- [ ] **2.2 Clean Survival World Generation:**
  - [ ] Fresh world seed generated with natural daylight cycle and normal mob spawning.
  - [ ] Verify `gamerule keepInventory false`.
  - [ ] Verify `gamerule doImmediateRespawn false`.
  - [ ] Verify `difficulty normal` or `hard`.
- [ ] **2.3 Roster & Spawn Verification:**
  - [ ] Citizens registered: `GPT_A` and `Claude_A`.
  - [ ] Verify empty inventories: no starter kits, food, tools, or structures provided.
  - [ ] Spawns located in valid biomes (e.g. Plains or Forest with reachable trees and stone).

---

## Phase 3 — Storage & Persistence Isolation

- [ ] **3.1 Disposable Database Directory:**
  - [ ] SQLite database path created in isolated directory (e.g. `/tmp/minecraft-trial-1v1/civ.sqlite`).
  - [ ] Session persistence JSON path configured (e.g. `/tmp/minecraft-trial-1v1/sessions.json`).
  - [ ] Verified no existing production database or shared state is attached.
- [ ] **3.2 Community Separation:**
  - [ ] `GPT_A` assigned to `community-north`.
  - [ ] `Claude_A` assigned to `community-south`.
  - [ ] Verify chat channels configured for localized hearing (`COMMUNICATION_GUIDE` active).

---

## Phase 4 — Execution & Monitoring Rules

- [ ] **4.1 Live Deliberation Launch:**
  - [ ] Launch orchestrator with `allowPaidRequests: true`.
  - [ ] Verify real-time console shows structured decision evidence.
  - [ ] Verify provider attribution: `openai-responses` for `GPT_A`, `anthropic-messages` for `Claude_A`.
- [ ] **4.2 Health & Budget Heartbeat:**
  - [ ] Monitor cumulative spend in registry accounting.
  - [ ] Confirm in-flight requests stay within concurrency limit (`maxConcurrency=2`).
  - [ ] Ensure neither citizen switches model families upon transient failure.
- [ ] **4.3 Emergency Stop Trigger:**
  - [ ] In the event of unexpected behavior, loop, or billing anomaly:
    - Press `Ctrl+C` or execute emergency stop command.
    - Revoke gate: `gate.revoke("operator emergency stop")`.
    - Stop manager cleanly via `manager.stop()`.

---

## Phase 5 — Post-Trial Evidence Collection

- [ ] **5.1 Reconcile Ledger:**
  - [ ] Extract decision evidence log (`registry.evidenceLog()`).
  - [ ] Export SQLite event journal.
  - [ ] Compare reported `estimatedSpendUsd` against OpenAI and Anthropic live billing dashboards.
- [ ] **5.2 Archive Artifacts:**
  - [ ] Archive world save, SQLite database, journal, and evidence reports into immutable audit directory.
