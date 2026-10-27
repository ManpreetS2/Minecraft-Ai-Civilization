# Operator commands — Construction 006A (DO NOT RUN until authorized)

## 0. Preservation check

```powershell
cd <WORKSPACE>
Get-FileHash .\world-lab\server.properties -Algorithm SHA256
Get-FileHash .\data\world-lab-civilization.sqlite -Algorithm SHA256
# Compare to experiments/construction-006a/manifest.json
```

## 1. Prepare isolated copy (offline; no Paper)

```powershell
pnpm construction:prepare-006a -- --execute-copy
```

## 2. Dry-run stage plan (no Minecraft)

```powershell
pnpm construction:staged-006a -- --write-plan
```

## 3. LIVE Stage 1 — REQUIRES EXACT OPERATOR SENTENCE

Authorization must be **exactly**:

```
Authorize Mission 006B Stage 1 live on isolated World-Lab port 25568 only.
```

Stages 2–4 remain hard-stopped. No auto-advance.

```powershell
# Pins — isolated ports only; AUTO_START_PAPER=false
# Copy from experiments/construction-006a/.env.construction-006a then:
$env:CONSTRUCTION_EXPERIMENT_ENABLED="true"
$env:CONSTRUCTION_EXPERIMENT_ALLOW_LIVE="true"
$env:CONSTRUCTION_EXPERIMENT_ALLOW_WORLD_MUTATION="true"
$env:AUTO_START_PAPER="false"
$env:MINECRAFT_PORT="25568"
$env:DATABASE_PATH="experiments/construction-006a/world-lab-civilization.sqlite"
$env:CONSTRUCTION_EXPERIMENT_WORLD_LAB="experiments/construction-006a/world-lab-isolated"
$env:CONSTRUCTION_006B_STAGE1_AUTH="Authorize Mission 006B Stage 1 live on isolated World-Lab port 25568 only."
$env:CONSTRUCTION_006B_EXECUTE_PLACEMENT="true"

# Start Paper from ISOLATED tree only (never world-lab\start.bat original):
cd experiments\construction-006a\world-lab-isolated
.\start.bat
# Wait for Done on port 25568

# Readiness / gated Stage 1 entry (Mission 006B):
pnpm --filter @civ/orchestrator construction:stage1-006b -- --live --stage=stage1_one_block
```

## Emergency stop

1. Disconnect Atlas / kill bot process.
2. Paper console: `stop` (isolated instance only).
3. Do not touch original `world-lab` on 25567.
4. See `experiments/construction-006a/ROLLBACK.md`.
