# Mission 006B — Authorization Boundary (Stage 1)

Date: 2026-10-26  
Branch: `integration/reliability-pr7-windows` @ `019d26d`  
**Physical Stage 1: NOT EXECUTED**

## Gate status

This mission handoff is **not** live authorization.

Required exact operator sentence (also as env `CONSTRUCTION_006B_STAGE1_AUTH`):

```
Authorize Mission 006B Stage 1 live on isolated World-Lab port 25568 only.
```

Without that phrase: readiness checks only — no Paper, no Atlas, no placement.

## Readiness snapshot (agent-verified, offline)

| Check | Result |
| --- | --- |
| Branch / HEAD | `integration/reliability-pr7-windows` @ `019d26d` |
| Original Paper 25567 | idle |
| Isolated Paper 25568 | idle |
| Original RCON 25577 | idle |
| Isolated RCON 25578 | idle |
| Original `server.properties` SHA256 | matches 006A manifest |
| Original sqlite SHA256 | matches 006A manifest |
| Isolated ports in copy | `server-port=25568`, `rcon.port=25578` |
| Pad catalog distance from H9 | proposed `(-900,70,700)` safe by catalog rule (still needs live load/empty check) |
| Stages 2–4 | hard-stopped in `evaluateMission006BStage1Live` |

## Entrypoints

```powershell
# Readiness only (default — safe)
pnpm --filter @civ/orchestrator construction:stage1-006b

# After EXACT auth phrase + isolation pins + operator watching:
# $env:CONSTRUCTION_006B_STAGE1_AUTH="Authorize Mission 006B Stage 1 live on isolated World-Lab port 25568 only."
# ... isolation env ...
# $env:CONSTRUCTION_006B_EXECUTE_PLACEMENT="true"
# pnpm --filter @civ/orchestrator construction:stage1-006b -- --live --stage=stage1_one_block
```

## Stage 1 PASS/FAIL

**NOT RUN** — stopped at authorization boundary.

No world changes, no inventory delta, no Mineflayer session, no SQLite live checkpoint from this mission.

## Next

Operator replies with the exact authorization sentence. Then a supervised Stage 1 live attempt may proceed on **25568 only**.
