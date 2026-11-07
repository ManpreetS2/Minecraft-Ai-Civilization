# Experiment Evidence Validation Report: fixture-4-e83444cc8dbf

**Overall Status:** 🟡 NOT PROVEN | **Environment:** 🔬 Offline Simulated Fixture (Not a live Minecraft demo claim)
**Generated At:** 2026-11-07T02:50:20.931Z
**Source SHA:** `e83444cc8dbfb376f59c59f8d8c6989363e5d7b9`
**Citizens:** gpt-a, gpt-b, claude-a, claude-b
**Communities:** none

> [!NOTE]
> This report evaluates an **offline simulated test fixture**. Passing checks demonstrate verification capability and negative regression defense; they do **not** claim a successful live Minecraft demonstration on a Paper server.

## Summary Metrics

| Metric | Value |
| :--- | :--- |
| **Total Attempted Actions** | 12 |
| **Physically Verified Actions** | 12 |
| **Unverified Action Claims** | 0 |
| **Failed Actions** | 0 |
| **Interrupted Actions** | 0 |
| **Observed Facts** | 0 |
| **Communicated Claims** | 0 |
| **Privacy Violations** | 0 |
| **Inventory Discrepancies** | 0 |
| **Hash Chain Integrity** | VALID |
| **Duration & Tick Proof** | DEFICIT / UNPROVEN |

## ❓ Unproven Checks (Missing Evidence)

| Code | Description | Missing Fields |
| :--- | :--- | :--- |
| `RECORDER_GAP_TOOL_DURABILITY` | action_observation records lack toolDurabilityBefore/After. Tool-wear checks are NOT_PROVEN. | `toolDurabilityBefore, toolDurabilityAfter` |
| `RECORDER_GAP_SERVER_GAME_TICK` | tick records lack serverGameTick. Uninterrupted 60-minute Paper server proof is NOT_PROVEN. | `serverGameTick` |
| `MISSING_CITIZEN_COMMUNITY` | Citizen 'gpt-a' lacks explicit communityId configuration. Validator refuses to assign community by array index. | `communityId_gpt-a` |
| `MISSING_CITIZEN_PERSONALITY_SEED` | Citizen 'gpt-a' lacks explicit personalitySeed configuration. Validator refuses to fabricate 'seed_gpt-a'. | `personalitySeed_gpt-a` |
| `MISSING_CITIZEN_COMMUNITY` | Citizen 'gpt-b' lacks explicit communityId configuration. Validator refuses to assign community by array index. | `communityId_gpt-b` |
| `MISSING_CITIZEN_PERSONALITY_SEED` | Citizen 'gpt-b' lacks explicit personalitySeed configuration. Validator refuses to fabricate 'seed_gpt-b'. | `personalitySeed_gpt-b` |
| `MISSING_CITIZEN_COMMUNITY` | Citizen 'claude-a' lacks explicit communityId configuration. Validator refuses to assign community by array index. | `communityId_claude-a` |
| `MISSING_CITIZEN_PERSONALITY_SEED` | Citizen 'claude-a' lacks explicit personalitySeed configuration. Validator refuses to fabricate 'seed_claude-a'. | `personalitySeed_claude-a` |
| `MISSING_CITIZEN_COMMUNITY` | Citizen 'claude-b' lacks explicit communityId configuration. Validator refuses to assign community by array index. | `communityId_claude-b` |
| `MISSING_CITIZEN_PERSONALITY_SEED` | Citizen 'claude-b' lacks explicit personalitySeed configuration. Validator refuses to fabricate 'seed_claude-b'. | `personalitySeed_claude-b` |
| `MISSING_SITE_BIOME` | Starting site for 'gpt-a' lacks explicit observed biome configuration. Validator refuses to default to 'plains'. | `biome_gpt-a` |
| `MISSING_SITE_BIOME` | Starting site for 'gpt-b' lacks explicit observed biome configuration. Validator refuses to default to 'plains'. | `biome_gpt-b` |
| `MISSING_SITE_BIOME` | Starting site for 'claude-a' lacks explicit observed biome configuration. Validator refuses to default to 'plains'. | `biome_claude-a` |
| `MISSING_SITE_BIOME` | Starting site for 'claude-b' lacks explicit observed biome configuration. Validator refuses to default to 'plains'. | `biome_claude-b` |
| `MISSING_SERVER_CONFIG` | RunBundle configuration lacks genuine serverVersion, paperBuild, or difficulty. | `serverVersion, paperBuild, difficulty` |
| `MISSING_GAMERULE_CONFIG` | RunBundle configuration lacks explicit boolean game rules (keepInventory, hardcore, doDaylightCycle, doMobSpawning, doMobLoot). Validator refuses to assume default values. | `keepInventory, hardcore, doDaylightCycle, doMobSpawning, doMobLoot` |
| `UNVERIFIED_SHELTER_ABSENCE` | RunBundle provides no physical verification receipt that shelters were absent at start. | `shelterVerifiedAbsent` |
| `MISSING_BUDGET_CEILING` | RunBundle lacks explicit budgetCeilingUsd. | `budgetCeilingUsd` |
| `MISSING_OPERATIONAL_PATHS` | RunBundle lacks explicit paths configuration (runRoot, worldPath, databasePath, evidencePath). Validator refuses to construct synthetic paths. | `runRoot, worldPath, databasePath, evidencePath` |
| `MISSING_RECORDING_CONFIG` | RunBundle configuration lacks explicit recordingEnabled (boolean) or recordingAudience ('operator_only' \| 'citizen_shared'). Validator refuses to infer them from bundle mode. | `recordingEnabled, recordingAudience` |
| `MISSING_PRIVACY_REPLAY_EVIDENCE` | RunBundle lacks observed privacy replay test counters (privacyReplayPassed, privacyReplayFailed, privacyReplaySkipped). Validator refuses to initialize them to zero. | `privacyReplayPassed, privacyReplayFailed, privacyReplaySkipped` |
| `NO_TICK_EVIDENCE` | RunBundle contains no tick records. Continuous world progression cannot be proven. | `ticks` |
| `RECORDER_OR_BRIDGE_GAP` | toolDurabilityBefore/After absent from action_observation rows: tool-wear verification not possible. CODEX 1 integration request: add toolDurabilityBefore/After to observationSchema (see RECORDER_GAP_ANALYSIS.md §2.3). | `` |
| `RECORDER_OR_BRIDGE_GAP` | serverGameTick absent from tick rows: Paper server tick continuity cannot be proven. CODEX 1 integration request: add serverGameTick to recordTick() (see RECORDER_GAP_ANALYSIS.md §2.2). | `` |
| `RECORDER_OR_BRIDGE_GAP` | ValidatedManifest withheld due to missing genuine source fields: [citizens.gpt-a.communityId, citizens.gpt-a.personalitySeed, citizens.gpt-b.communityId, citizens.gpt-b.personalitySeed, citizens.claude-a.communityId, citizens.claude-a.personalitySeed, citizens.claude-b.communityId, citizens.claude-b.personalitySeed, biome_gpt-a, biome_gpt-b, biome_claude-a, biome_claude-b, configuration.server, configuration.gameRules, configuration.shelterVerifiedAbsent, configuration.budgetCeilingUsd, configuration.paths, configuration.recording, configuration.privacyReplay]. Validator refuses to fabricate evidence. | `` |
| `UNPROVEN_PAPER_AUTHENTICITY` | Offline fixture only. Paper authenticity is NOT verified; live acceptance remains blocked until Gemini implements real signature verification and a trustworthy Paper capture source. | `paper_server_attested` |

