import type { CognitiveStore } from "@civ/memory";
import { activityFromRow } from "./activity.js";
import { deriveBehaviorProfile } from "./behavior-profile.js";
import { describeMood, psychFromRow } from "./psych.js";
import { associationFromRow } from "./associations.js";
import { beliefFromRow } from "./social.js";
import type { BehaviorProfile, CitizenPsychState } from "./types.js";

export type NarrativeInput = {
  citizenId: string;
  name?: string;
};

export function generateCitizenNarrative(store: CognitiveStore, input: NarrativeInput): string {
  const id = input.citizenId;
  const identity = store.getIdentity(id);
  const name = input.name ?? identity?.name ?? id;
  const psych = psychFromRow(store.getPsych(id));
  const activities = store.listActivities(id).map(activityFromRow);
  const beliefs = store.listBeliefs(id).map(beliefFromRow);
  const associations = store.listAssociations(id).map(associationFromRow);
  const memories = store.listDurableMemories(id, 12);
  const profile = deriveBehaviorProfile(store.getObservations(id));
  const deceasedNote = identity?.deceased ? `\nStatus: deceased (history remains readable)\n` : "\n";

  const experience = activities.length
    ? activities
        .slice(0, 6)
        .map((a) => experienceLine(a.activity, a.familiarity, a.confidence))
        .join("\n")
    : "little recorded work experience yet";

  const relationships = beliefs.length
    ? beliefs
        .slice(0, 5)
        .map((b) => relationshipLine(b.targetCitizenId, b))
        .join("\n")
    : "no local social evidence stored yet";

  const tendencies =
    profile.phrases.length > 0
      ? profile.phrases.map((p) => `- ${p}`).join("\n")
      : "- not enough history to describe tendencies yet";

  const important = memories
    .filter((m) => m.importance >= 0.4)
    .slice(0, 6)
    .map((m) => `- ${m.summary}`)
    .join("\n");

  const dangers = associations
    .filter((a) => a.associationType === "danger" || a.associationType === "threat")
    .filter((a) => a.strength >= 0.25)
    .map((a) => `- ${a.subjectKey} (${a.associationType}, strength ${a.strength.toFixed(2)})`)
    .join("\n");

  return [
    name,
    deceasedNote.trimEnd(),
    `Recent state: ${describeMood(psych)}`,
    "",
    "Experience:",
    experience,
    "",
    "Relationships:",
    relationships,
    "",
    "Observed tendencies (from history, not a fixed personality):",
    tendencies,
    "",
    "Learned dangers:",
    dangers || "- none strongly learned yet",
    "",
    "Important memories:",
    important || "- none retained as important yet",
    "",
    affectLine(psych),
    profileEvidence(profile),
  ].join("\n");
}

function experienceLine(activity: string, familiarity: number, confidence: number): string {
  const fam = familiarity >= 0.7 ? "high familiarity" : familiarity >= 0.4 ? "moderate experience" : "little experience";
  return `- ${activity.replaceAll("_", " ")}: ${fam}, confidence ${confidence.toFixed(2)}`;
}

function relationshipLine(targetId: string, belief: ReturnType<typeof beliefFromRow>): string {
  const name = displayName(targetId);
  const help = belief.knownFacts.find((f) => /gave|help/i.test(f.text));
  const work = belief.familiarity >= 0.3 ? `appears to know ${name} from repeated contact` : `has limited familiarity with ${name}`;
  if (help) return `- ${work}; remembers: ${help.text}`;
  if (belief.rumors[0]) return `- ${work}; has heard: ${belief.rumors[0].text}`;
  return `- ${work}`;
}

function affectLine(psych: CitizenPsychState): string {
  return `Affect (simulation state): mood ${psych.moodValence.toFixed(2)}, stress ${psych.stress.toFixed(2)}, fear ${psych.fear.toFixed(2)}, confidence ${psych.confidence.toFixed(2)}`;
}

function profileEvidence(profile: BehaviorProfile): string {
  return `History counts: risk attempts ${profile.evidence.dangerousAttempts}, avoided ${profile.evidence.dangerousAvoided}, mining/work retries ${profile.evidence.retriesAfterFailure}.`;
}

function displayName(id: string): string {
  if (id.startsWith("citizen_")) return id.slice("citizen_".length).replace(/^\w/, (c) => c.toUpperCase());
  return id;
}
