import type { Relationship } from "@civ/shared";

export type SocialEvent =
  | "helped"
  | "shared_food"
  | "cooperated"
  | "took_resources"
  | "failed_together"
  | "rescued"
  | "conflict"
  | "talked"
  | "proximity";

export type MeaningfulSocialCause =
  | "joint_work"
  | "item_transfer"
  | "rescue"
  | "help_request"
  | "conflict"
  | "discovery"
  | "settlement_event"
  | "llm_decision";

const CLAMP = (value: number) => Math.max(-1, Math.min(1, value));

export function applySocialEvent(rel: Relationship, event: SocialEvent): Relationship {
  const next = { ...rel };
  switch (event) {
    case "helped":
    case "rescued":
      next.trust += 0.12;
      next.respect += 0.1;
      next.affection += 0.05;
      break;
    case "shared_food":
      next.affection += 0.12;
      next.trust += 0.08;
      break;
    case "cooperated":
      next.trust += 0.06;
      next.familiarity += 0.08;
      next.respect += 0.04;
      break;
    case "took_resources":
      next.trust -= 0.1;
      next.resentment += 0.12;
      break;
    case "conflict":
      next.resentment += 0.15;
      next.trust -= 0.08;
      break;
    case "failed_together":
      next.familiarity += 0.05;
      next.respect += 0.02;
      break;
    case "talked":
      next.familiarity += 0.04;
      break;
    case "proximity":
      next.familiarity += 0.01;
      break;
  }
  next.trust = CLAMP(next.trust);
  next.affection = CLAMP(next.affection);
  next.respect = CLAMP(next.respect);
  next.resentment = CLAMP(next.resentment);
  next.familiarity = CLAMP(next.familiarity);
  return next;
}

export type ConversationRequest = {
  cause: MeaningfulSocialCause;
  trigger: SocialEvent;
  speaker: string;
  other: string;
  topic: string;
  now?: number;
  speakChance?: number;
};

export type ConversationDecision = {
  shouldSpeak: boolean;
  message?: string;
  applyRelationship: boolean;
  suppressedReason?: string;
};

const SPEAKER_COOLDOWN_MS = 120_000;
const PAIR_COOLDOWN_MS = 180_000;
const EVENT_SUPPRESS_MS = 300_000;
const RELATIONSHIP_COOLDOWN_MS = 240_000;

const VARIANTS: Record<SocialEvent, (other: string, topic: string) => string[]> = {
  helped: (other, topic) => [
    `${other}, that ${topic} was easier with you here.`,
    `${other} — thanks. I was stuck on ${topic}.`,
  ],
  shared_food: (other, _topic) => [
    `${other}, here. Eat.`,
    `${other}, take this food.`,
  ],
  cooperated: (other, topic) => [
    `${other}, we both worked that ${topic}.`,
    `${other}, same job, same place.`,
  ],
  took_resources: (other, _topic) => [`${other}, that was from the shared pile.`],
  failed_together: (other, topic) => [`${other}, that ${topic} failed. Different plan.`],
  rescued: (other, _topic) => [`${other}, I thought that was it.`, `${other} — still standing.`],
  conflict: (other, _topic) => [`${other}, enough.`],
  talked: (other, topic) => [`${other}: ${topic}`],
  proximity: () => [],
};

export class SocialDirector {
  private lastSpokeAt = new Map<string, number>();
  private lastPairAt = new Map<string, number>();
  private lastEventAt = new Map<string, number>();
  private lastRelationshipAt = new Map<string, number>();
  private lastLines = new Map<string, string>();

