import {
  CognitiveStore,
  EmbeddingQueue,
  NoopEmbeddingProvider,
  retrieveMemories,
  systemClock,
  type Clock,
  type EmbeddingProvider,
  type IdFactory,
  type ObjectiveWorldEvent,
  type RetrievalQuery,
  type ScoredMemory,
  type WorldSnapshot,
} from "@civ/memory";
import { randomId } from "@civ/memory";
import { associationFromRow } from "./associations.js";
import { activityFromRow } from "./activity.js";
import { DeterministicAppraisal, type AppraisalProvider } from "./appraisal.js";
import { deriveBehaviorProfile } from "./behavior-profile.js";
import { buildCognitionContext, formatCognitionContext, toLegacyPromptMemories, type ContextInput } from "./context.js";
import { consolidateCitizen } from "./consolidation.js";
import { ingestHeardClaim, ingestObjectiveEvent } from "./ingestion.js";
import { generateCitizenNarrative } from "./narrative.js";
import { psychFromRow } from "./psych.js";
import { beliefFromRow } from "./social.js";
import { habitFromRow } from "./habits.js";
import type {
  BehaviorProfile,
  CitizenPsychState,
  CognitionContext,
  HeardClaim,
  IngestResult,
  SocialBelief,
} from "./types.js";

export type CitizenMindOptions = {
  clock?: Clock;
  id?: IdFactory;
  embeddings?: EmbeddingProvider;
  appraisal?: AppraisalProvider;
};

export type CitizenCognitiveSnapshot = {
  citizenId: string;
  deceased: boolean;
  psych: CitizenPsychState;
  memories: ReturnType<CognitiveStore["listDurableMemories"]>;
  beliefs: SocialBelief[];
  activities: ReturnType<typeof activityFromRow>[];
  associations: ReturnType<typeof associationFromRow>[];
  habits: ReturnType<typeof habitFromRow>[];
  behaviorProfile: BehaviorProfile;
  narrative: string;
};

/**
 * Isolated cognitive runtime. Informs high-level decisions only.
 * Does not control block-level movement or survival reflexes.
 */
export class CitizenMind {
  readonly store: CognitiveStore;
  private readonly clock: Clock;
  private readonly id: IdFactory;
  private readonly appraisal: AppraisalProvider;
  private readonly embeddings: EmbeddingQueue;

  constructor(store: CognitiveStore, options: CitizenMindOptions = {}) {
    this.store = store;
    this.clock = options.clock ?? systemClock();
    this.id = options.id ?? randomId;
    this.appraisal = options.appraisal ?? new DeterministicAppraisal();
    const provider = options.embeddings ?? new NoopEmbeddingProvider();
    this.embeddings = new EmbeddingQueue(provider, (job, vector) => {
      this.store.saveEmbedding({
        memoryId: job.memoryId,
        citizenId: job.citizenId,
        model: provider.name,
        dims: vector.length,
        vector,
        createdAt: this.clock.iso(),
      });
    });
  }

  ingest(event: ObjectiveWorldEvent, snapshot: WorldSnapshot): IngestResult {
    const result = ingestObjectiveEvent(this.store, event, snapshot, {
      clock: this.clock,
      id: this.id,
      appraisal: this.appraisal,
    });
    for (const memory of result.memoriesCreated) {
      if (memory.importance >= 0.35) {
        this.embeddings.enqueue({
          memoryId: memory.id,
          citizenId: memory.citizenId,
          text: memory.summary,
        });
      }
    }
    return result;
  }

  hear(claim: HeardClaim) {
    return ingestHeardClaim(this.store, claim, { clock: this.clock, id: this.id });
  }

  retrieve(query: RetrievalQuery): ScoredMemory[] {
    const memories = this.store.listDurableMemories(query.citizenId, 120);
    const embeddings = new Map(
      this.store.listEmbeddings(query.citizenId).map((row) => [row.memoryId, row.vector] as const),
    );
    const scored = retrieveMemories(memories, query, { embeddings });
    for (const item of scored) this.store.markRecalled(item.memory.id, this.clock.iso());
    return scored;
  }

  context(input: ContextInput): CognitionContext {
    return buildCognitionContext(this.store, input);
  }

  narrative(citizenId: string, name?: string): string {
    return generateCitizenNarrative(this.store, { citizenId, name });
  }

  snapshot(citizenId: string): CitizenCognitiveSnapshot {
    const identity = this.store.getIdentity(citizenId);
    return {
      citizenId,
      deceased: Boolean(identity?.deceased),
      psych: psychFromRow(this.store.getPsych(citizenId)),
      memories: this.store.listDurableMemories(citizenId, 100),
      beliefs: this.store.listBeliefs(citizenId).map(beliefFromRow),
      activities: this.store.listActivities(citizenId).map(activityFromRow),
      associations: this.store.listAssociations(citizenId).map(associationFromRow),
      habits: this.store.listHabits(citizenId).map(habitFromRow),
      behaviorProfile: deriveBehaviorProfile(this.store.getObservations(citizenId)),
      narrative: this.narrative(citizenId, identity?.name),
    };
  }

  consolidate(citizenId: string) {
    return consolidateCitizen(this.store, citizenId, this.clock.iso(), this.id);
  }

  whatDoesCitizenRemember(citizenId: string) {
    return this.snapshot(citizenId).memories.map((m) => ({
      summary: m.summary,
      source: m.source,
      importance: m.importance,
      eventType: m.eventType,
    }));
  }

  whatDoesCitizenBelieveAbout(observerId: string, targetId: string): SocialBelief | undefined {
    const row = this.store.getBelief(observerId, targetId);
    return row ? beliefFromRow(row) : undefined;
  }
}

export { formatCognitionContext, toLegacyPromptMemories };
