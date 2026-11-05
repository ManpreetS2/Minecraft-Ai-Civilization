# Operator Evidence Recorder Gap Analysis & Field Contracts (Handoff to CODEX 1 & Cursor, Mission 005)

**Author:** Google Antigravity Engineering Agent  
**Context:** GitHub Issues #6, #40, and Missions 004B / 005  
**Reference Commit:** `5964506cc0862360f6b13ee032423629c061cba8` (Cursor PR #56 tip)  
**Target Consumer:** CODEX 1 / Cursor (Orchestrator, Manager, Store, and Minecraft Adapter owners)

---

## 1. Executive Summary & Audit Status

During Mission 004B, we inspected Cursor's integrated V1 candidate (`ea4ada9ba3baa750cc3c1dec330e4918bb47ef49`).

**Audit Finding:** None of the 4 requested recorder instrumentation fields have been integrated into Cursor's `packages/agent-core/src/experiment-evidence.ts` or SQLite schemas yet:
1. `originPosition` is still absent from `attemptSchema`.
2. `serverGameTick` is still absent from `recordTick()`.
3. `toolDurabilityBefore/After` are still absent from `observationSchema`.
4. `source_event_id` is still not consistently populated on all new SQLite facts.

**Validator Status:** The Antigravity validator in `experiments/evidence-validator/` strictly **fails closed** with `NOT_PROVEN` when these fields are missing. It will never synthesize or fabricate these values. When Cursor adds these fields, the validator will automatically verify them.

---

## 2. Precise Field Contracts & Exact Verification Tests

### 2.1 Contract: `originPosition` in `action_attempt`

- **Location:** `packages/agent-core/src/experiment-evidence.ts`
- **Schema Modification:**
  ```typescript
  const attemptSchema = z
    .object({
      action: z.enum(["gather", "craft", "place", "eat", "move", "speech"]),
      decisionSource: z.enum(["model", "planner", "reflex"]),
      decisionEventId: identifier,
      expectedItem: itemName.optional(),
      target: point.optional(),
      range: z.number().finite().nonnegative().max(8).optional(),
      // ADD THIS FIELD:
      originPosition: point.optional(),
    })
    .strict();
  ```
- **Semantics:** The exact coordinate `{ x, y, z }` where the citizen bot stood when the action attempt was initiated.
- **Verification Test for Runtime Owner:**
  ```typescript
  it("records originPosition on action attempt and verifies path displacement", () => {
    journal.forCitizen("gpt_atlas").attempt({
      action: "move",
      decisionSource: "planner",
      decisionEventId: "dec-1",
      target: { x: 105, y: 64, z: 100 },
      originPosition: { x: 100, y: 64, z: 100 },
    });
    // Validator verifies displacement Math.hypot(105-100, ...) <= range
  });
  ```

### 2.2 Contract: `serverGameTick` in `tick`

- **Location:** `packages/agent-core/src/experiment-evidence.ts`
- **Method Modification:**
  ```typescript
  recordTick(durationMs: number, measuredTps?: number, serverGameTick?: number): void {
    this.append({
      kind: "tick",
      durationMs,
      measuredTps,
      serverGameTick,
    });
  }
  ```
- **Semantics:** The absolute Paper world game tick (`bot.time.time` or Paper server tick). Must monotonically increase across ticks.
- **Verification Test for Runtime Owner:**
  ```typescript
  it("records monotone serverGameTick and proves uninterrupted 60-minute Paper run", () => {
    for (let i = 0; i < 720; i++) {
      journal.recordTick(5000, 20.0, 1000 + i * 100);
    }
    // Validator verifies serverTickProven === true and 72,000 tick progression
  });
  ```

### 2.3 Contract: `toolDurabilityBefore` & `toolDurabilityAfter` in `action_observation`

- **Location:** `packages/agent-core/src/experiment-evidence.ts`
- **Schema Modification:**
  ```typescript
  const observationSchema = z
    .object({
      successReported: z.boolean(),
      beforeInventory: inventory,
      afterInventory: inventory,
      position: point.optional(),
      hungerBefore: z.number().min(0).max(20).optional(),
      hungerAfter: z.number().min(0).max(20).optional(),
      worldChanges: z.array(
        z.object({ position: point, before: itemName, after: itemName }).strict(),
      ),
      authorizedRecipients: z.array(identifier).optional(),
      failureCode: z.string().regex(/^[A-Z0-9_]+$/).optional(),
      // ADD THESE FIELDS:
      toolDurabilityBefore: inventory.optional(),
      toolDurabilityAfter: inventory.optional(),
    })
    .strict();
  ```
- **Semantics:** Damage points of tools before and after an action (e.g. `{ "minecraft:wooden_pickaxe": 59 }` -> `{ "minecraft:wooden_pickaxe": 57 }`).
- **Verification Test for Runtime Owner:**
  ```typescript
  it("records tool durability depletion on stone gather", () => {
    journal.forCitizen("gpt_atlas").observe({
      successReported: true,
      beforeInventory: {},
      afterInventory: { "minecraft:cobblestone": 1 },
      toolDurabilityBefore: { "minecraft:wooden_pickaxe": 59 },
      toolDurabilityAfter: { "minecraft:wooden_pickaxe": 57 },
      worldChanges: [],
    });
  });
  ```

### 2.4 Contract: `source_event_id` in SQLite `citizen_persistent_facts`

- **Location:** `packages/agent-core/src/store.ts`
- **Schema & Persistence Requirements:**
  ```sql
  ALTER TABLE citizen_persistent_facts ADD COLUMN source_event_id TEXT;
  ```
- **Integrity Requirement:** The presence of a column alone does not prove event authenticity. The runtime store must:
  1. Populate `source_event_id` with the immutable UUID of the corresponding event in the event log.
  2. Reject or quarantine facts written without a valid `source_event_id`.
  3. Include `source_event_id` in database migrations without overwriting historical facts.
- **Verification Test for Runtime Owner:**
  ```typescript
  it("persists source_event_id for persistent facts and rejects unlinked facts", () => {
    store.saveFact({
      citizenId: "gpt_atlas",
      factKey: "found_coal",
      content: "Found coal deposit",
      kind: "observed_fact",
      sourceEventId: "ev-event-uuid-1234",
    });
    const fact = store.getFact("gpt_atlas", "found_coal");
    expect(fact.source_event_id).toBe("ev-event-uuid-1234");
  });
  ```


---

## 3. Mission 005 Authenticity & Provenance Contracts

### 3.1 Attestation Contract: `SourceAttestation`
To distinguish genuine Paper server execution from client-side or offline simulations, the validator enforces the `SourceAttestation` boundary:
```typescript
export interface SourceAttestation {
  sourceType: "offline_simulated" | "unverified_client" | "paper_server_attested";
  serverBuild?: number;
  captureSessionId?: string;
  attestationSignature?: string;
}
```
- **`offline_simulated`**: Permitted only for offline test fixtures and local CI dry-runs.
- **`unverified_client`**: Monotonic tick progression recorded without server-side cryptographic attestation or direct server plugin telemetry.
- **`paper_server_attested`**: Required for live public Gate B demonstrations. Requires Paper server build telemetry, matching capture session ID, and authentic uninterrupted tick stream (~72,000 ticks for 60 minutes).

### 3.2 Metadata Provenance Contract
The validator will no longer generate synthetic defaults for missing experiment manifest fields:
- No automatic community assignment by citizen array index.
- No synthetic personality seeds (`seed_<citizen>`).
- No fallback `plains` biomes for starting sites without observed coordinates and terrain.
- No assumed boolean game rules (`keepInventory`, `hardcore`, etc.).
- No synthetic paths (`runRoot`, `worldPath`, etc.).
- No inferred recording status or unobserved privacy test counters.

When any of these fields lack genuine runtime provenance, the validator emits `NOT_PROVEN` and refrains from certifying the experiment manifest.