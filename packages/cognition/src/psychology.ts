import type { CitizenBelief, MoodAffect, WorldFact } from "@civ/shared";

export type MoodEvent =
  | "hunger"
  | "injury"
  | "success"
  | "repeated_failure"
  | "cooperation"
  | "conflict"
  | "safe_home";

/**
 * Evidence-driven mood. Not clinical. World facts ≠ beliefs ≠ emotions.
 */
export function updateMood(current: MoodAffect | undefined, event: MoodEvent, at = new Date().toISOString()): MoodAffect {
  const base: MoodAffect = current ?? {
    label: "unknown",
    intensity: 0,
    evidenceCount: 0,
    updatedAt: at,
  };
  let label = base.label;
  let intensity = base.intensity;
  switch (event) {
    case "hunger":
      label = "anxious";
      intensity = Math.min(1, intensity + 0.15);
      break;
    case "injury":
      label = "anxious";
      intensity = Math.min(1, intensity + 0.25);
      break;
    case "success":
      label = "content";
      intensity = Math.max(0, intensity - 0.1);
      break;
    case "repeated_failure":
      label = "frustrated";
      intensity = Math.min(1, intensity + 0.2);
      break;
    case "cooperation":
      label = "content";
      intensity = Math.max(0, intensity - 0.05);
      break;
    case "conflict":
      label = "frustrated";
      intensity = Math.min(1, intensity + 0.15);
      break;
    case "safe_home":
      label = "calm";
      intensity = Math.max(0, intensity - 0.2);
      break;
  }
  return {
    label,
    intensity: Math.round(intensity * 100) / 100,
    evidenceCount: base.evidenceCount + 1,
    updatedAt: at,
  };
}

export type SeparatedState = {
  world: WorldFact[];
  beliefs: CitizenBelief[];
  mood: MoodAffect;
};

/** Keep objective world, subjective belief, and emotion distinct. */
export function separateWorldBeliefEmotion(args: {
  world: WorldFact[];
  beliefs: CitizenBelief[];
  mood: MoodAffect;
}): SeparatedState {
  return {
    world: args.world.map((w) => ({ ...w })),
    beliefs: args.beliefs.map((b) => ({ ...b })),
    mood: { ...args.mood },
  };
}
