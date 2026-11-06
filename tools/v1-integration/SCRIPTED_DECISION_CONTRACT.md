# Scripted decision contract

Offline rehearsals record each physical gather as it executes. They do not rebuild one gather from the final inventory.

`ExperimentEvidenceJournal` attempt rows use `decisionSource`:

| Source | Meaning |
| --- | --- |
| `scripted` | The planner accepted a goal from the in-process scripted transport. This is not a live GPT or Claude decision. |
| `model` | A genuine external model provider proposed the goal. Offline `runScenario` must not write this. |
| `planner` | The deterministic planner chose the action. |
| `reflex` | A safety reflex chose the action. |

The journal `start` row already carries `decisionTransport: "scripted-in-process"` for these runs. `expectedDelta` on the scenario action is the quantity the executor planned before digging (one targeted log). `inventoryDelta` is the inventory change measured for that attempt. They are recorded separately. A failed or cancelled attempt stays in the journal and does not add items.

Codex owns `tools/v1-integration/journal-cross-check.ts` and its CLI wiring. This branch does not add that cross-check. The evidence-validator journal schema (`experiments/evidence-validator/src/schemas.ts`) still allows only `model | planner | reflex`. Until that enum accepts `scripted`, the Gemini adapter reports `RECORDER_SCHEMA_MISMATCH_ATTEMPT` for those rows and stays NOT PROVEN. Do not relabel scripted rows as `model` to silence it.

Chest writes from the executor pass `expectedRevision` read before the live withdraw or deposit. `physical_asset_observation_epoch` keeps that token monotonic after `abandonAsset`, so a token from a chest that was removed does not apply to a new chest at the same coordinates.
