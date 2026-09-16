import { clampDelta, clamp01, DURABLE_IMPORTANCE, scoreSalience, SOURCE_CONFIDENCE } from "@civ/memory";
import { z } from "zod";
import { computeDimensions, factualSummary } from "./dimensions.js";
import type { AppraisalInput, AppraisalResult, AssociationProposal, SocialEvidenceKind } from "./types.js";

const AssociationProposalSchema = z.object({
  subjectType: z.enum(["entity", "location", "activity", "citizen", "item", "concept"]),
  subjectKey: z.string().min(1).max(80),
  associationType: z.enum(["danger", "safety", "success", "failure", "help", "threat", "resource"]),
  reinforce: z.number().min(0).max(1).optional(),
  contradict: z.number().min(0).max(1).optional(),
});

export const AppraisalResultSchema = z.object({
  memoryImportance: z.number().min(0).max(1),
  emotionalSalience: z.number().min(0).max(1),
  moodDelta: z.number().min(-0.2).max(0.2),
  stressDelta: z.number().min(-0.2).max(0.2),
  fearDelta: z.number().min(-0.2).max(0.2),
  angerDelta: z.number().min(-0.2).max(0.2),
  sadnessDelta: z.number().min(-0.2).max(0.2),
  positiveAffectDelta: z.number().min(-0.2).max(0.2),
  confidenceDelta: z.number().min(-0.2).max(0.2),
  associationProposals: z.array(AssociationProposalSchema).max(8),
  summary: z.string().min(1).max(280),
  tags: z.array(z.string()).max(16),
  keepDurable: z.boolean(),
});

export type AppraisalProvider = {
  appraise(input: AppraisalInput): AppraisalResult;
};

function boundResult(raw: AppraisalResult): AppraisalResult {
  const parsed = AppraisalResultSchema.parse({
    memoryImportance: clamp01(raw.memoryImportance),
    emotionalSalience: clamp01(raw.emotionalSalience),
    moodDelta: clampDelta(raw.moodDelta),
    stressDelta: clampDelta(raw.stressDelta),
    fearDelta: clampDelta(raw.fearDelta),
    angerDelta: clampDelta(raw.angerDelta),
    sadnessDelta: clampDelta(raw.sadnessDelta),
    positiveAffectDelta: clampDelta(raw.positiveAffectDelta),
    confidenceDelta: clampDelta(raw.confidenceDelta),
    associationProposals: raw.associationProposals,
    summary: raw.summary.slice(0, 280),
    tags: raw.tags.slice(0, 16),
    keepDurable: raw.keepDurable,
  });
  return {
    ...raw,
    ...parsed,
    socialEvidence: raw.socialEvidence,
    subjectiveAppraisal: raw.subjectiveAppraisal,
  };
}

