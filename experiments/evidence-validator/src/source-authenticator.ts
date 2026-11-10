/**
 * Source Authenticator and Cryptographic Trust Verification (Mission 007)
 *
 * Implements genuine Ed25519 asymmetric cryptographic verification:
 * 1. Binds experimentId, captureSessionId, serverBuild, sourceSha, evidence digest, and ticks.
 * 2. Uses canonical serialized signing payload (AGY-PAPER-ATTESTATION-V1).
 * 3. Verifies signature bytes against operator-supplied trusted public keys (SPKI PEM or raw Ed25519 hex).
 * 4. Strictly rejects self-generated SHA-256 digests, malformed bytes, wrong keys, and replayed runs.
 * 5. Fails closed without inventing credentials or signing authorities.
 */

import {
  createHash,
  createPublicKey,
  createPrivateKey,
  generateKeyPairSync,
  KeyObject,
  sign,
  verify,
} from "node:crypto";
import type { SourceAttestation, SourceAttestationAudit } from "./types.js";

export { type SourceAttestation, type SourceAttestationAudit };

/**
 * Parameters for the canonical serialized attestation payload.
 */
export interface CanonicalAttestationParams {
  experimentId: string;
  captureSessionId: string;
  serverBuild: number;
  serverVersion: string;
  sourceSha: string;
  evidenceDigest: string;
  startedAt: string;
  endedAt: string;
  firstServerTick?: number;
  lastServerTick?: number;
  totalServerTicks?: number;
}

/**
 * Produces the deterministic, canonical byte representation signed by the Paper server.
 */
export function buildCanonicalAttestationPayload(params: CanonicalAttestationParams): Buffer {
  const parts = [
    "AGY-PAPER-ATTESTATION-V1",
    `experiment_id:${params.experimentId}`,
    `capture_session_id:${params.captureSessionId}`,
    `server_version:${params.serverVersion}`,
    `server_build:${params.serverBuild}`,
    `source_sha:${params.sourceSha}`,
    `evidence_digest:${params.evidenceDigest}`,
    `started_at:${params.startedAt}`,
    `ended_at:${params.endedAt}`,
    `first_server_tick:${params.firstServerTick ?? 0}`,
    `last_server_tick:${params.lastServerTick ?? 0}`,
    `total_server_ticks:${params.totalServerTicks ?? 0}`,
  ];
  return Buffer.from(parts.join("\n"), "utf-8");
}

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export const SMALL_ORDER_POINTS = new Set([
  "0000000000000000000000000000000000000000000000000000000000000000",
  "0100000000000000000000000000000000000000000000000000000000000000",
  "26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc05",
  "c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac037a",
  "0000000000000000000000000000000000000000000000000000000000000080",
  "0100000000000000000000000000000000000000000000000000000000000080",
  "26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc85",
  "c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac03fa",
  "ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f",
  "ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
]);

function assertValidEd25519KeyBytes(rawBytes: Buffer): void {
  if (rawBytes.length !== 32) {
    throw new Error(`Invalid Ed25519 key length: expected 32 bytes, got ${rawBytes.length}`);
  }
  const hex = rawBytes.toString("hex").toLowerCase();
  if (SMALL_ORDER_POINTS.has(hex)) {
    throw new Error(`Invalid Ed25519 public key: degenerate or small-order public key rejected (${hex.slice(0, 8)}...).`);
  }
  // Check non-canonical y >= 2^255 - 19
  const p = (1n << 255n) - 19n;
  const yBytes = Buffer.from(rawBytes);
  yBytes[31] = yBytes[31]! & 0x7f; // clear sign bit
  const y = BigInt("0x" + Buffer.from(yBytes).reverse().toString("hex"));
  if (y >= p) {
    throw new Error("Invalid Ed25519 public key: non-canonical y-coordinate.");
  }
}

/**
 * Parses an Ed25519 public key from PEM string, raw 32-byte hex, or KeyObject.
 * Rejects private keys, small-order points, and unsupported key types (RSA, ECDSA).
 */
