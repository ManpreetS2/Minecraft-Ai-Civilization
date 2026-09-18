import type { CognitionContext } from "@civ/psychology";
import type { RelevantGameKnowledge } from "./context-builder.js";
import { GOALS } from "./goals.js";
import { trimCognitionContext } from "./trim.js";

export function buildDeliberationMessages(
  ctx: CognitionContext,
  contextSize = 8192,
  gameKnowledge?: RelevantGameKnowledge,
): {
  system: string;
  user: string;
} {
  const trimmed = trimCognitionContext(ctx, contextSize);
  const system = [
    "You are a high-level advisor for one Minecraft citizen.",
    "Reply with JSON only: {\"goal\":\"gather_wood\",\"priority\":0.7,\"reason\":\"short sentence\"} plus optional targetCitizenId, targetProjectId, targetResource, uncertainty.",
    "priority must be a number from 0 to 1, not a word such as high.",
    "Choose exactly one high-level goal. Do not choose block-level actions, paths, or specific trees.",
    "Do not invent world facts or claim actions that are not in the evidence.",
    "Inventory summary is physical Mineflayer state. Do not invent carried items, counts, or equipment.",
    "If Relevant Minecraft facts are present, treat them as engine truth, not memories.",
    "Do not assign personality labels such as brave, kind, or hateful.",
    "Do not include chain-of-thought.",
    "If socialize or assist_citizen, include targetCitizenId of someone actually present or evidenced.",
    "Idle rest is allowed when nothing urgent is happening.",
    `Allowed goals: ${GOALS.join(", ")}.`,
  ].join(" ");

  const user = [
    "## Citizen",
    `id: ${trimmed.citizen.id}`,
    `name: ${trimmed.citizen.name ?? trimmed.citizen.id}`,
    "",
    "## Current state",
    `health: ${fmt(trimmed.immediateNeeds.health)}`,
    `hunger: ${fmt(trimmed.immediateNeeds.hunger)}`,
    `currentGoal: ${trimmed.currentGoal ?? "none"}`,
    `currentTask: ${trimmed.currentTask ?? "none"}`,
    `concerns: ${trimmed.immediateNeeds.concerns.join("; ") || "none"}`,
    "",
    "## Inventory summary",
    trimmed.inventorySummary.join(", ") || "empty",
    "",
    "## Nearby world",
    trimmed.nearbyWorldState.entities.join(", ") || "none",
    "",
    "## Settlement needs",
    trimmed.settlementNeeds.join(", ") || "none",
    "",
    ...(gameKnowledge?.facts?.length
      ? [
          "## Relevant Minecraft facts (engine knowledge, compact)",
          gameKnowledge.facts.slice(0, 8).map((fact) => `- ${fact}`).join("\n"),
          "",
        ]
      : []),
    "## Affect (simulation state, not a diagnosis)",
    `moodValence=${trimmed.mood.moodValence.toFixed(2)} stress=${trimmed.mood.stress.toFixed(2)} fear=${trimmed.mood.fear.toFixed(2)} anger=${trimmed.mood.anger.toFixed(2)} sadness=${trimmed.mood.sadness.toFixed(2)} positiveAffect=${trimmed.mood.positiveAffect.toFixed(2)} confidence=${trimmed.mood.confidence.toFixed(2)} (${trimmed.activeAffect.dominant})`,
    "",
    "## Retrieved memories (not full history)",
    formatMemories(trimmed),
    "",
    "## Local social evidence (not global reputation)",
    formatSocial(trimmed),
    "",
    "## Activity familiarity / confidence",
    formatActivities(trimmed),
    "",
    "## Learned associations",
    trimmed.learnedAssociations
      .map((a) => `${a.subjectKey} ${a.associationType} strength=${a.strength.toFixed(2)}`)
      .join("; ") || "none",
    "",
    "## Habits",
    trimmed.habits.map((h) => `${h.action} in ${h.contextKey} (${h.strength.toFixed(2)})`).join("; ") || "none",
    "",
    "## Recent important events",
    trimmed.recentImportantEvents.map((e) => e.summary).join(" | ") || "none",
    "",
    "## Uncertainties",
    trimmed.uncertainties.join(", ") || `score ${trimmed.uncertainty.toFixed(2)}`,
    "",
    "Choose the single most useful high-level goal for this citizen right now.",
  ].join("\n");

  return { system, user };
}

function formatMemories(ctx: CognitionContext): string {
  if (ctx.relevantMemories.length === 0) return "none";
  return ctx.relevantMemories
    .map((m) => `- [${m.source}] ${m.summary} (importance ${m.importance.toFixed(2)})`)
    .join("\n");
}

function formatSocial(ctx: CognitionContext): string {
  if (ctx.relevantSocialBeliefs.length === 0) return "none";
  return ctx.relevantSocialBeliefs
    .map((b) => `- ${b.targetId}: ${b.evidenceSummary} (familiarity ${b.familiarity.toFixed(2)})`)
    .join("\n");
}

function formatActivities(ctx: CognitionContext): string {
  const entries = Object.values(ctx.activityFamiliarity);
  if (entries.length === 0) return "none";
  return entries
    .slice(0, 6)
    .map((a) => `${a.activity} familiarity=${a.familiarity.toFixed(2)} confidence=${a.confidence.toFixed(2)}`)
    .join("; ");
}

function fmt(value: number | undefined): string {
  return value === undefined ? "unknown" : String(value);
}

export function promptContainsPersonalityInjection(text: string): boolean {
  return /you are (brave|kind|aggressive|hateful)|you love |you hate /i.test(text);
}
