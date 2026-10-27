# Cross-Computer Handoff — Mission 007

## Snapshot

| Field | Value |
| --- | --- |
| **Private backup repository** | https://github.com/ManpreetS2/Minecraft-Ai-Civilization-windows-backup |
| **Branch** | `backup/windows-wip-2026-10-26` |
| **Commit SHA** | `c6440f7aa6b2ac05222a4ffabe8150c014efb8a0` |
| **Backup timestamp (UTC)** | 2026-10-27T~04:30Z (Mission 007 Windows snapshot; tip includes this handoff doc) |
| **Prior working branch (preserved locally)** | `integration/reliability-pr7-windows` @ `019d26d4d414c2c962d9e58c4f2c0d84a7db569d` |
| **Public repo (unchanged)** | https://github.com/ManpreetS2/Minecraft-Ai-Civilization — **do not push this WIP there** |

This backup is a **private** GitHub repository. The public `Minecraft-Ai-Civilization` remote/`main` were not updated by this handoff.

## Project status

- Development is entering an architecture-simplification pause.
- **Construction development is frozen** after Mission 007 backup.
- Missions **001–006A** delivered offline ACE, audit, reliability, and isolated World-Lab prep.
- Mission **006B Stage 1** remains **blocked** without the exact live-authorization phrase; **no live construction test has occurred**.
- Offline / fake-Mineflayer production-path tests exist; they are **not** live world proof.

## Warning — no live construction proof

> Offline ACE tests, Mission 004/005 harnesses, and 006A preparation **do not** mean a structure was built on a live Paper world. Do not treat this snapshot as live-validated construction.

## What is in the snapshot

- Citizen / Mineflayer integration source (`packages/agent-core`, `minecraft-adapter`, `skills`, orchestrator)
- Construction Missions 001–006B source, tests, ledgers, and architecture docs
- Six-blueprint catalog + preflight (`structures`, `build-preflight`, blueprint rules)
- Procurement, site-select, placement / `placeBlock` VERIFY integration
- Production-path tests and offline construction engine
- Homes / nav / fish / curfew WIP required to resume
- Package manifests (`package.json` workspace); lockfile `pnpm-lock.yaml` (unchanged vs prior HEAD when snapshot was taken)
- Experiment **operator docs** under `experiments/construction-006a/` (manifest sanitized; env pins as `.example`)

## Local-only files **not** uploaded

| Excluded | Why | Required for offline code? |
| --- | --- | --- |
| `.env` | Local secrets / machine config | No — copy from `.env.example` |
| `world-lab/` | Minecraft worlds, jars, libraries | No for typecheck/tests |
| `experiments/**/world-lab-isolated/` | Isolated Paper copy (~hundreds of MB) | No — recreate later if live work resumes |
| `*.sqlite` / WAL / SHM | Citizen/experiment databases | No for offline code |
| `data/` runtime artifacts | Local simulation state | No |
| `*.log`, crash dumps | Runtime noise | No |
| `node_modules/` | Reinstall via pnpm | No |
| Absolute OneDrive paths | Sanitized to `<WORKSPACE>` / placeholders in docs | N/A |

## Known build / typecheck notes

- Prefer **Node ≥ 22** and **pnpm**.
- Run `pnpm install` then `pnpm typecheck` and `pnpm test` offline.
- Some live-only scripts under `apps/orchestrator` expect a running Paper instance; they are not required for offline development.
- Construction live gates remain auth-blocked (`CONSTRUCTION_006B` / experiment guards). Do not enable live mutation without explicit operator authorization.

## Clone and resume on another Windows computer

```powershell
# 1) Clone private backup (requires GitHub auth with access to the private repo)
git clone https://github.com/ManpreetS2/Minecraft-Ai-Civilization-windows-backup.git
cd Minecraft-Ai-Civilization-windows-backup
git checkout backup/windows-wip-2026-10-26
git rev-parse HEAD
# Expect: c6440f7aa6b2ac05222a4ffabe8150c014efb8a0

# 2) Dependencies
copy .env.example .env
# Edit .env for local host/ports if needed. Do NOT commit .env.
pnpm install

# 3) Offline verification (no Minecraft / Paper required)
pnpm typecheck
pnpm test
```

Optional: keep the public repo as a second remote for history comparison only; **do not** force-push or merge this backup branch into public `main`.

```powershell
git remote add public https://github.com/ManpreetS2/Minecraft-Ai-Civilization.git
git fetch public
```

## Resume development guidance

1. Work from `backup/windows-wip-2026-10-26` (or branch from it).
2. Read `docs/AUTONOMOUS_CONSTRUCTION_ENGINE.md` and mission ledgers `docs/CONSTRUCTION_MISSION00*.md`.
3. Continue architecture simplification as planned; **do not** resume Mission 006B live stages without the exact authorization phrase and isolated World-Lab ports.
4. Recreate World-Lab / SQLite locally only when live experimentation is intentionally restarted — they are not needed for offline coding.

## Remotes reference (original machine)

- `origin` → public `ManpreetS2/Minecraft-Ai-Civilization` (visibility unchanged)
- `backup` → private `ManpreetS2/Minecraft-Ai-Civilization-windows-backup`