export function parseEd25519PublicKey(keyInput: string | KeyObject): KeyObject {
  let keyObj: KeyObject;

  if (keyInput instanceof KeyObject) {
    if (keyInput.type === "private") {
      throw new Error("Private key cannot be used as trust root; Ed25519 public key required.");
    }
    if (keyInput.type !== "public") {
      throw new Error("Invalid key type: trust root must be an Ed25519 public key.");
    }
    if (keyInput.asymmetricKeyType !== "ed25519") {
      throw new Error(`Unsupported key type '${keyInput.asymmetricKeyType}'; Ed25519 required.`);
    }
    const spkiDer = keyInput.export({ format: "der", type: "spki" });
    assertValidEd25519KeyBytes(spkiDer.subarray(12));
    return keyInput;
  }

  const trimmed = keyInput.trim();
  if (trimmed.includes("PRIVATE KEY")) {
    throw new Error("Private key cannot be used as trust root; Ed25519 public key required.");
  }

  if (trimmed.startsWith("-----BEGIN PUBLIC KEY-----")) {
    keyObj = createPublicKey(trimmed);
    const spkiDer = keyObj.export({ format: "der", type: "spki" });
    assertValidEd25519KeyBytes(spkiDer.subarray(12));
  } else if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    // Raw 32-byte hex string (64 characters)
    const rawBytes = Buffer.from(trimmed, "hex");
    assertValidEd25519KeyBytes(rawBytes);
    const spkiDer = Buffer.concat([ED25519_SPKI_PREFIX, rawBytes]);
    keyObj = createPublicKey({ key: spkiDer, format: "der", type: "spki" });
  } else if (/^[A-Za-z0-9+/]{43}=?$/.test(trimmed)) {
    // Raw 32-byte base64 string
    const rawBytes = Buffer.from(trimmed, "base64");
    if (rawBytes.length === 32) {
      assertValidEd25519KeyBytes(rawBytes);
      const spkiDer = Buffer.concat([ED25519_SPKI_PREFIX, rawBytes]);
      keyObj = createPublicKey({ key: spkiDer, format: "der", type: "spki" });
    } else {
      keyObj = createPublicKey(keyInput);
      const spkiDer = keyObj.export({ format: "der", type: "spki" });
      assertValidEd25519KeyBytes(spkiDer.subarray(12));
    }
  } else {
    keyObj = createPublicKey(keyInput);
    const spkiDer = keyObj.export({ format: "der", type: "spki" });
    assertValidEd25519KeyBytes(spkiDer.subarray(12));
  }

  if (keyObj.type !== "public") {
    throw new Error("Invalid key type: trust root must be an Ed25519 public key.");
  }
  if (keyObj.asymmetricKeyType !== "ed25519") {
    throw new Error(`Unsupported key type '${keyObj.asymmetricKeyType}'; Ed25519 required.`);
  }

  return keyObj;
}

/**
 * Parses and validates raw signature bytes for Ed25519.
 */
export function parseEd25519Signature(sigInput: string): {
  sigBuffer: Buffer | null;
  error?: string;
} {
  let cleaned = sigInput.trim();
  if (cleaned.startsWith("ed25519:")) {
    cleaned = cleaned.slice(8).trim();
  } else if (cleaned.startsWith("ecdsa:")) {
    return {
      sigBuffer: null,
      error: "Unsupported signature algorithm: ecdsa is not supported; ed25519 required.",
    };
  }

  // Reject self-generated SHA-256 digests (64 hex characters without ed25519 length)
  if (sigInput.startsWith("sha256:") || /^[0-9a-fA-F]{64}$/.test(cleaned)) {
    return {
      sigBuffer: null,
      error:
        "Invalid signature algorithm: a self-generated SHA-256 digest cannot be represented as a trusted digital signature. Asymmetric Ed25519 signature required.",
    };
  }

  let sigBuffer: Buffer;
  if (/^[0-9a-fA-F]{128}$/.test(cleaned)) {
    sigBuffer = Buffer.from(cleaned, "hex");
  } else if (/^[A-Za-z0-9+/]{86}={0,2}$/.test(cleaned)) {
    try {
      sigBuffer = Buffer.from(cleaned, "base64");
    } catch {
      return { sigBuffer: null, error: "Invalid signature encoding: must be valid hex or base64." };
    }
  } else {
    return {
      sigBuffer: null,
      error:
        "Invalid signature encoding: must be valid 64-byte hex (128 chars) or base64 (86-88 chars).",
    };
  }

  if (sigBuffer.length !== 64) {
    return {
      sigBuffer: null,
      error: `Invalid Ed25519 signature length: expected 64 bytes, got ${sigBuffer.length} bytes.`,
    };
  }

  const rHex = sigBuffer.subarray(0, 32).toString("hex").toLowerCase();
  if (SMALL_ORDER_POINTS.has(rHex)) {
    return {
      sigBuffer: null,
      error: `Invalid Ed25519 signature: degenerate small-order commitment R point (${rHex.slice(0, 8)}...).`,
    };
  }

  return { sigBuffer };
}

