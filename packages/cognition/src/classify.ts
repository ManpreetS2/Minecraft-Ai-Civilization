import { SYSTEM_FAILURE_CATEGORIES, type FailureCategory, type ExperienceTrack } from "@civ/memory";

export type FailureSignal = {
  errorCode?: string;
  errorMessage?: string;
  goal?: string;
  inventory?: string[];
  unreachable?: boolean;
  missingTool?: boolean;
  missingRecipeInput?: boolean;
  inventoryFull?: boolean;
  socialRejected?: boolean;
};

export type ClassifiedFailure = {
  category: FailureCategory;
  track: ExperienceTrack;
  citizenLearns: boolean;
  code: string;
};

const NETWORK_CODES = /keepalive|econnreset|etimedout|timed out|socket hang up|econnrefused|enotfound|websocket/i;
const SERVER_CODES = /paper|minecraft server|tick timeout|protocol/i;
const INFRA_CODES = /sqlite|database is locked|ebusy|enoent|oom|out of memory/i;

export function classifyFailure(signal: FailureSignal): ClassifiedFailure {
  const blob = `${signal.errorCode ?? ""} ${signal.errorMessage ?? ""}`.trim();
  if (NETWORK_CODES.test(blob)) {
    return { category: "NETWORK", track: "SYSTEM", citizenLearns: false, code: signal.errorCode ?? "NETWORK" };
  }
  if (SERVER_CODES.test(blob)) {
    return { category: "SERVER", track: "SYSTEM", citizenLearns: false, code: signal.errorCode ?? "SERVER" };
  }
  if (INFRA_CODES.test(blob)) {
    return { category: "INFRASTRUCTURE", track: "SYSTEM", citizenLearns: false, code: signal.errorCode ?? "INFRASTRUCTURE" };
  }

  if (signal.missingTool || signal.errorCode === "MISSING_TOOL") {
    return { category: "KNOWLEDGE_ERROR", track: "CITIZEN", citizenLearns: true, code: "MISSING_TOOL" };
  }
  if (signal.missingRecipeInput || signal.errorCode === "MISSING_RECIPE_INPUT") {
    return { category: "KNOWLEDGE_ERROR", track: "CITIZEN", citizenLearns: true, code: "MISSING_RECIPE_INPUT" };
  }
  if (signal.unreachable || signal.errorCode === "TARGET_UNREACHABLE") {
    return { category: "WORLD_CONSTRAINT", track: "CITIZEN", citizenLearns: true, code: "TARGET_UNREACHABLE" };
  }
  if (signal.inventoryFull || signal.errorCode === "INVENTORY_FULL") {
    return { category: "RESOURCE_CONFLICT", track: "CITIZEN", citizenLearns: true, code: "INVENTORY_FULL" };
  }
  if (signal.socialRejected || signal.errorCode === "SOCIAL_REJECTED") {
    return { category: "SOCIAL_OUTCOME", track: "CITIZEN", citizenLearns: true, code: "SOCIAL_REJECTED" };
  }
  if (signal.errorCode === "STALE_DECISION") {
    return { category: "AGENT_DECISION", track: "CITIZEN", citizenLearns: true, code: "STALE_DECISION" };
  }
  if (signal.errorCode === "MECHANICS_CONTRADICTION") {
    return { category: "KNOWLEDGE_ERROR", track: "CITIZEN", citizenLearns: true, code: "MECHANICS_CONTRADICTION" };
  }
  if (signal.errorCode === "SKILL_FAILED") {
    return { category: "SKILL_EXECUTION", track: "CITIZEN", citizenLearns: true, code: "SKILL_FAILED" };
  }
  if (signal.errorCode === "PLAN_FAILED") {
    return { category: "PLANNING", track: "CITIZEN", citizenLearns: true, code: "PLAN_FAILED" };
  }

  return {
    category: "UNKNOWN",
    track: "CITIZEN",
    citizenLearns: false,
    code: signal.errorCode ?? "UNKNOWN",
  };
}

export function isSystemFailure(category: FailureCategory): boolean {
  return SYSTEM_FAILURE_CATEGORIES.has(category);
}
