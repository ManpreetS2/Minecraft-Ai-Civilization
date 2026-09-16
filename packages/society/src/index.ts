import type { Relationship } from "@civ/shared";

export type SocialEvent =
  | "helped"
  | "shared_food"
  | "cooperated"
  | "took_resources"
  | "failed_together"
  | "rescued"
  | "conflict"
  | "talked";

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
  }
  next.trust = CLAMP(next.trust);
  next.affection = CLAMP(next.affection);
  next.respect = CLAMP(next.respect);
  next.resentment = CLAMP(next.resentment);
  next.familiarity = CLAMP(next.familiarity);
  return next;
}

export function maybeConversation(args: {
  trigger: SocialEvent;
  speaker: string;
  other: string;
  topic: string;
}): { message: string; shouldSpeak: boolean } {
  const lines: Record<SocialEvent, string> = {
    helped: `${args.other}, I could use a hand with ${args.topic}.`,
    shared_food: `${args.other}, take some food — we eat together or not at all.`,
    cooperated: `${args.other}, that ${args.topic} went better with two of us.`,
    took_resources: `${args.other}, those supplies were for everyone.`,
    failed_together: `${args.other}, that ${args.topic} failed. We try another way.`,
    rescued: `${args.other} — I thought that was the end.`,
    conflict: `${args.other}, stand down. This is not worth blood.`,
    talked: `${args.other}, remember this: ${args.topic}.`,
  };
  return { shouldSpeak: true, message: lines[args.trigger] };
}
