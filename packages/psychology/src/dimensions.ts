import { clamp01, clampSigned, hungerLabel, type ObjectiveWorldEvent } from "@civ/memory";
import type { AppraisalDimensions, CitizenPsychState, LearnedAssociation } from "./types.js";
import { asNumber, asString } from "./json.js";

function num(facts: Record<string, unknown>, key: string): number | undefined {
  return asNumber(facts[key]);
}

function str(facts: Record<string, unknown>, key: string): string | undefined {
  return asString(facts[key]);
}

/**
 * Observer-specific factual context. Not a moral verdict.
 */
export function computeDimensions(args: {
  event: ObjectiveWorldEvent;
  observerId: string;
  psych: CitizenPsychState;
  hunger?: number;
  health?: number;
  associations: LearnedAssociation[];
}): AppraisalDimensions {
  const { event, observerId, psych, hunger, health, associations } = args;
  const facts = event.facts;
  const isTarget = event.targetCitizenId === observerId;
  const isActor = event.actorCitizenId === observerId;
  const dims: AppraisalDimensions = {
    goalImpact: 0,
    materialImpact: 0,
    threatLevel: 0,
    helpfulness: 0,
    harm: 0,
    novelty: 0.35,
    responsibility: isActor ? 0.6 : isTarget ? -0.2 : 0,
    socialRelevance: event.participants.length > 1 ? 0.45 : 0.1,
    relationshipRelevance: event.participants.some((id) => id !== observerId) ? 0.4 : 0,
    urgency: 0.2,
    certainty: 0.85,
  };

  switch (event.category) {
    case "citizen_item_received": {
      const receiver = str(facts, "receiverId");
      const count = num(facts, "count") ?? 1;
      const receiverHunger = num(facts, "receiverHunger") ?? hunger;
      dims.materialImpact = clampSigned(Math.min(1, count / 8));
      if (receiver === observerId) {
        const starving = (receiverHunger ?? 20) <= 6;
        dims.goalImpact = starving ? 0.85 : 0.35;
        dims.helpfulness = starving ? 0.9 : 0.45;
        dims.urgency = starving ? 0.8 : 0.25;
        dims.novelty = starving ? 0.55 : 0.2;
      } else {
        dims.helpfulness = 0.25;
        dims.goalImpact = 0.05;
      }
      dims.socialRelevance = 0.7;
      break;
    }
    case "citizen_item_lost": {
      const count = num(facts, "count") ?? 1;
      dims.materialImpact = clampSigned(-Math.min(1, count / 8));
      dims.goalImpact = isTarget ? -0.35 : -0.1;
      dims.harm = 0.2;
      break;
    }
    case "citizen_helped": {
      dims.helpfulness = isTarget ? 0.8 : 0.4;
      dims.goalImpact = isTarget ? 0.55 : 0.15;
      dims.socialRelevance = 0.75;
      dims.urgency = 0.4;
      break;
    }
    case "citizen_damaged": {
      const amount = num(facts, "amount") ?? 2;
      dims.harm = clamp01(amount / 12);
      dims.threatLevel = clamp01(0.4 + amount / 20);
      dims.goalImpact = isTarget ? -0.45 : -0.15;
      dims.urgency = 0.7;
      dims.novelty = 0.5;
      if ((health ?? 20) <= 8) dims.urgency = 0.9;
      break;
    }
    case "citizen_attacked_citizen": {
      dims.harm = isTarget ? 0.7 : 0.35;
      dims.threatLevel = 0.75;
      dims.socialRelevance = 0.9;
      dims.relationshipRelevance = 0.85;
      dims.goalImpact = isTarget ? -0.7 : isActor ? 0.1 : -0.2;
      dims.urgency = 0.8;
      dims.novelty = 0.7;
      break;
    }
    case "citizen_death": {
      dims.harm = 1;
      dims.threatLevel = 0.85;
      dims.socialRelevance = 0.95;
      dims.relationshipRelevance = 0.8;
      dims.goalImpact = -0.8;
      dims.urgency = 0.7;
      dims.novelty = 0.95;
      dims.helpfulness = 0;
      break;
    }
    case "danger_encountered": {
      const harmed = Boolean(facts.harmOccurred);
      const outcome = str(facts, "outcome");
      dims.threatLevel = harmed || outcome === "destroyed" ? 0.85 : 0.35;
      dims.harm = harmed || outcome === "destroyed" ? 0.7 : 0.05;
      dims.materialImpact = outcome === "destroyed" ? -0.7 : 0;
      dims.goalImpact = harmed ? -0.5 : 0.1;
      dims.novelty = harmed ? 0.6 : 0.25;
      dims.urgency = harmed ? 0.75 : 0.3;
      break;
    }
    case "task_succeeded": {
      dims.goalImpact = 0.35;
      dims.novelty = 0.1;
      dims.urgency = 0.1;
      dims.helpfulness = 0.05;
      break;
    }
    case "task_failed": {
      dims.goalImpact = -0.3;
      dims.novelty = 0.15;
      dims.urgency = 0.25;
      break;
    }
    case "resource_discovered": {
      dims.materialImpact = 0.25;
      dims.goalImpact = 0.2;
      dims.novelty = 0.35;
      break;
    }
    case "construction_completed": {
      dims.goalImpact = 0.55;
      dims.novelty = 0.4;
      dims.socialRelevance = 0.5;
      break;
    }
    case "conversation_heard": {
      dims.socialRelevance = 0.6;
      dims.relationshipRelevance = 0.45;
      dims.novelty = 0.2;
      dims.certainty = 0.7;
      break;
    }
    case "promise_agreement": {
      dims.socialRelevance = 0.7;
      dims.relationshipRelevance = 0.65;
      dims.goalImpact = 0.2;
      break;
    }
    default:
      break;
  }

  const threatKey = str(facts, "threatKey") ?? str(facts, "attackerType");
  if (threatKey) {
    const known = associations.find(
      (item) => item.subjectKey === threatKey && (item.associationType === "danger" || item.associationType === "threat"),
    );
    if (known) {
      dims.threatLevel = clamp01(dims.threatLevel + known.strength * 0.2);
      dims.novelty = clamp01(dims.novelty * (1 - known.strength * 0.5));
    }
  }

  if (psych.fear > 0.6) dims.threatLevel = clamp01(dims.threatLevel + 0.08);
  if (hunger !== undefined && hunger <= 6 && event.category !== "citizen_item_received") {
    dims.urgency = clamp01(dims.urgency + 0.1);
  }
  return dims;
}

