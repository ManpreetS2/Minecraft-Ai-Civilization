/**
 * Shared brain-layer types (cloud pass 3).
 * No fixed personalities / occupations / scripted social outcomes.
 */

export const DECISION_CATEGORIES = ["NO_LLM", "ROUTINE", "IMPORTANT", "DEEP_REFLECTION"] as const;
export type DecisionCategory = (typeof DECISION_CATEGORIES)[number];

export const COMMITMENT_STATUSES = ["ACTIVE", "COMPLETED", "FAILED", "CANCELLED", "EXPIRED"] as const;
export type CommitmentStatus = (typeof COMMITMENT_STATUSES)[number];

export type Commitment = {
  id: string;
  ownerCitizenId: string;
  counterpartyId?: string;
  goal: string;
  createdAt: string;
  status: CommitmentStatus;
  evidence: string[];
  expiresAt?: string;
  reconsiderAt?: string;
  completionEvidence?: string[];
};

export type MoodAffect = {
  /** Coarse labels only — not clinical diagnoses. */
  label: "calm" | "focused" | "frustrated" | "anxious" | "content" | "unknown";
  intensity: number; // 0..1
  evidenceCount: number;
  updatedAt: string;
};

export type LearnedDimension =
  | "help_tendency"
  | "risk_tolerance"
  | "persistence"
  | "social_initiation"
  | "solo_vs_coop"
  | "resource_sharing"
  | "familiar_location_bias";

export type LearnedTendency = {
  dimension: LearnedDimension;
  /** -1..1 directional score; 0 with confidence 0 = unknown, not fabricated neutral. */
  score: number;
  confidence: number; // 0..1
  evidenceCount: number;
  lastUpdatedAt: string;
};

export type RelationshipBelief = {
  /** Observer citizen (whose belief this is). */
  observerId: string;
  /** Other citizen the belief is about. */
  subjectId: string;
  trust: number;
  familiarity: number;
  recentPositive: number;
  recentNegative: number;
  unresolvedRequests: string[];
  unresolvedPromises: string[];
  resourceTransfers: number;
  cooperationCount: number;
  evidenceCount: number;
  updatedAt: string;
};

export type WorldFact = {
  id: string;
  description: string;
  verified: boolean;
};

export type CitizenBelief = {
  about: string;
  description: string;
  confidence: number;
};
