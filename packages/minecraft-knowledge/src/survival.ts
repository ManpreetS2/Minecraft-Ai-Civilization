export type TimePeriod = "day" | "sunset" | "night" | "sunrise";

const DAY_LENGTH = 24_000;

export function classifyTimeOfDay(timeOfDay: number): TimePeriod {
  const t = ((timeOfDay % DAY_LENGTH) + DAY_LENGTH) % DAY_LENGTH;
  if (t >= 23_000 || t < 0) return "sunrise";
  if (t < 12_000) return "day";
  if (t < 13_000) return "sunset";
  if (t < 23_000) return "night";
  return "sunrise";
}

export function ticksUntil(period: TimePeriod, timeOfDay: number): number {
  const t = ((timeOfDay % DAY_LENGTH) + DAY_LENGTH) % DAY_LENGTH;
  const starts: Record<TimePeriod, number> = { day: 0, sunset: 12_000, night: 13_000, sunrise: 23_000 };
  const start = starts[period];
  return (start - t + DAY_LENGTH) % DAY_LENGTH;
}

export function nightIncreasesHostileRisk(period: TimePeriod): boolean {
  return period === "night" || period === "sunset";
}

export const SURVIVAL_RULES = [
  "Hunger at 18+ is required for natural health regeneration.",
  "Starvation damages the citizen after hunger reaches 0.",
  "Drowning damages a citizen with empty air supply underwater.",
  "Fire and lava deal repeated damage until extinguished.",
  "Falling from height deals damage based on distance.",
  "Hostile mobs are an immediate local threat when close.",
  "Night and darkness increase hostile-mob spawn risk; they do not force a single action.",
  "Eating requires an edible item in inventory.",
  "Death drops carried inventory under normal Minecraft rules.",
] as const;
