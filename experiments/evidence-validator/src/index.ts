/**
 * Antigravity Offline Experiment Evidence Validator
 *
 * Provides offline verification of AI citizen decisions against physical world evidence.
 */

export * from "./types.js";
export * from "./schemas.js";
export * from "./hash-chain-verifier.js";
export * from "./action-verifier.js";
export * from "./information-verifier.js";
export * from "./inventory-verifier.js";
export * from "./duration-verifier.js";
export * from "./redactor.js";
export * from "./validator.js";
export * from "./report.js";
export * from "./cli.js";

export * from "./recorder-adapter.js";

export * from "./v1-bridge.js";

export * from "./offline-replay.js";

export {
  verifySourceAttestation,
  buildCanonicalAttestationPayload,
  parseEd25519PublicKey,
  parseEd25519Signature,
  createTestAttestationKeypair,
  signTestAttestation,
  type CanonicalAttestationParams,
  type VerifySourceAttestationOptions,
} from "./source-authenticator.js";
export * from "./runtime-recorder-replay.js";