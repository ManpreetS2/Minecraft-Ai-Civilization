# Antigravity Offline Evidence Validator

Independent offline verification utility for the **Minecraft AI Civilization** project. Validates citizen decisions against physical world evidence according to the P0 charter specification.

## Core Provenance Chain

```
World Event Occurred
        │
        ▼
Legitimate Observation Received (visibility & hearing boundaries)
        │
        ▼
Citizen Legitimate Belief (authorized knowledge only)
        │
        ▼
Model / Planner Decision (documented decisionEventId)
        │
        ▼
Physical Action Attempted (dispatched action & target)
        │
        ▼
Verified Physical Outcome (inventory, world block, health, hunger transitions)
```

## Evidence Classification Hierarchy

1. **`observed_fact`**: Directly witnessed physical world event by the citizen bot.
2. **`communicated_claim`**: Reported by another citizen via speech or message (never treated as confirmed world truth).
3. **`planned_action`**: Planner or LLM intent.
4. **`attempted_action`**: Physically dispatched attempt in the world.
5. **`successful_action`**: Confirmed and verified by physical state transitions.
6. **`unverified_assertion`**: An action claimed successful or a fact asserted without verified physical witnesses.

## CLI Usage

Run directly via `pnpm exec tsx`:

```bash
pnpm exec tsx experiments/evidence-validator/src/cli.ts \
  --manifest experiments/evidence-validator/fixtures/sample-2v2/manifest.json \
  --journal experiments/evidence-validator/fixtures/sample-2v2/operator-journal.jsonl \
  --events experiments/evidence-validator/fixtures/sample-2v2/events.jsonl \
  --facts experiments/evidence-validator/fixtures/sample-2v2/facts.json \
  --inventories experiments/evidence-validator/fixtures/sample-2v2/inventories.json \
  --output report.json \
  --summary summary.md \
  --strict
```

### CLI Flags

| Flag | Description |
| :--- | :--- |
| `--manifest <path>` | Path to experiment manifest JSON (`ExperimentManifestSchema`) |
| `--journal <path>` | Path to cryptographic sha256 hash-chained operator journal JSONL |
| `--events <path>` | Path to event stream JSON or JSONL (`SimEvent`) |
| `--facts <path>` | Path to persistent facts JSON (`PersistentFactItem`) |
| `--deliveries <path>` | Path to event deliveries JSON (`citizen_event_delivery`) |
| `--inventories <path>` | Path to final observed inventories JSON |
| `--output <path>` | Path to write machine-readable JSON report |
| `--summary <path>` | Path to write human-readable Markdown report |
| `--strict` | Exit with code `2` if status is `VIOLATIONS_DETECTED` or `NOT_PROVEN` |

## Regression Coverage and Negative Tests

The test suite catches:
- **Phantom Food Gathering**: Claiming to gather berries/apples without inventory count increase.
- **Spontaneous Item Gain (Free Inventory)**: Inventory counts increasing without a verified physical source.
- **Private Chest Leaks**: Revealing private or personal chest contents to unauthorized citizens.
- **Unobserved Settlement Discovery**: Holding rival settlement coordinates without physical travel proof.
- **Claim Promoted to Truth**: Treating spoken speech as confirmed world truth instead of a claim.
- **False Action Success**: Reporting success after pathfinding blocked or interaction failed.
- **Cross-Actor Identity Tampering**: One citizen claiming observation receipts for another citizen's attempt.
- **Corrupted Hash Chains**: Detecting altered, reordered, or deleted operator journal records.
- **Simulation Duration Deficit**: Claiming 60-minute runs with only partial duration or absent tick/TPS metrics.
- **Missing Evidence Defense**: Returning `NOT_PROVEN` instead of false positives when evidence is absent.
- **Sensitive Data Redaction**: Automatic scrubbing of private API keys, prompts, and secret memories.

## Testing

```bash
# Run unit and integration tests
pnpm exec vitest run --config experiments/evidence-validator/vitest.config.mjs

# Typecheck
pnpm exec tsc -p experiments/evidence-validator/tsconfig.json --noEmit

# Lint
pnpm exec eslint experiments/evidence-validator/
```