## Duration & Performance Audit

- **Claimed Duration:** 0 minutes
- **Proven Duration:** 0.12 minutes (7271 ms)
- **Recorded Ticks:** 3
- **Average Tick Duration:** 10 ms
- **Average Measured TPS:** none recorded
- **Duration Deficit Details:** Absent TPS metrics: no server performance / TPS observations documented

## Physical Action Verifications

| Citizen | Action | Classification | Outcome | Physical Witness Deltas |
| :--- | :--- | :--- | :--- | :--- |
| gpt-a | `gather` | `successful_action` | ✅ VERIFIED | oak_log:+1; hunger:0; blocks:1 |
| gpt-b | `gather` | `successful_action` | ✅ VERIFIED | oak_log:+1; hunger:0; blocks:1 |
| claude-a | `gather` | `successful_action` | ✅ VERIFIED | oak_log:+1; hunger:0; blocks:1 |
| claude-b | `gather` | `successful_action` | ✅ VERIFIED | oak_log:+1; hunger:0; blocks:1 |
| gpt-a | `gather` | `successful_action` | ✅ VERIFIED | oak_log:+1; hunger:0; blocks:1 |
| gpt-b | `gather` | `successful_action` | ✅ VERIFIED | oak_log:+1; hunger:0; blocks:1 |
| claude-a | `gather` | `successful_action` | ✅ VERIFIED | oak_log:+1; hunger:0; blocks:1 |
| claude-b | `gather` | `successful_action` | ✅ VERIFIED | oak_log:+1; hunger:0; blocks:1 |
| gpt-a | `gather` | `successful_action` | ✅ VERIFIED | oak_log:+1; hunger:0; blocks:1 |
| gpt-b | `gather` | `successful_action` | ✅ VERIFIED | oak_log:+1; hunger:0; blocks:1 |
| claude-a | `gather` | `successful_action` | ✅ VERIFIED | oak_log:+1; hunger:0; blocks:1 |
| claude-b | `gather` | `successful_action` | ✅ VERIFIED | oak_log:+1; hunger:0; blocks:1 |

---
*Report generated by Google Antigravity Evidence Validator (redacted, offline verification).*