  considerConversation(request: ConversationRequest): ConversationDecision {
    const now = request.now ?? Date.now();
    if (request.cause === "item_transfer" && request.trigger !== "shared_food") {
      return { shouldSpeak: false, applyRelationship: false, suppressedReason: "item_transfer_mismatch" };
    }
    if (request.trigger === "shared_food" && request.cause !== "item_transfer") {
      return { shouldSpeak: false, applyRelationship: false, suppressedReason: "no_actual_transfer" };
    }
    if (request.trigger === "cooperated" && request.cause !== "joint_work" && request.cause !== "settlement_event") {
      return { shouldSpeak: false, applyRelationship: false, suppressedReason: "not_joint_work" };
    }

    const pairKey = pairId(request.speaker, request.other);
    const eventKey = `${pairKey}:${request.trigger}:${normalizeTopic(request.topic)}`;
    const applyRelationship = this.canApplyRelationship(pairKey, eventKey, now);

    const lastSpoke = this.lastSpokeAt.get(request.speaker);
    if (lastSpoke !== undefined && now - lastSpoke < SPEAKER_COOLDOWN_MS) {
      return { shouldSpeak: false, applyRelationship, suppressedReason: "speaker_cooldown" };
    }
    const lastPair = this.lastPairAt.get(pairKey);
    if (lastPair !== undefined && now - lastPair < PAIR_COOLDOWN_MS) {
      return { shouldSpeak: false, applyRelationship, suppressedReason: "pair_cooldown" };
    }
    const lastEvent = this.lastEventAt.get(eventKey);
    if (lastEvent !== undefined && now - lastEvent < EVENT_SUPPRESS_MS) {
      return { shouldSpeak: false, applyRelationship, suppressedReason: "repeated_event" };
    }

    const chance = request.speakChance ?? 0.22;
    if (Math.random() > chance) {
      return { shouldSpeak: false, applyRelationship, suppressedReason: "silence" };
    }

    const message = pickLine(request.trigger, request.other, request.topic);
    if (!message) {
      return { shouldSpeak: false, applyRelationship, suppressedReason: "no_line" };
    }
    const previous = this.lastLines.get(request.speaker);
    if (previous && similarLine(previous, message)) {
      return { shouldSpeak: false, applyRelationship, suppressedReason: "duplicate_line" };
    }

    this.lastSpokeAt.set(request.speaker, now);
    this.lastPairAt.set(pairKey, now);
    this.lastEventAt.set(eventKey, now);
    this.lastLines.set(request.speaker, message);
    return { shouldSpeak: true, message, applyRelationship };
  }

  noteRelationshipApplied(speaker: string, other: string, trigger: SocialEvent, topic: string, now = Date.now()): void {
    this.lastRelationshipAt.set(`${pairId(speaker, other)}:${trigger}:${normalizeTopic(topic)}`, now);
  }

  private canApplyRelationship(pairKey: string, eventKey: string, now: number): boolean {
    const lastRel = this.lastRelationshipAt.get(eventKey) ?? this.lastRelationshipAt.get(pairKey);
    return lastRel === undefined || now - lastRel >= RELATIONSHIP_COOLDOWN_MS;
  }
}

export function maybeConversation(args: {
  trigger: SocialEvent;
  speaker: string;
  other: string;
  topic: string;
  cause?: MeaningfulSocialCause;
}): { message: string; shouldSpeak: boolean } {
  const director = new SocialDirector();
  const cause = args.cause ?? inferCause(args.trigger);
  const decision = director.considerConversation({
    ...args,
    cause,
    speakChance: 1,
  });
  return { shouldSpeak: decision.shouldSpeak, message: decision.message ?? "" };
}

function inferCause(trigger: SocialEvent): MeaningfulSocialCause {
  if (trigger === "shared_food") return "item_transfer";
  if (trigger === "cooperated") return "joint_work";
  if (trigger === "rescued" || trigger === "helped") return "rescue";
  if (trigger === "conflict") return "conflict";
  return "llm_decision";
}

function pickLine(trigger: SocialEvent, other: string, topic: string): string | undefined {
  const options = VARIANTS[trigger]?.(other, friendlyTopic(topic)) ?? [];
  if (options.length === 0) return undefined;
  return options[Math.floor(Math.random() * options.length)];
}

function friendlyTopic(topic: string): string {
  return topic.replaceAll("_", " ").trim() || "work";
}

function normalizeTopic(topic: string): string {
  return topic.toLowerCase().replaceAll(/[^a-z0-9]+/g, "_");
}

function pairId(a: string, b: string): string {
  return [a, b].sort().join("::");
}

function similarLine(a: string, b: string): boolean {
  const na = a.toLowerCase().replaceAll(/[^a-z]+/g, "");
  const nb = b.toLowerCase().replaceAll(/[^a-z]+/g, "");
  return na === nb || (na.length > 12 && (na.includes(nb) || nb.includes(na)));
}

export function sameWorkFamily(a: string, b: string): boolean {
  const family = (task: string) => {
    if (task.includes("wood") || task.includes("lumber")) return "wood";
    if (task.includes("food") || task.includes("eat")) return "food";
    if (task.includes("stone") || task.includes("mine")) return "stone";
    if (task.includes("shelter") || task.includes("build")) return "build";
    if (task.includes("craft") || task.includes("tool")) return "craft";
    return task;
  };
  return family(a) === family(b);
}