export function factualSummary(event: ObjectiveWorldEvent, observerId: string): string {
  const facts = event.facts;
  switch (event.category) {
    case "citizen_item_received": {
      const giver = str(facts, "giverId") ?? "someone";
      const receiver = str(facts, "receiverId") ?? observerId;
      const item = str(facts, "item") ?? "item";
      const count = num(facts, "count") ?? 1;
      const hungry = hungerLabel(num(facts, "receiverHunger"));
      if (receiver === observerId) {
        return hungry
          ? `${nameOf(giver)} gave me ${count} ${item} when I was ${hungry}.`
          : `${nameOf(giver)} gave me ${count} ${item}.`;
      }
      if (giver === observerId) {
        return `I gave ${nameOf(receiver)} ${count} ${item}.`;
      }
      return `${nameOf(giver)} gave ${nameOf(receiver)} ${count} ${item}.`;
    }
    case "citizen_attacked_citizen": {
      const attacker = str(facts, "attackerId") ?? "someone";
      const victim = str(facts, "victimId") ?? "someone";
      if (victim === observerId) return `${nameOf(attacker)} attacked me.`;
      if (attacker === observerId) return `I attacked ${nameOf(victim)}.`;
      return `${nameOf(attacker)} attacked ${nameOf(victim)}.`;
    }
    case "danger_encountered": {
      const threat = str(facts, "threatKey") ?? "a threat";
      const outcome = str(facts, "outcome") ?? "encountered";
      const destroyed = str(facts, "destroyed");
      if (destroyed) return `A ${threat} destroyed my ${destroyed}.`;
      if (outcome === "harmless") return `I encountered a ${threat} without being harmed.`;
      return `I encountered a ${threat} (${outcome}).`;
    }
    case "citizen_death": {
      const deceased = str(facts, "deceasedId") ?? "someone";
      const cause = str(facts, "cause");
      if (deceased === observerId) return cause ? `I died (${cause}).` : "I died.";
      return cause ? `${nameOf(deceased)} died (${cause}).` : `${nameOf(deceased)} died.`;
    }
    case "task_succeeded":
    case "task_failed": {
      const activity = str(facts, "activity") ?? "a task";
      return event.category === "task_succeeded"
        ? `I completed ${activity}.`
        : `I failed at ${activity}.`;
    }
    case "citizen_helped": {
      const helper = str(facts, "helperId") ?? "someone";
      const recipient = str(facts, "recipientId") ?? "someone";
      if (recipient === observerId) return `${nameOf(helper)} helped me.`;
      if (helper === observerId) return `I helped ${nameOf(recipient)}.`;
      return `${nameOf(helper)} helped ${nameOf(recipient)}.`;
    }
    case "citizen_damaged": {
      const cause = str(facts, "cause") ?? str(facts, "attackerType") ?? "something";
      return `I was hurt by ${cause}.`;
    }
    case "construction_completed":
      return "A construction project was completed.";
    case "resource_discovered":
      return `I found ${str(facts, "resource") ?? "a resource"}.`;
    case "conversation_heard":
      return `${nameOf(str(facts, "speakerId") ?? "someone")} spoke about ${str(facts, "topic") ?? "something"}.`;
    case "promise_agreement":
      return str(facts, "summary") ?? "An agreement was made.";
    case "citizen_item_lost":
      return `I lost ${num(facts, "count") ?? 1} ${str(facts, "item") ?? "item"}.`;
    default:
      return `${event.category} happened.`;
  }
}

function nameOf(id: string): string {
  if (id.startsWith("citizen_")) return id.slice("citizen_".length).replace(/^\w/, (c) => c.toUpperCase());
  return id;
}

export { asNumber, asString };
