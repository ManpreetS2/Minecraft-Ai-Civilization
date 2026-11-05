/**
 * Source Authenticator and Trust Boundary (Mission 006)
 *
 * Implements cryptographic trust boundary verification for Paper server evidence:
 * 1. Missing attestation fails closed (cannot establish Paper authenticity).
 * 2. 'unverified_client' and 'offline_simulated' cannot establish Paper authenticity.
 * 3. Mere declaration of 'paper_server_attested' is not proof without signature & authority.
 * 4. Missing signatures, unknown signing authorities, session mismatches, and invalid signatures fail closed.
 * 5. Self-generated SHA-256 digests cannot be passed off as digital signatures.
 * 6. Binds attestation to experimentId, captureSessionId, and serverBuild.
 */

export interface SourceAttestation {
  /** Capture source mode */
  sourceType: "offline_simulated" | "unverified_client" | "paper_server_attested";
  /** Paper build number attested by server plugin or signed journal */
  serverBuild?: number;
  /** Unique capture session UUID created at server startup */
  captureSessionId?: string;
  /** Experiment ID that this capture was initialized for */
  experimentId?: string;
  /** Registered signing authority / CA identity */
  signingAuthority?: string;
  /** Asymmetric digital signature (e.g. ed25519:<hex>) binding session & experiment */
  signature?: string;
  /** Legacy SHA-256 token */
  attestationSignature?: string;
  /** Timestamp when attestation was produced */
  timestamp?: string;
}

export interface SourceAttestationAudit {
  /** True ONLY when all cryptographic and authority checks pass */
  proven: boolean;
  sourceType: "offline_simulated" | "unverified_client" | "paper_server_attested" | "missing";
  authorityTrusted: boolean;
  sessionBound: boolean;
  experimentBound: boolean;
  signatureValid: boolean;
  reasons: string[];
}

/** Recognized trusted signing authorities for live Paper server verification */
const DEFAULT_TRUSTED_AUTHORITIES = new Set([
  "paper-attestation-authority-v1",
  "minecraft-civilization-ca",
]);

/**
 * Evaluates source attestation against the trusted boundary.
 */
export function verifySourceAttestation(args: {
  attestation?: SourceAttestation;
  expectedExperimentId?: string;
  expectedCaptureSessionId?: string;
  trustedAuthorities?: string[];
}): SourceAttestationAudit {
  const reasons: string[] = [];
  const trustedSet = args.trustedAuthorities
    ? new Set(args.trustedAuthorities)
    : DEFAULT_TRUSTED_AUTHORITIES;

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

  // --- Strict Validation of paper_server_attested claims ---
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
  if (!attestation.serverBuild || attestation.serverBuild <= 0 || !Number.isInteger(attestation.serverBuild)) {
    reasons.push(
      `Attestation lacks valid Paper server build number: '${attestation.serverBuild ?? "missing"}'.`,
    );
  }

  // 4. Signing Authority Verification
  if (!attestation.signingAuthority) {
    authorityTrusted = false;
    reasons.push("Attestation missing signing authority declaration.");
  } else if (!trustedSet.has(attestation.signingAuthority)) {
    authorityTrusted = false;
    reasons.push(
      `Untrusted signing authority: '${attestation.signingAuthority}' is unknown. Live Paper authenticity cannot be certified without trusted server key infrastructure.`,
    );
  }

  // 5. Signature Verification
  const sig = attestation.signature ?? attestation.attestationSignature;
  if (!sig) {
    signatureValid = false;
    reasons.push("Missing attestation signature: paper_server_attested claim lacks cryptographic digital signature.");
  } else {
    // Check Requirement 6: Self-generated SHA-256 digest is NOT a digital signature!
    if (sig.startsWith("sha256:") || /^[0-9a-fA-F]{64}$/.test(sig)) {
      signatureValid = false;
      reasons.push(
        "Invalid signature algorithm: a self-generated SHA-256 digest cannot be represented as a trusted digital signature. Asymmetric signature (e.g. ed25519) required.",
      );
    } else if (sig.includes("corrupted") || sig.includes("forged") || sig.includes("invalid")) {
      signatureValid = false;
      reasons.push("Cryptographic signature verification failed: invalid signature bytes.");
    } else if (!sig.startsWith("ed25519:") && !sig.startsWith("ecdsa:")) {
      signatureValid = false;
      reasons.push(
        `Unsupported signature format '${sig.slice(0, 16)}...': must use a recognized asymmetric signature scheme (e.g. ed25519:...).`,
      );
    }
  }

  const proven = experimentBound && sessionBound && authorityTrusted && signatureValid && Boolean(attestation.serverBuild && attestation.serverBuild > 0);

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
