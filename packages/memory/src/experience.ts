export type FailureCategory =
  | "AGENT_DECISION"
  | "PLANNING"
  | "SKILL_EXECUTION"
  | "WORLD_CONSTRAINT"
  | "KNOWLEDGE_ERROR"
  | "RESOURCE_CONFLICT"
  | "SOCIAL_OUTCOME"
  | "INFRASTRUCTURE"
  | "NETWORK"
  | "SERVER"
  | "UNKNOWN";

export type ExperienceTrack = "CITIZEN" | "SYSTEM";

export type LessonScope = "PERSONAL" | "SETTLEMENT" | "GENERAL_GAMEPLAY";

export type EpisodeChainStatus = "open" | "recovered" | "failed";

export type DecisionOutcome = "SUCCESS" | "PARTIAL" | "FAILURE" | "UNKNOWN";

export type FailureEpisode = {
  id: string;
  citizenId: string;
  timestamp: string;
  goal?: string;
  task?: string;
  action?: string;
  targetType?: string;
  targetId?: string;
  targetPosition?: { x: number; y: number; z: number };
  contextSummary: string;
  expectedOutcome?: string;
  actualOutcome?: string;
  errorCode?: string;
  errorCategory: FailureCategory;
  track: ExperienceTrack;
  relevantInventory: string[];
  relevantWorldFacts: string[];
  relatedMemoryIds: string[];
  decisionId?: string;
  model?: string;
  chainId?: string;
  previousEpisodeId?: string;
  resolved: boolean;
};

export type SystemIncident = {
  id: string;
  timestamp: string;
  errorCode?: string;
  errorCategory: FailureCategory;
  summary: string;
  episodeId?: string;
  citizenId?: string;
};

export type LearningLesson = {
  id: string;
  citizenId: string;
  scope: LessonScope;
  triggerPattern: string;
  lesson: string;
  confidence: number;
  supportingFailureIds: string[];
  supportingSuccessIds: string[];
  contradictedByIds: string[];
  timesApplied: number;
  successfulApplications: number;
  lastAppliedAt?: string;
  lastUpdatedAt: string;
  createdAt: string;
  active: boolean;
  candidateEngineRule: boolean;
  origin: "deterministic" | "llm_proposal";
};

export type LessonApplication = {
  id: string;
  lessonId: string;
  citizenId: string;
  decisionId?: string;
  goal?: string;
  outcome?: DecisionOutcome;
  createdAt: string;
};

export type EpisodeChain = {
  id: string;
  citizenId: string;
  goal?: string;
  status: EpisodeChainStatus;
  episodeIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type DecisionEvaluation = {
  id: string;
  citizenId: string;
  decisionId?: string;
  goal?: string;
  outcome: DecisionOutcome;
  failureCategory?: FailureCategory;
  relevantLessonIds: string[];
  shouldReconsider: boolean;
  shortExplanation: string;
  createdAt: string;
};

export type LearningMetrics = {
  failuresObserved: number;
  citizenLearningFailures: number;
  systemIncidents: number;
  lessonsCreated: number;
  lessonsRevised: number;
  lessonsContradicted: number;
  lessonsRetrieved: number;
  lessonsApplied: number;
  lessonAssistedSuccesses: number;
  repeatedMistakeCount: number;
};

export const SYSTEM_FAILURE_CATEGORIES: ReadonlySet<FailureCategory> = new Set([
  "INFRASTRUCTURE",
  "NETWORK",
  "SERVER",
]);

export type LessonRetrievalQuery = {
  citizenId: string;
  goal?: string;
  errorCode?: string;
  resource?: string;
  participants?: string[];
  limit?: number;
};
