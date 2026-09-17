import type { ActionResult, ErrorCode } from "@civ/shared";

export type SkillStatus = "SUCCESS" | "FAILED" | "BLOCKED" | "INTERRUPTED" | "PREREQUISITE_MISSING";

const PREREQ: ErrorCode[] = [
  "MISSING_INGREDIENT",
  "MISSING_TOOL",
  "NO_CRAFTING_TABLE",
  "NEED_WORKSTATION",
  "PREREQUISITE_MISSING",
  "NO_FOOD",
  "ITEM_NOT_FOUND",
  "UNKNOWN_ITEM",
  "UNKNOWN_RECIPE",
  "INVENTORY_FULL",
];
const BLOCKED: ErrorCode[] = [
  "PATH_BLOCKED",
  "TARGET_UNREACHABLE",
  "NO_INTERACTION_POSITION",
  "CONTAINER_BUSY",
  "HOSTILE_NEARBY",
  "PURPOSELESS_PLACEMENT",
];
const INTERRUPTED: ErrorCode[] = ["CANCELLED", "INTERRUPTED"];

export function classifySkill(result: ActionResult): SkillStatus {
  if (result.success) return "SUCCESS";
  if (INTERRUPTED.includes(result.code)) return "INTERRUPTED";
  if (PREREQ.includes(result.code)) return "PREREQUISITE_MISSING";
  if (BLOCKED.includes(result.code)) return "BLOCKED";
  return "FAILED";
}
