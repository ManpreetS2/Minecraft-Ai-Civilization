import type { Vec3 } from "@civ/shared";

export type KnowledgeSource = "DIRECT" | "WITNESSED" | "HEARD" | "RECORD" | "INFERRED";

export type MemoryType = "immediate" | "episodic" | "semantic" | "social" | "association";

export type ObjectiveEventCategory =
  | "citizen_damaged"
  | "citizen_helped"
  | "citizen_item_received"
  | "citizen_item_lost"
  | "task_succeeded"
  | "task_failed"
  | "resource_discovered"
  | "danger_encountered"
  | "citizen_attacked_citizen"
  | "citizen_death"
  | "construction_completed"
  | "conversation_heard"
  | "promise_agreement";

/**
 * Factual context dimensions for an observer.
 * These are evidence/context, not moral labels or personality scores.
 */
export type AppraisalDimensions = {
  goalImpact: number;
  materialImpact: number;
  threatLevel: number;
  helpfulness: number;
  harm: number;
  novelty: number;
  responsibility: number;
  socialRelevance: number;
  relationshipRelevance: number;
  urgency: number;
  certainty: number;
};

export type SubjectiveAppraisal = AppraisalDimensions & {
  /** Citizen-facing interpretation of impact. Never hidden chain-of-thought. */
  summary: string;
};

export type StoredMemory = {
  id: string;
  citizenId: string;
  memoryType: MemoryType;
  eventType: string;
  timestamp: string;
  gameTime?: number;
  summary: string;
  participants: string[];
  location?: Vec3;
  objectiveFacts: Record<string, unknown>;
  subjectiveAppraisal?: SubjectiveAppraisal;
  emotionalSalience: number;
  importance: number;
  source: KnowledgeSource;
  confidence: number;
  tags: string[];
  relatedEntityIds: string[];
  createdAt: string;
  lastRecalledAt?: string;
  recallCount: number;
  compressed: boolean;
  expiresAt?: string;
  targetCitizenId?: string;
  supportingMemoryIds: string[];
};

export type ImmediateMemory = StoredMemory & { memoryType: "immediate"; expiresAt: string };
export type EpisodicMemory = StoredMemory & { memoryType: "episodic"; subjectiveAppraisal: SubjectiveAppraisal };
export type SemanticMemory = StoredMemory & { memoryType: "semantic" };
export type SocialMemory = StoredMemory & { memoryType: "social"; targetCitizenId: string };
export type AssociationMemory = StoredMemory & { memoryType: "association" };

export type ObjectiveWorldEvent = {
  id: string;
  category: ObjectiveEventCategory;
  timestamp: string;
  gameTime?: number;
  location?: Vec3;
  actorCitizenId?: string;
  targetCitizenId?: string;
  participants: string[];
  facts: Record<string, unknown>;
};

export type SnapshotCitizen = {
  id: string;
  name?: string;
  status?: string;
  position?: Vec3;
  health?: number;
  hunger?: number;
  deceased?: boolean;
};

export type WorldSnapshot = {
  citizens: SnapshotCitizen[];
  settlementOrigin?: Vec3;
  isNight?: boolean;
  nearbyRadius?: number;
};

export type CognitiveIdentity = {
  citizenId: string;
  name?: string;
  deceased: boolean;
  deceasedAt?: string;
  createdAt: string;
};

export type RetrievalQuery = {
  citizenId: string;
  currentGoal?: string;
  nearbyEntities?: string[];
  location?: Vec3;
  currentMood?: { valence?: number; fear?: number; stress?: number };
  currentEvent?: { category?: string; participants?: string[]; tags?: string[] };
  participants?: string[];
  query?: string;
  limit?: number;
};

export type ScoredMemory = {
  memory: StoredMemory;
  score: number;
  reasons: string[];
};

export type MemoryParticipant = {
  memoryId: string;
  citizenId: string;
  role: string;
};

export type RoutineAggregate = {
  citizenId: string;
  bucketKey: string;
  period: string;
  count: number;
  successCount: number;
  lastAt: string;
};

export type BehaviorObservations = {
  citizenId: string;
  dangerousAttempts: number;
  dangerousAvoided: number;
  retriesAfterFailure: number;
  taskFailures: number;
  socialInteractions: number;
  cooperativeActs: number;
  conflictActs: number;
  explorationActs: number;
  familiarTaskChoices: number;
  totalTaskChoices: number;
  updatedAt: string;
};

export type Clock = {
  now: () => Date;
  iso: () => string;
  millis: () => number;
};

export type IdFactory = () => string;

export const SOURCE_CONFIDENCE: Record<KnowledgeSource, number> = {
  DIRECT: 0.95,
  WITNESSED: 0.8,
  RECORD: 0.7,
  HEARD: 0.5,
  INFERRED: 0.4,
};

export const OBJECTIVE_EVENT_CATEGORIES: readonly ObjectiveEventCategory[] = [
  "citizen_damaged",
  "citizen_helped",
  "citizen_item_received",
  "citizen_item_lost",
  "task_succeeded",
  "task_failed",
  "resource_discovered",
  "danger_encountered",
  "citizen_attacked_citizen",
  "citizen_death",
  "construction_completed",
  "conversation_heard",
  "promise_agreement",
] as const;
