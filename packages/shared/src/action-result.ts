export const ERROR_CODES = [
  "NOT_CONNECTED",
  "DUPLICATE_BODY",
  "TIMEOUT",
  "CANCELLED",
  "PATH_BLOCKED",
  "PATH_FAILED",
  "VERIFY_FAILED",
  "PLAYER_NOT_FOUND",
  "ENTITY_NOT_FOUND",
  "BLOCK_NOT_FOUND",
  "ITEM_NOT_FOUND",
  "INVENTORY_FULL",
  "INVENTORY_MISSING",
  "CRAFT_FAILED",
  "NO_RECIPE",
  "NO_CRAFTING_TABLE",
  "NEED_WORKSTATION",
  "PURPOSELESS_PLACEMENT",
  "STUCK",
  "TARGET_GONE",
  "TARGET_CHANGED",
  "ACTION_PREEMPTED",
  "CONTAINER_BUSY",
  "CONTAINER_NOT_FOUND",
  "DEPOSIT_FAILED",
  "WITHDRAW_FAILED",
  "DIG_FAILED",
  "PLACE_FAILED",
  "EQUIP_FAILED",
  "EAT_FAILED",
  "NO_FOOD",
  "NO_BED",
  "SLEEP_FAILED",
  "ATTACK_FAILED",
  "FLEE_FAILED",
  "KICKED",
  "DEAD",
  "HOSTILE_NEARBY",
  "INTERRUPTED",
  "INVALID_ARGUMENT",
  "MISSING_INGREDIENT",
  "MISSING_TOOL",
  "PREREQUISITE_MISSING",
  "UNKNOWN_RECIPE",
  "UNKNOWN_ITEM",
  "NOT_SLEEP_TIME",
  "BED_OCCUPIED",
  "TARGET_UNREACHABLE",
  "NO_INTERACTION_POSITION",
  "WORLD_CHANGED",
  "BLOCK_PLACEMENT_FAILED",
  "CONTAINER_UNREACHABLE",
  "LLM_UNAVAILABLE",
  "LLM_INVALID_OUTPUT",
  "LLM_TIMEOUT",
  "DATABASE_ERROR",
  "UNKNOWN",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export type ActionSuccess<T> = {
  success: true;
  data: T;
  durationMs: number;
};

export type ActionFailure = {
  success: false;
  code: ErrorCode;
  error: string;
  durationMs: number;
  retryable: boolean;
  details?: Record<string, unknown>;
};

export type ActionResult<T = unknown> = ActionSuccess<T> | ActionFailure;

export function ok<T>(data: T, durationMs: number): ActionSuccess<T> {
  return { success: true, data, durationMs };
}

export function fail(
  code: ErrorCode,
  error: string,
  durationMs: number,
  retryable = false,
  details?: Record<string, unknown>,
): ActionFailure {
  return { success: false, code, error, durationMs, retryable, details };
}

export function isOk<T>(result: ActionResult<T>): result is ActionSuccess<T> {
  return result.success;
}
