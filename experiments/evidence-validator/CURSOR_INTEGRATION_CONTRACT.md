# Cursor & CODEX 1 Integration Contract: Offline Evidence Validator

**Document Version:** 1.0.0 (Mission 007)  
**Author:** Google Antigravity Evidence Verification Team  
**Scope:** Public API, Cryptographic Attestation Schemas, Trust Root Configuration, and Verification Matrix for CODEX 1 / Cursor

---

## 1. Overview & Architecture

The Antigravity Evidence Validator (`experiments/evidence-validator/`) provides independent, tamper-proof, offline verification of AI Civilization experiment runs. It audits citizen decisions against physical Minecraft world evidence, cryptographic hash chains, and authentic PaperMC runtime attestation.

### Core Guarantees:
1. **Provenance Chain:** World Event $\to$ Legitimate Observation $\to$ Citizen Belief $\to$ Decision $\to$ Attempted Action $\to$ Verified Physical Outcome.
2. **Fail-Closed Verification:** Unsupported claims, unverified assertions, missing metadata, and missing or unverified cryptographic attestations return `NOT_PROVEN` or `VIOLATIONS_DETECTED`.
3. **Zero Synthetic Facts:** Missing observations are never filled with assumed coordinates, hardcoded models, or synthesized defaults.
4. **Asymmetric Cryptographic Trust:** Live Paper runs require Ed25519 digital signatures verified against operator-configured public keys.

---

## 2. Public API Surface

Cursor and runtime orchestrators consume the validator via ES Module imports from `experiments/evidence-validator`:

```typescript
import {
  // Primary Validation Entry Point
  validateExperimentEvidence,
  type ValidatorInput,
  type ValidationReport,

  // V1 Bridge (Converts V1 Run Bundles to Validated Formats)
  bridgeV1RunBundle,
  type V1RunBundle,
  type V1BridgeResult,

  // Recorder Adapters
  adaptRecorderJournal,
  adaptPersistentFacts,

  // Cryptographic Authenticator Utilities
  verifySourceAttestation,
  buildCanonicalAttestationPayload,
  parseEd25519PublicKey,
  parseEd25519Signature,
  createTestAttestationKeypair,
  signTestAttestation,
  type SourceAttestation,
  type SourceAttestationAudit,
  type CanonicalAttestationParams,
} from "experiments/evidence-validator";
```

### 2.1 Primary Function: `validateExperimentEvidence(input: ValidatorInput): ValidationReport`

```typescript
export interface ValidatorInput {
  manifest?: ValidatedManifest;
  rawJournalLines?: string[];
  journalRows?: JournalRow[];
  events?: EventStreamItem[];
  deliveries?: Array<{ citizenId: string; eventId: string; deliveredAt: string }>;
  facts?: PersistentFactItem[];
  finalInventories?: Record<string, Record<string, number>>;
  citizenPositionsHistory?: Map<string, Array<{ x: number; y: number; z: number }>>;
  sourceAttestation?: SourceAttestation;
  trustedAuthorities?: string[];
  trustedKeys?: Record<string, string | KeyObject> | Map<string, string | KeyObject>;
}
```

---

## 3. Cryptographic Attestation Schema (`SourceAttestation`)

To certify an experiment as a live Paper execution (`real_minecraft` mode), `input.sourceAttestation` must be provided with:

```typescript
export interface SourceAttestation {
  sourceType: "offline_simulated" | "unverified_client" | "paper_server_attested";
  serverBuild?: number;
  serverVersion?: string;
  captureSessionId?: string;       // Valid UUIDv4 generated at Paper server startup
  experimentId?: string;         // Must match manifest.experimentId
  signingAuthority?: string;     // Must match a key registered in trustedKeys
  signature?: string;            // Format: "ed25519:<128 hex chars>" or raw base64
  timestamp?: string;            // ISO 8601 UTC
  sourceSha?: string;            // Git commit SHA of the experiment codebase
  evidenceDigest?: string;       // SHA-256 hex digest of the raw journal lines joined by \n
  startedAt?: string;            // ISO 8601 UTC
  endedAt?: string;              // ISO 8601 UTC
  firstServerTick?: number;      // First observed serverGameTick
  lastServerTick?: number;       // Last observed serverGameTick
  totalServerTicks?: number;     // Total elapsed game ticks (~72,000 for 60 min)
}
```

### 3.1 Canonical Attestation Payload (`AGY-PAPER-ATTESTATION-V1`)

The Paper server must sign the exact UTF-8 byte serialization produced by `buildCanonicalAttestationPayload`:

```text
AGY-PAPER-ATTESTATION-V1
experiment_id:<experimentId>
capture_session_id:<captureSessionId>
server_version:<serverVersion>
server_build:<serverBuild>
source_sha:<sourceSha>
evidence_digest:<evidenceDigest>
started_at:<startedAt>
ended_at:<endedAt>
first_server_tick:<firstServerTick>
last_server_tick:<lastServerTick>
total_server_ticks:<totalServerTicks>
```

---

## 4. Operator Trust Root Configuration (`trustedKeys`)

The validator does not embed hardcoded private keys or assume any authority string is trustworthy. Operators supply the trusted public key mapping:

### 4.1 In-Code Configuration:
```typescript
const report = validateExperimentEvidence({
  manifest,
  rawJournalLines,
  journalRows,
  sourceAttestation,
  trustedKeys: {
    // Authority name -> SPKI PEM or raw 32-byte hex public key
    "paper-prod-signing-authority-v1": process.env.PAPER_ATTESTATION_PUBLIC_KEY_PEM,
  },
});
```

### 4.2 CLI Invocation:
```bash
pnpm exec tsx experiments/evidence-validator/src/cli.ts \
  --manifest ./experiment_manifest.json \
  --journal ./operator_journal.jsonl \
  --trusted-keys ./operator_trusted_keys.json \
  --output ./report.json \
  --strict
```

---

## 5. Capture-Side Implementation Guidance for Cursor

To enable full verification for Cursor's live runs:

1. **Populate Missing Recorder Instrumentation:**
   - In `action_attempt`: Record `originPosition: { x, y, z }`.
   - In `tick`: Record `serverGameTick: number` (monotonically increasing Paper engine tick).
   - In `action_observation`: Record `toolDurabilityBefore` and `toolDurabilityAfter`.
   - In `facts`: Populate `source_event_id` referencing the origin event.

2. **At Paper Server Boot:**
   - Generate `captureSessionId = crypto.randomUUID()`.
   - Record `firstServerTick = server.getTickCount()`.

3. **At Server Shutdown:**
   - Flush journal and close file handle.
   - Compute `evidenceDigest = sha256(journalContent)`.
   - Assemble canonical payload and sign using the Ed25519 private key.
   - Output `sourceAttestation` object into `attestation.json` or manifest.

---

## 6. Verification and Regression Test Commands

CODEX 1 / Cursor engineers can run the offline validator test suite locally with:

```bash
# Run all 142 offline evidence validator tests
pnpm exec vitest run --config experiments/evidence-validator/vitest.config.mjs

# Run the 15-point cryptographic adversarial verification suite
pnpm exec vitest run experiments/evidence-validator/test/phase2-crypto-verification.test.ts --config experiments/evidence-validator/vitest.config.mjs

# Verify TypeScript typecheck
pnpm exec tsc -p experiments/evidence-validator/tsconfig.json --noEmit

# Verify security regressions
pnpm run test:security
```
