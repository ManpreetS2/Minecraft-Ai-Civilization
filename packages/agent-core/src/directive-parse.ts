import type { DirectiveIntent } from "@civ/shared";

export type { DirectiveIntent, DirectiveMode, HumanDirective, DirectiveStatus } from "@civ/shared";
export { parseHumanDirective, resolveDirectiveTargets, isDirectiveIntent, isDirectiveMode } from "@civ/shared";

export function intentToPlan(
  intent: DirectiveIntent,
  args?: Record<string, string>,
): { goal: string; task: string; action: string } {
  const item = args?.item;
  switch (intent) {
    case "gather_wood":
      return { goal: "gather_wood", task: "gather_wood", action: "mineBlock" };
    case "gather_food":
      return { goal: "gather_food", task: "gather_food", action: "gatherFood" };
    case "mine_stone":
      return { goal: "mine_stone", task: "mine_stone", action: "mineBlock" };
    case "craft_tools":
      if (item === "stone_pickaxe" || item === "wooden_pickaxe") {
        return { goal: item, task: "obtain_item", action: "obtainItem" };
      }
      return { goal: "craft_tools", task: "craft_tools", action: "craftItem" };
    case "obtain_item":
      return { goal: item ?? "wooden_pickaxe", task: "obtain_item", action: "obtainItem" };
    case "use_storage":
    case "deposit_items":
      return { goal: "deposit", task: "deposit", action: "depositItems" };
    case "withdraw_items":
      return { goal: "withdraw", task: "withdraw", action: "withdrawItems" };
    case "transfer_item":
      return { goal: "help_citizen", task: "help_citizen", action: "shareItem" };
    case "contribute_to_project":
      return { goal: "build_shelter", task: "build_shelter", action: "buildShelter" };
    case "return_to_settlement":
      return { goal: "return_home", task: "return_to_settlement", action: "returnToSettlement" };
    case "seek_safety":
      return { goal: "survive", task: "seek_shelter", action: "seekSafety" };
    case "assist_citizen":
      return { goal: "help_citizen", task: "help_citizen", action: "shareItem" };
    case "explore":
      return { goal: "explore", task: "observe", action: "observeNearby" };
    case "rest":
      return { goal: "rest", task: "seek_shelter", action: "seekSafety" };
    case "stop_current_task":
      return { goal: "idle", task: "observe", action: "observeNearby" };
    default:
      return { goal: "idle", task: "observe", action: "observeNearby" };
  }
}