export interface VerifySourceAttestationOptions {
  attestation?: SourceAttestation;
  expectedExperimentId?: string;
  expectedCaptureSessionId?: string;
  expectedSourceSha?: string;
  rawJournalLines?: readonly string[];
  firstServerTick?: number;
  lastServerTick?: number;
  totalServerTicks?: number;
  trustedAuthorities?: string[];
  trustedKeys?: Record<string, string | KeyObject> | Map<string, string | KeyObject>;
}

/**
 * Evaluates source attestation against real cryptographic trust roots.
 */
export function verifySourceAttestation(
  args: VerifySourceAttestationOptions,
): SourceAttestationAudit {
  const reasons: string[] = [];

  if (!args.attestation) {
    return {
      proven: false,
      sourceType: "missing",
      authorityTrusted: false,
      sessionBound: false,
      experimentBound: false,
      signatureValid: false,
      reasons: [
        "Missing source attestation: no cryptographic source attestation provided. Live Paper server authenticity cannot be established without genuine server capture attestation.",
      ],
    };
  }

  const { attestation } = args;
  const sourceType = attestation.sourceType;

  if (sourceType === "offline_simulated") {
    return {
      proven: false,
      sourceType: "offline_simulated",
      authorityTrusted: false,
      sessionBound: false,
      experimentBound: false,
      signatureValid: false,
      reasons: [
        "Simulation source: attestation indicates offline_simulated mode. Simulated clocks cannot establish real Paper server authenticity.",
      ],
    };
  }

  if (sourceType === "unverified_client") {
    return {
      proven: false,
      sourceType: "unverified_client",
      authorityTrusted: false,
      sessionBound: false,
      experimentBound: false,
      signatureValid: false,
      reasons: [
        "Unverified client source: observations were recorded without server-side cryptographic attestation.",
      ],
    };
  }

  if (sourceType !== "paper_server_attested") {
    return {
      proven: false,
      sourceType: "missing",
      authorityTrusted: false,
      sessionBound: false,
      experimentBound: false,
      signatureValid: false,
      reasons: [`Unrecognized source attestation type: '${String(sourceType)}'`],
    };
  }

  // --- Strict Cryptographic Validation of paper_server_attested claims ---
  let experimentBound = true;
  let sessionBound = true;
  let authorityTrusted = true;
  let signatureValid = true;

  // 1. Experiment ID Binding
  if (!attestation.experimentId) {
    experimentBound = false;
    reasons.push("Attestation missing experimentId binding.");
  } else if (args.expectedExperimentId && attestation.experimentId !== args.expectedExperimentId) {
    experimentBound = false;
    reasons.push(
      `Attestation experiment ID mismatch: expected '${args.expectedExperimentId}', but attestation binds to '${attestation.experimentId}'.`,
    );
  }

  // 2. Capture Session UUID Binding
  const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
  if (!attestation.captureSessionId || !uuidRegex.test(attestation.captureSessionId)) {
    sessionBound = false;
    reasons.push(
      `Attestation lacks valid captureSessionId UUID: '${attestation.captureSessionId ?? "missing"}'.`,
    );
  } else if (
    args.expectedCaptureSessionId &&
    attestation.captureSessionId !== args.expectedCaptureSessionId
  ) {
    sessionBound = false;
    reasons.push(
      `Attestation capture session mismatch: expected '${args.expectedCaptureSessionId}', but got '${attestation.captureSessionId}'.`,
    );
  }

  // 3. Server Build Verification
  if (
    !attestation.serverBuild ||
    attestation.serverBuild <= 0 ||
    !Number.isInteger(attestation.serverBuild)
  ) {
    reasons.push(
      `Attestation lacks valid Paper server build number: '${attestation.serverBuild ?? "missing"}'.`,
    );
  }

  // 3b. Source SHA Binding — required for proven Paper authenticity (Mission 007 Phase B)
  if (!attestation.sourceSha || !/^[a-f0-9]{40}$/.test(attestation.sourceSha)) {
    experimentBound = false;
    reasons.push(
      `Attestation missing valid 40-hex sourceSha: '${attestation.sourceSha ?? "missing"}'. Incomplete attestation cannot prove Paper authenticity.`,
    );
  } else if (args.expectedSourceSha && attestation.sourceSha !== args.expectedSourceSha) {
    experimentBound = false;
    reasons.push(
      `Attestation source SHA mismatch: expected '${args.expectedSourceSha}', but attestation binds to '${attestation.sourceSha}'.`,
    );
  } else if (!args.expectedSourceSha) {
    experimentBound = false;
    reasons.push(
      "Expected candidate sourceSha missing: Paper authenticity requires verifying attestation against the exact candidate SHA.",
    );
  }

  // 3c. Tick Progression Binding — attested ticks required; caller-only values are never enough
  if (
    attestation.firstServerTick === undefined ||
    attestation.lastServerTick === undefined ||
    attestation.totalServerTicks === undefined
  ) {
    sessionBound = false;
    reasons.push(
      "Attestation missing firstServerTick/lastServerTick/totalServerTicks. Caller-supplied tick ranges cannot substitute for signed Paper tick evidence.",
    );
  } else {
    if (
      args.firstServerTick !== undefined &&
      attestation.firstServerTick !== args.firstServerTick
    ) {
      sessionBound = false;
      reasons.push(
        `Attestation first server tick mismatch: observed ${args.firstServerTick}, but attestation binds to ${attestation.firstServerTick}.`,
      );
    }
    if (args.lastServerTick !== undefined && attestation.lastServerTick !== args.lastServerTick) {
      sessionBound = false;
      reasons.push(
        `Attestation last server tick mismatch: observed ${args.lastServerTick}, but attestation binds to ${attestation.lastServerTick}.`,
      );
    }
    if (attestation.lastServerTick < attestation.firstServerTick) {
      sessionBound = false;
      reasons.push(
        `Attestation tick contradiction: lastServerTick (${attestation.lastServerTick}) precedes firstServerTick (${attestation.firstServerTick}).`,
      );
    }
    const elapsedSampled = attestation.lastServerTick - attestation.firstServerTick;
    if (attestation.totalServerTicks !== elapsedSampled) {
      sessionBound = false;
      reasons.push(
        `Attestation total server ticks contradiction: totalServerTicks (${attestation.totalServerTicks}) does not equal sampled tick progression (${elapsedSampled}).`,
      );
    }
    if (args.totalServerTicks !== undefined && attestation.totalServerTicks !== args.totalServerTicks) {
      sessionBound = false;
      reasons.push(
        `Attestation total server ticks mismatch: observed ${args.totalServerTicks}, but attestation binds to ${attestation.totalServerTicks}.`,
      );
    }
  }

  // 3d. Signed wall-clock interval required on the attestation itself
  if (!attestation.startedAt || !attestation.endedAt) {
    sessionBound = false;
    reasons.push(
      "Attestation missing startedAt/endedAt timestamps. Unsigned or caller-only wall clocks cannot establish continuous Paper capture.",
    );
  } else {
    const startTime = new Date(attestation.startedAt).getTime();
    const endTime = new Date(attestation.endedAt).getTime();
    if (isNaN(startTime) || isNaN(endTime)) {
      sessionBound = false;
      reasons.push("Attestation has invalid startedAt or endedAt timestamp.");
    } else if (endTime <= startTime) {
      sessionBound = false;
      reasons.push(
        `Attestation timestamp contradiction: endedAt ('${attestation.endedAt}') must be after startedAt ('${attestation.startedAt}').`,
      );
    } else {
      const durationSec = (endTime - startTime) / 1000;
      if (attestation.totalServerTicks !== undefined && attestation.totalServerTicks > 0) {
        const tickRate = attestation.totalServerTicks / durationSec;
        if (tickRate > 20.5) {
          sessionBound = false;
          reasons.push(
            `Attestation tick rate contradiction: ${attestation.totalServerTicks} ticks in ${durationSec.toFixed(1)}s (${tickRate.toFixed(1)} TPS) exceeds physical 20 TPS ceiling.`,
          );
        }
      }
      if (args.rawJournalLines && args.rawJournalLines.length > 0) {
        let firstJournalAt: number | undefined;
        let lastJournalAt: number | undefined;
        for (const line of args.rawJournalLines) {
          const t = line.trim();
          if (!t) continue;
          try {
            const parsed = JSON.parse(t);
            if (parsed.at) {
              const ms = new Date(parsed.at).getTime();
              if (!isNaN(ms)) {
                if (firstJournalAt === undefined) firstJournalAt = ms;
                lastJournalAt = ms;
              }
            }
          } catch {
            // ignore
          }
        }
        if (firstJournalAt !== undefined && lastJournalAt !== undefined) {
          const WINDOW_SKEW_TOLERANCE_MS = 5000;
          if (startTime > firstJournalAt + WINDOW_SKEW_TOLERANCE_MS) {
            sessionBound = false;
            reasons.push(
              `Attestation signed window start (${attestation.startedAt}) begins after journal timeline (${new Date(firstJournalAt).toISOString()}) by more than ${WINDOW_SKEW_TOLERANCE_MS / 1000}s allowed skew.`,
            );
          }
          if (endTime < lastJournalAt - WINDOW_SKEW_TOLERANCE_MS) {
            sessionBound = false;
            reasons.push(
              `Attestation signed window end (${attestation.endedAt}) ends before journal timeline (${new Date(lastJournalAt).toISOString()}) by more than ${WINDOW_SKEW_TOLERANCE_MS / 1000}s allowed skew.`,
            );
          }
          const journalSpanMs = lastJournalAt - firstJournalAt;
          if (endTime - startTime < journalSpanMs - WINDOW_SKEW_TOLERANCE_MS) {
            sessionBound = false;
            reasons.push(
              `Attestation signed window duration (${durationSec.toFixed(1)}s) cannot contain journal duration (${(journalSpanMs / 1000).toFixed(1)}s).`,
            );
          }
        }
      }
    }
  }

  // 4. Evidence Digest Verification — journal + attested digest both required for proven
  let computedDigest: string | undefined;
  if (!args.rawJournalLines || args.rawJournalLines.length === 0) {
    signatureValid = false;
    reasons.push(
      "Raw journal lines absent: Paper authenticity requires hashing the complete operator evidence stream covered by the signature.",
    );
  } else {
    computedDigest = createHash("sha256").update(args.rawJournalLines.join("\n")).digest("hex");
    if (!attestation.evidenceDigest || !/^[a-f0-9]{64}$/.test(attestation.evidenceDigest)) {
      signatureValid = false;
      reasons.push(
        "Attestation missing valid evidenceDigest. A signature that does not cover the evidence stream cannot prove authenticity.",
      );
    } else if (attestation.evidenceDigest !== computedDigest) {
      signatureValid = false;
      reasons.push(
        `Evidence stream digest mismatch: computed '${computedDigest}' != attested '${attestation.evidenceDigest}'. The evidence log was modified or truncated after server signing.`,
      );
    }
  }

  // 5. Trust Root & Public Key Lookup
  let trustedPublicKey: KeyObject | undefined;
  if (!attestation.signingAuthority) {
    authorityTrusted = false;
    reasons.push("Attestation missing signing authority declaration.");
  } else {
    if (args.trustedAuthorities !== undefined) {
      if (!args.trustedAuthorities.includes(attestation.signingAuthority)) {
        authorityTrusted = false;
        reasons.push(
          `Signing authority '${attestation.signingAuthority}' is not in the trustedAuthorities allow-list.`,
        );
      }
    }

    let keyInput: string | KeyObject | undefined;
    if (args.trustedKeys && authorityTrusted) {
      if (args.trustedKeys instanceof Map) {
        keyInput = args.trustedKeys.get(attestation.signingAuthority);
      } else if (Object.hasOwn(args.trustedKeys, attestation.signingAuthority)) {
        keyInput = args.trustedKeys[attestation.signingAuthority];
      }
    }

    if (!keyInput) {
      authorityTrusted = false;
      reasons.push(
        `Untrusted signing authority: '${attestation.signingAuthority}' has no registered public key in the operator trust root. Live Paper authenticity cannot be certified without trusted key infrastructure.`,
      );
    } else {
      try {
        trustedPublicKey = parseEd25519PublicKey(keyInput);
      } catch (err: unknown) {
        authorityTrusted = false;
        const message = err instanceof Error ? err.message : "unknown error";
        reasons.push(
          `Failed to parse trusted public key for authority '${attestation.signingAuthority}': ${message}`,
        );
      }
    }
  }

  // 6. Cryptographic Asymmetric Signature Verification
  const rawSig = attestation.signature ?? attestation.attestationSignature;
  if (!rawSig) {
    signatureValid = false;
    reasons.push(
      "Missing attestation signature: paper_server_attested claim lacks cryptographic digital signature.",
    );
  } else {
    const { sigBuffer, error: sigError } = parseEd25519Signature(rawSig);
    if (sigError || !sigBuffer) {
      signatureValid = false;
      reasons.push(sigError ?? "Invalid signature.");
    } else if (trustedPublicKey) {
      // Reconstruct payload ONLY from attested fields — never fill gaps from caller/computed fallbacks.
      const incompletePayloadFields: string[] = [];
      if (!attestation.experimentId) incompletePayloadFields.push("experimentId");
      if (!attestation.captureSessionId) incompletePayloadFields.push("captureSessionId");
      if (!attestation.serverBuild) incompletePayloadFields.push("serverBuild");
      if (!attestation.serverVersion) incompletePayloadFields.push("serverVersion");
      if (!attestation.sourceSha) incompletePayloadFields.push("sourceSha");
      if (!attestation.evidenceDigest) incompletePayloadFields.push("evidenceDigest");
      if (!attestation.startedAt) incompletePayloadFields.push("startedAt");
      if (!attestation.endedAt) incompletePayloadFields.push("endedAt");
      if (attestation.firstServerTick === undefined)
        incompletePayloadFields.push("firstServerTick");
      if (attestation.lastServerTick === undefined) incompletePayloadFields.push("lastServerTick");
      if (attestation.totalServerTicks === undefined)
        incompletePayloadFields.push("totalServerTicks");

      if (incompletePayloadFields.length > 0) {
        signatureValid = false;
        reasons.push(
          `Incomplete signed attestation fields (${incompletePayloadFields.join(", ")}): refusing to verify a signature that does not cover the complete expected evidence.`,
        );
      } else {
        const canonicalPayload = buildCanonicalAttestationPayload({
          experimentId: attestation.experimentId!,
          captureSessionId: attestation.captureSessionId!,
          serverBuild: attestation.serverBuild!,
          serverVersion: attestation.serverVersion!,
          sourceSha: attestation.sourceSha!,
          evidenceDigest: attestation.evidenceDigest!,
          startedAt: attestation.startedAt!,
          endedAt: attestation.endedAt!,
          firstServerTick: attestation.firstServerTick,
          lastServerTick: attestation.lastServerTick,
          totalServerTicks: attestation.totalServerTicks,
        });

        try {
          const verified = verify(null, canonicalPayload, trustedPublicKey, sigBuffer);
          if (!verified) {
            signatureValid = false;
            reasons.push(
              `Cryptographic Ed25519 signature verification failed with trusted public key for '${attestation.signingAuthority}'.`,
            );
          }
        } catch (err: unknown) {
          signatureValid = false;
          const message = err instanceof Error ? err.message : "verification failure";
          reasons.push(`Crypto verify error: ${message}`);
        }
      }
    }
  }

  const proven =
    experimentBound &&
    sessionBound &&
    authorityTrusted &&
    signatureValid &&
    Boolean(trustedPublicKey) &&
    Boolean(attestation.serverBuild && attestation.serverBuild > 0) &&
    Boolean(attestation.sourceSha) &&
    Boolean(attestation.evidenceDigest) &&
    Boolean(args.rawJournalLines && args.rawJournalLines.length > 0) &&
    Boolean(attestation.startedAt && attestation.endedAt) &&
    attestation.firstServerTick !== undefined &&
    attestation.lastServerTick !== undefined &&
    attestation.totalServerTicks !== undefined;

  return {
    proven,
    sourceType: "paper_server_attested",
    authorityTrusted,
    sessionBound,
    experimentBound,
    signatureValid,
    reasons,
  };
}

/**
 * Test Helper: Generates a temporary synthetic Ed25519 keypair for offline tests.
 * Never used for production.
 */
export function createTestAttestationKeypair(): {
  publicKeyPem: string;
  privateKeyPem: string;
  rawPublicKeyHex: string;
} {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const rawPublicKeyHex = publicKey
    .export({ type: "spki", format: "der" })
    .subarray(12)
    .toString("hex");

  return {
    publicKeyPem,
    privateKeyPem,
    rawPublicKeyHex,
  };
}

/**
 * Test Helper: Signs a canonical attestation payload using a synthetic private key.
 */
export function signTestAttestation(
  params: CanonicalAttestationParams,
  privateKeyPem: string,
): { signatureHex: string; signatureFormatted: string; payload: Buffer } {
  const payload = buildCanonicalAttestationPayload(params);
  const sigBuffer = sign(null, payload, createPrivateKey(privateKeyPem));
  const signatureHex = sigBuffer.toString("hex");
  return {
    signatureHex,
    signatureFormatted: `ed25519:${signatureHex}`,
    payload,
  };
}
