import type { ActionResult, ErrorCode } from "@civ/shared";

export type SkillStatus = "SUCCESS" | "FAILED" | "BLOCKED" | "INTERRUPTED" | "PREREQUISITE_MISSING";

const PREREQ: ErrorCode[] = ["MISSING_INGREDIENT", "MISSING_TOOL", "NO_CRAFTING_TABLE", "PREREQUISITE_MISSING", "NO_FOOD", "ITEM_NOT_FOUND"];
const BLOCKED: ErrorCode[] = ["PATH_BLOCKED", "TARGET_UNREACHABLE", "NO_INTERACTION_POSITION", "CONTAINER_BUSY", "HOSTILE_NEARBY"];
const INTERRUPTED: ErrorCode[] = ["CANCELLED", "INTERRUPTED"];

export function classifySkill(result: ActionResult): SkillStatus {
  if (result.success) return "SUCCESS";
  if (INTERRUPTED.includes(result.code)) return "INTERRUPTED";
  if (PREREQ.includes(result.code)) return "PREREQUISITE_MISSING";
  if (BLOCKED.includes(result.code)) return "BLOCKED";
  return "FAILED";
}
