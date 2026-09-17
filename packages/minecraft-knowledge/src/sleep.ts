import { classifyTimeOfDay, nightIncreasesHostileRisk, type TimePeriod } from "./survival.js";

export type SleepQuery = {
  timeOfDay?: number;
  raining?: boolean;
  thundering?: boolean;
  bedPresent: boolean;
  bedOccupied?: boolean;
  bedReachable?: boolean;
  hostilesNearby?: boolean;
  dimensionOverworld?: boolean;
};

export type SleepFacts = {
  period: TimePeriod | "unknown";
  validSleepTime: boolean;
  canAttempt: boolean;
  reasons: string[];
};

export function sleepFacts(query: SleepQuery): SleepFacts {
  const period = typeof query.timeOfDay === "number" ? classifyTimeOfDay(query.timeOfDay) : "unknown";
  const night = period === "night" || query.thundering === true;
  const reasons: string[] = [];
  if (!query.bedPresent) reasons.push("No bed is present.");
  if (query.bedOccupied) reasons.push("That bed is already occupied.");
  if (query.bedPresent && query.bedReachable === false) reasons.push("The bed is not reachable.");
  if (query.hostilesNearby) reasons.push("Hostiles are too close to sleep.");
  if (query.dimensionOverworld === false) reasons.push("Beds explode or fail outside the Overworld.");
  if (!night && !query.thundering) reasons.push("It is not night or a thunderstorm.");
  const validSleepTime = night || Boolean(query.thundering);
  const canAttempt =
    query.bedPresent &&
    !query.bedOccupied &&
    query.bedReachable !== false &&
    !query.hostilesNearby &&
    query.dimensionOverworld !== false &&
    validSleepTime;
  return { period, validSleepTime, canAttempt, reasons };
}

export function nightRisk(timeOfDay?: number): boolean {
  if (timeOfDay === undefined) return false;
  return nightIncreasesHostileRisk(classifyTimeOfDay(timeOfDay));
}
