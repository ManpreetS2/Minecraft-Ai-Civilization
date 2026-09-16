import { GOAL_ALIASES, GOAL_SET, GOALS, PRIVILEGED_FIELDS, type Goal } from "./goals.js";

const PRIORITY_ALIASES: Record<string, number> = {
  high: 0.85,
  urgent: 0.9,
  critical: 0.95,
  medium: 0.5,
  moderate: 0.5,
  normal: 0.5,
  low: 0.25,
};

export function normalizeGoal(raw: unknown): Goal | undefined {
  if (typeof raw !== "string") return undefined;
  const key = raw.trim().toLowerCase().replaceAll(/[\s-]+/g, "_");
  if (!key) return undefined;
  if (GOAL_SET.has(key)) return key as Goal;
  const compact = key.replaceAll("_", "");
  const aliased = GOAL_ALIASES[key] ?? GOAL_ALIASES[compact];
  return aliased;
}

export function rejectPrivilegedFields(input: unknown): void {
  if (!input || typeof input !== "object" || Array.isArray(input)) return;
  for (const key of Object.keys(input as Record<string, unknown>)) {
    const normalized = key.toLowerCase().replaceAll(/[\s-]+/g, "");
    if (PRIVILEGED_FIELDS.has(normalized) || PRIVILEGED_FIELDS.has(key.toLowerCase())) {
      throw new Error(`Unexpected privileged field: ${key}`);
    }
  }
}

export function normalizeNumber(raw: unknown): number | undefined {
  if (typeof raw === "number") {
    return Number.isFinite(raw) ? raw : undefined;
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return undefined;
    const aliased = PRIORITY_ALIASES[trimmed.toLowerCase()];
    if (aliased !== undefined) return aliased;
    if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return undefined;
    const value = Number(trimmed);
    return Number.isFinite(value) ? value : undefined;
  }
  return undefined;
}

export function normalizeDecisionInput(input: unknown): unknown {
  rejectPrivilegedFields(input);
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const source = unwrapDecision(input as Record<string, unknown>);
  rejectPrivilegedFields(source);
  const next: Record<string, unknown> = { ...source };
  const goal = normalizeGoal(source.goal);
  if (goal) next.goal = goal;
  const priority = firstFiniteNumber(source, ["priority", "urgency", "score"]);
  if (priority !== undefined) {
    next.priority = priority;
  } else if (isMissingNumber(source, ["priority", "urgency", "score"])) {
    next.priority = 0.5;
  } else {
    delete next.priority;
  }
  const uncertainty = normalizeNumber(source.uncertainty);
  if (source.uncertainty !== undefined) {
    if (uncertainty === undefined) delete next.uncertainty;
    else next.uncertainty = uncertainty;
  }
  if (typeof source.reason === "string") {
    const trimmed = source.reason.trim();
    next.reason = trimmed.length > 280 ? `${trimmed.slice(0, 277)}...` : trimmed;
  }
  if (typeof source.targetCitizenId === "string" && source.targetCitizenId.trim()) {
    next.targetCitizenId = source.targetCitizenId.trim();
  } else {
    delete next.targetCitizenId;
  }
  if (typeof source.targetProjectId === "string" && source.targetProjectId.trim()) {
    next.targetProjectId = source.targetProjectId.trim();
  } else {
    delete next.targetProjectId;
  }
  if (typeof source.targetResource === "string" && source.targetResource.trim()) {
    next.targetResource = source.targetResource.trim();
  } else {
    delete next.targetResource;
  }
  return next;
}

function unwrapDecision(source: Record<string, unknown>): Record<string, unknown> {
  for (const key of ["decision", "result", "output"]) {
    const nested = source[key];
    if (nested && typeof nested === "object" && !Array.isArray(nested) && "goal" in nested) {
      return nested as Record<string, unknown>;
    }
  }
  return source;
}

function firstFiniteNumber(source: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = normalizeNumber(source[key]);
    if (value !== undefined) return value;
  }
  return undefined;
}

function isMissingNumber(source: Record<string, unknown>, keys: string[]): boolean {
  return keys.every((key) => {
    const value = source[key];
    return value === undefined || value === null || value === "";
  });
}

export { GOALS };