export class DeterministicAppraisal implements AppraisalProvider {
  appraise(input: AppraisalInput): AppraisalResult {
    const { event, source, citizenId } = input;
    const dimensions = input.dimensions;
    const summary = factualSummary(event, citizenId);
    const hints = {
      physicalDanger: event.category === "citizen_damaged" || event.category === "danger_encountered",
      death: event.category === "citizen_death",
      resourceLoss: event.category === "citizen_item_lost" || Boolean(event.facts.destroyed),
      resourceGain: event.category === "citizen_item_received" || event.category === "resource_discovered",
      rescue: event.category === "citizen_helped",
      achievement: event.category === "construction_completed" || event.category === "task_succeeded",
      novelty: dimensions.novelty > 0.5,
    };
    const salience = scoreSalience(event, dimensions, hints);
    const importance = clamp01(salience * 0.75 + Math.abs(dimensions.goalImpact) * 0.25);

    const proposals: AssociationProposal[] = [];
    const tags = [event.category, source.toLowerCase()];
    let socialKind: SocialEvidenceKind | undefined;
    let socialTarget: string | undefined;

    const threatKey = typeof event.facts.threatKey === "string" ? event.facts.threatKey : undefined;
    const attackerType = typeof event.facts.attackerType === "string" ? event.facts.attackerType : undefined;
    const other = event.participants.find((id) => id !== citizenId);

    let moodDelta = dimensions.goalImpact * 0.12;
    let stressDelta = dimensions.threatLevel * 0.12 + dimensions.urgency * 0.05 - (dimensions.helpfulness > 0.5 ? 0.08 : 0);
    let fearDelta = dimensions.threatLevel * 0.14 - (event.facts.outcome === "harmless" ? 0.08 : 0);
    let angerDelta = 0;
    let sadnessDelta = 0;
    let positiveAffectDelta = dimensions.helpfulness * 0.1 + Math.max(0, dimensions.goalImpact) * 0.06;
    let confidenceDelta = 0;

    switch (event.category) {
      case "citizen_item_received": {
        tags.push("help", "food", String(event.facts.item ?? "item"));
        if (event.targetCitizenId === citizenId) {
          socialKind = "help_received";
          socialTarget = event.actorCitizenId;
          positiveAffectDelta += 0.08;
          stressDelta -= 0.06;
        } else if (event.actorCitizenId === citizenId) {
          socialKind = "help_given";
          socialTarget = event.targetCitizenId;
        } else {
          socialKind = "witnessed_act";
          socialTarget = event.actorCitizenId;
        }
        break;
      }
      case "citizen_attacked_citizen": {
        tags.push("conflict", "danger");
        socialKind = "attack";
        socialTarget = event.targetCitizenId === citizenId ? event.actorCitizenId : event.targetCitizenId;
        angerDelta += event.targetCitizenId === citizenId ? 0.12 : 0.04;
        fearDelta += 0.08;
        if (event.actorCitizenId) {
          proposals.push({
            subjectType: "citizen",
            subjectKey: event.actorCitizenId,
            associationType: "threat",
            reinforce: 0.28,
          });
        }
        break;
      }
      case "danger_encountered": {
        const key = threatKey ?? "threat";
        tags.push("danger", key);
        const harmless = event.facts.outcome === "harmless" && !event.facts.harmOccurred;
        proposals.push({
          subjectType: "entity",
          subjectKey: key,
          associationType: "danger",
          reinforce: harmless ? undefined : 0.32,
          contradict: harmless ? 0.18 : undefined,
        });
        if (harmless) {
          fearDelta = -0.08;
          stressDelta = -0.04;
          confidenceDelta = 0.05;
        } else {
          fearDelta += 0.1;
          if (event.facts.destroyed) tags.push("loss", "storage");
        }
        break;
      }
      case "citizen_death": {
        tags.push("death");
        socialKind = "death";
        socialTarget = event.targetCitizenId;
        sadnessDelta += 0.12;
        fearDelta += 0.06;
        moodDelta -= 0.1;
        break;
      }
      case "task_succeeded": {
        const activity = String(event.facts.activity ?? "task");
        tags.push("work", activity);
        confidenceDelta += 0.06;
        proposals.push({
          subjectType: "activity",
          subjectKey: activity,
          associationType: "success",
          reinforce: 0.12,
        });
        break;
      }
      case "task_failed": {
        const activity = String(event.facts.activity ?? "task");
        tags.push("work", activity, "failure");
        confidenceDelta -= 0.05;
        stressDelta += 0.05;
        proposals.push({
          subjectType: "activity",
          subjectKey: activity,
          associationType: "failure",
          reinforce: 0.1,
        });
        break;
      }
      case "citizen_helped": {
        tags.push("help");
        socialKind = event.targetCitizenId === citizenId ? "help_received" : "help_given";
        socialTarget = other;
        break;
      }
      case "construction_completed": {
        tags.push("achievement", "build");
        positiveAffectDelta += 0.08;
        confidenceDelta += 0.05;
        break;
      }
      case "conversation_heard": {
        tags.push("talk");
        socialKind = "witnessed_act";
        socialTarget = event.actorCitizenId;
        break;
      }
      case "promise_agreement": {
        tags.push("promise");
        socialKind = "promise";
        socialTarget = other;
        break;
      }
      default:
        break;
    }

    if (attackerType) {
      proposals.push({
        subjectType: "entity",
        subjectKey: attackerType,
        associationType: "danger",
        reinforce: 0.2,
      });
      tags.push(attackerType);
    }

    const keepDurable = importance >= DURABLE_IMPORTANCE || event.category === "citizen_death" || event.category === "citizen_attacked_citizen";
    const result: AppraisalResult = {
      memoryImportance: importance,
      emotionalSalience: salience,
      moodDelta,
      stressDelta,
      fearDelta,
      angerDelta,
      sadnessDelta,
      positiveAffectDelta,
      confidenceDelta,
      associationProposals: proposals,
      summary,
      tags: [...new Set(tags.filter(Boolean))],
      keepDurable,
      subjectiveAppraisal: { ...dimensions, summary },
      socialEvidence:
        socialKind && socialTarget && socialTarget !== citizenId
          ? {
              observerCitizenId: citizenId,
              targetCitizenId: socialTarget,
              kind: socialKind,
              summary,
              source,
              confidence: SOURCE_CONFIDENCE[source],
              objectiveEventId: event.id,
            }
          : undefined,
    };
    return boundResult(result);
  }
}

export function validateAppraisalOutput(input: unknown): AppraisalResult {
  const parsed = AppraisalResultSchema.parse(input);
  return {
    ...parsed,
    subjectiveAppraisal: {
      goalImpact: 0,
      materialImpact: 0,
      threatLevel: 0,
      helpfulness: 0,
      harm: 0,
      novelty: 0,
      responsibility: 0,
      socialRelevance: 0,
      relationshipRelevance: 0,
      urgency: 0,
      certainty: 0.5,
      summary: parsed.summary,
    },
  };
}

export function buildAppraisalInput(args: {
  citizenId: string;
  event: AppraisalInput["event"];
  source: AppraisalInput["source"];
  psych: AppraisalInput["currentMood"];
  hunger?: number;
  health?: number;
  memories: AppraisalInput["relevantMemories"];
  belief?: AppraisalInput["relationshipEvidence"];
  associations: AppraisalInput["learnedAssociations"];
  activityFamiliarity: Record<string, number>;
}): AppraisalInput {
  return {
    citizenId: args.citizenId,
    event: args.event,
    source: args.source,
    dimensions: computeDimensions({
      event: args.event,
      observerId: args.citizenId,
      psych: args.psych,
      hunger: args.hunger,
      health: args.health,
      associations: args.associations,
    }),
    currentNeeds: { health: args.health, hunger: args.hunger },
    currentMood: args.psych,
    relevantMemories: args.memories,
    relationshipEvidence: args.belief,
    learnedAssociations: args.associations,
    activityFamiliarity: args.activityFamiliarity,
  };
}
