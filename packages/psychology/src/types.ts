import type {
  AppraisalDimensions,
  KnowledgeSource,
  ObjectiveWorldEvent,
  StoredMemory,
  SubjectiveAppraisal,
} from "@civ/memory";

export type { AppraisalDimensions };

export type CurrentConcern = {
  id: string;
  description: string;
  urgency: number;
  relatedMemoryIds: string[];
  createdAt: string;
};

/**
 * Simulation affect. Not a diagnosis.
 * Use: low mood, fear, stress, sadness, withdrawal, confidence.
 * Do not use: depression, anxiety disorder, mental illness labels.
 */
export type CitizenPsychState = {
  citizenId: string;
  moodValence: number;
  stress: number;
  fear: number;
  anger: number;
  sadness: number;
  positiveAffect: number;
  confidence: number;
  currentConcerns: CurrentConcern[];
  updatedAt: string;
};

export type PsychDeltas = {
  moodDelta?: number;
  stressDelta?: number;
  fearDelta?: number;
  angerDelta?: number;
  sadnessDelta?: number;
  positiveAffectDelta?: number;
  confidenceDelta?: number;
};

export type AssociationSubjectType = "entity" | "location" | "activity" | "citizen" | "item" | "concept";
export type AssociationType = "danger" | "safety" | "success" | "failure" | "help" | "threat" | "resource";

export type LearnedAssociation = {
  id: string;
  citizenId: string;
  subjectType: AssociationSubjectType;
  subjectKey: string;
  associationType: AssociationType;
  strength: number;
  confidence: number;
  supportingMemoryIds: string[];
  lastReinforcedAt: string;
  lastContradictedAt?: string;
};

export type AssociationProposal = {
  subjectType: AssociationSubjectType;
  subjectKey: string;
  associationType: AssociationType;
  reinforce?: number;
  contradict?: number;
};

export const ACTIVITIES = [
  "gather_wood",
  "gather_food",
  "mine_stone",
  "craft_tools",
  "build",
  "explore",
  "fight",
  "trade",
  "farm",
] as const;

export type ActivityName = (typeof ACTIVITIES)[number] | string;

export type ActivityExperience = {
  citizenId: string;
  activity: string;
  attempts: number;
  successes: number;
  failures: number;
  recentSuccessRate: number;
  familiarity: number;
  confidence: number;
  lastPerformedAt?: string;
};

export type Habit = {
  id: string;
  citizenId: string;
  contextKey: string;
  action: string;
  occurrences: number;
  successes: number;
  failures: number;
  strength: number;
  lastReinforcedAt: string;
};

export type KnownFact = {
  text: string;
  source: KnowledgeSource;
  confidence: number;
  memoryId?: string;
  createdAt: string;
};

export type Rumor = {
  text: string;
  informantId: string;
  confidence: number;
  aboutCitizenId?: string;
  createdAt: string;
};

export type SocialEvidenceKind =
  | "help_given"
  | "help_received"
  | "attack"
  | "item_taken"
  | "item_given"
  | "promise"
  | "rumor"
  | "witnessed_act"
  | "death"
  | "cooperation"
  | "betrayal";

export type SocialEvidence = {
  id: string;
  observerCitizenId: string;
  targetCitizenId: string;
  kind: SocialEvidenceKind;
  summary: string;
  source: KnowledgeSource;
  informantId?: string;
  confidence: number;
  memoryId?: string;
  objectiveEventId?: string;
  createdAt: string;
};

export type SocialBelief = {
  observerCitizenId: string;
  targetCitizenId: string;
  familiarity: number;
  trustEvidence: number;
  affectionEvidence: number;
  respectEvidence: number;
  resentmentEvidence: number;
  knownFacts: KnownFact[];
  rumors: Rumor[];
  relevantMemoryIds: string[];
  confidence: number;
  lastUpdatedAt: string;
};

export type AppraisalInput = {
  citizenId: string;
  event: ObjectiveWorldEvent;
  source: KnowledgeSource;
  dimensions: AppraisalDimensions;
  currentNeeds: { health?: number; hunger?: number; safety?: number };
  currentMood: CitizenPsychState;
  relevantMemories: StoredMemory[];
  relationshipEvidence?: SocialBelief;
  learnedAssociations: LearnedAssociation[];
  activityFamiliarity: Record<string, number>;
};

export type AppraisalResult = {
  memoryImportance: number;
  emotionalSalience: number;
  moodDelta: number;
  stressDelta: number;
  fearDelta: number;
  angerDelta: number;
  sadnessDelta: number;
  positiveAffectDelta: number;
  confidenceDelta: number;
  associationProposals: AssociationProposal[];
  socialEvidence?: Omit<SocialEvidence, "id" | "createdAt">;
  summary: string;
  tags: string[];
  keepDurable: boolean;
  subjectiveAppraisal: SubjectiveAppraisal;
};

export type BehaviorProfile = {
  citizenId: string;
  observedRiskTaking: number;
  observedPersistence: number;
  observedSociability: number;
  observedCooperation: number;
  observedExploration: number;
  observedConflictTendency: number;
  observedPreferenceForFamiliarTasks: number;
  evidence: {
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
  };
  phrases: string[];
};

export type CognitionContext = {
  citizen: { id: string; name?: string; deceased?: boolean };
  immediateNeeds: { health?: number; hunger?: number; concerns: string[] };
  currentGoal?: string;
  nearbyWorldState: { entities: string[]; location?: { x: number; y: number; z: number } };
  mood: CitizenPsychState;
  activeAffect: { dominant: string; intensity: number };
  relevantMemories: Array<{
    summary: string;
    importance: number;
    source: KnowledgeSource;
    eventType: string;
  }>;
  relevantSocialBeliefs: Array<{
    targetId: string;
    evidenceSummary: string;
    familiarity: number;
    sourceNotes: string[];
  }>;
  activityFamiliarity: Record<string, ActivityExperience>;
  learnedAssociations: LearnedAssociation[];
  recentImportantEvents: Array<{ summary: string; timestamp: string }>;
  settlementNeeds: string[];
  uncertainty: number;
};

export type ReflectionKind =
  | "close_citizen_death"
  | "major_betrayal"
  | "settlement_destruction"
  | "migration_decision"
  | "leadership_conflict"
  | "major_achievement"
  | "belief_changing_discovery"
  | "large_resource_loss";

export type ReflectionTrigger = {
  id: string;
  kind: ReflectionKind;
  citizenId: string;
  eventId?: string;
  salience: number;
  createdAt: string;
};

export type ReflectionContext = {
  trigger: ReflectionTrigger;
  relevantMemories: StoredMemory[];
  psychState: CitizenPsychState;
  socialBeliefs: SocialBelief[];
};

export type ReflectionResult = {
  citizenId: string;
  triggerKind: ReflectionKind;
  summary: string;
  proposedSemanticFacts: string[];
  proposedAssociationRevisions: AssociationProposal[];
  moodDelta: number;
  createdAt: string;
};

export type HeardClaim = {
  observerId: string;
  informantId: string;
  claim: string;
  aboutCitizenId?: string;
  timestamp?: string;
};

export type IngestResult = {
  eventId: string;
  memoriesCreated: StoredMemory[];
  skippedDistant: string[];
  deceasedPreserved: boolean;
};
