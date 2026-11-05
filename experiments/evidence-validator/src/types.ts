/**
 * Types and interfaces for the Offline Evidence Validator.
 *
 * Implements the P0 provenance chain:
 * World event -> Legitimate observation -> Citizen belief -> Decision -> Attempted action -> Verified physical outcome.
 */

export type SimulationMode = "offline_simulated" | "real_minecraft";

export type ProvenanceClassification =
  | "observed_fact"
  | "communicated_claim"
  | "planned_action"
  | "attempted_action"
  | "successful_action"
  | "unverified_assertion";

export type OverallValidationStatus =
  | "VERIFIED"
  | "VIOLATIONS_DETECTED"
  | "NOT_PROVEN";

export type ActionVerificationStatus =
  | "VERIFIED"
  | "UNVERIFIED"
  | "FAILED"
  | "INTERRUPTED"
  | "CORRUPTED";

export type Vec3Point = {
  x: number;
  y: number;
  z: number;
};

export type WorldBlockChange = {
  position: Vec3Point;
  before: string;
  after: string;
};

export type ActionAttemptEvidence = {
  citizenId: string;
  attemptId: string;
  action: "gather" | "craft" | "place" | "eat" | "move" | "speech" | string;
  decisionSource: "model" | "planner" | "reflex";
  decisionEventId: string;
  expectedItem?: string;
  target?: Vec3Point;
  range?: number;
  originPosition?: Vec3Point;
  timestamp?: string;
};

export type ActionObservationEvidence = {
  citizenId: string;
  attemptId: string;
  successReported: boolean;
  verified?: boolean;
  beforeInventory: Record<string, number>;
  afterInventory: Record<string, number>;
  position?: Vec3Point;
  hungerBefore?: number;
  hungerAfter?: number;
  healthBefore?: number;
  healthAfter?: number;
  worldChanges: WorldBlockChange[];
  authorizedRecipients?: string[];
  failureCode?: string;
  timestamp?: string;
  /** Phase 2: tool durability snapshots. Absent in current recorder - reported NOT_PROVEN when missing. */
  toolDurabilityBefore?: Record<string, number>;
  toolDurabilityAfter?: Record<string, number>;
};

export type ProvenanceChainLink = {
  worldEventProven: boolean;
  legitimatelyObserved: boolean;
  legitimateBelief: boolean;
  decisionDocumented: boolean;
  actionAttempted: boolean;
  physicalOutcomeVerified: boolean;
};

export type ActionVerificationResult = {
  attemptId: string;
  citizenId: string;
  action: string;
  decisionEventId: string;
  decisionSource: string;
  status: ActionVerificationStatus;
  classification: ProvenanceClassification;
  chain: ProvenanceChainLink;
  physicalDeltas: {
    inventoryDelta: Record<string, number>;
    hungerDelta?: number;
    healthDelta?: number;
    worldChangesCount: number;
    positionReached?: boolean;
    distanceToTarget?: number;
    recipientCount?: number;
  };
  reasons: string[];
  failureCode?: string;
};

export type InformationViolationType =
  | "RIVAL_SETTLEMENT_LEAK"
  | "PRIVATE_CHEST_LEAK"
  | "ACTOR_PRIVATE_LEAK"
  | "UNSUBSTANTIATED_SPEECH"
  | "CLAIM_PROMOTED_TO_FACT"
  | "UNKNOWN_AUDIENCE_LEAK"
  | "MISSING_SOURCE_EVENT";

export type InformationBoundaryViolation = {
  violationType: InformationViolationType;
  eventId?: string;
  factId?: string;
  citizenId: string;
  sourceCitizenId?: string;
  description: string;
  evidenceRef?: string;
};

export type InformationBoundaryAudit = {
  totalAuditedEvents: number;
  totalAuditedFacts: number;
  observedFactsCount: number;
  communicatedClaimsCount: number;
  violations: InformationBoundaryViolation[];
  valid: boolean;
};

export type InventoryDiscrepancy = {
  citizenId: string;
  item: string;
  amount: number;
  type: "SPONTANEOUS_GAIN" | "DOUBLE_COUNT" | "UNEXPLAINED_LOSS";
  description: string;
};

export type InventoryConservationAudit = {
  initialInventoriesEmpty: boolean;
  totalItemsAcquired: Record<string, number>;
  totalItemsConsumed: Record<string, number>;
  citizenFinalInventories: Record<string, Record<string, number>>;
  discrepancies: InventoryDiscrepancy[];
  valid: boolean;
};

export interface SourceAttestation {
  sourceType: "offline_simulated" | "unverified_client" | "paper_server_attested";
  serverBuild?: number;
  captureSessionId?: string;
  experimentId?: string;
  signingAuthority?: string;
  signature?: string;
  attestationSignature?: string;
  timestamp?: string;
}

export interface SourceAttestationAudit {
  proven: boolean;
  sourceType: "offline_simulated" | "unverified_client" | "paper_server_attested" | "missing";
  authorityTrusted: boolean;
  sessionBound: boolean;
  experimentBound: boolean;
  signatureValid: boolean;
  reasons: string[];
}

export type DurationTickAudit = {
  claimedDurationMinutes: number;
  provenDurationMs: number;
  provenDurationMinutes: number;
  tickCount: number;
  averageTickDurationMs: number;
  averageTps?: number;
  tpsEvidencePresent: boolean;
  /** Phase 2: true only when monotone serverGameTick values prove uninterrupted Paper server progression */
  serverTickProven: boolean;
  /** Phase 2: number of ticks carrying serverGameTick evidence */
  serverTickCount: number;
  durationComplete: boolean;
  gapsDetected: Array<{ fromSeq: number; toSeq: number; gapMs: number }>;
  sourceAttestationAudit?: SourceAttestationAudit;
  reasons: string[];
};

export type HashChainAudit = {
  valid: boolean;
  totalRows: number;
  brokenSeq?: number;
  error?: string;
};

export type MissingEvidenceItem = {
  code: string;
  citizenId?: string;
  description: string;
  missingFields: string[];
};

export type ValidationReportSummary = {
  totalAttemptedActions: number;
  verifiedActions: number;
  unverifiedActions: number;
  failedActions: number;
  interruptedActions: number;
  observedFacts: number;
  communicatedClaims: number;
  privacyViolationsCount: number;
  inventoryViolationsCount: number;
  hashChainValid: boolean;
  durationVerified: boolean;
  notProvenChecksCount: number;
};

export type ValidationReport = {
  version: "1.0.0";
  validatorName: "antigravity-evidence-validator";
  generatedAt: string;
  experimentId: string;
  sourceSha: string;
  mode: SimulationMode;
  overallStatus: OverallValidationStatus;
  summary: ValidationReportSummary;
  hashChainAudit: HashChainAudit;
  durationAudit: DurationTickAudit;
  sourceAttestationAudit?: SourceAttestationAudit;
  inventoryAudit: InventoryConservationAudit;
  informationAudit: InformationBoundaryAudit;
  actionVerifications: ActionVerificationResult[];
  violations: Array<{
    code: string;
    citizenId?: string;
    description: string;
    severity: "ERROR" | "WARNING";
  }>;
  notProven: MissingEvidenceItem[];
  redacted: true;
  attribution: {
    runId: string;
    citizens: string[];
    communities: string[];
  };
};
