export type { SkillContext } from "./context.js";
export { moveTo, followEntity, followEntityLive, flee, wander } from "./movement.js";
export { observeNearby, findBlock } from "./observe.js";
export { mineBlock, collectItem } from "./gather.js";
export { craftItem, eatFood, equipItem, depositItems, withdrawItems } from "./inventory.js";
export { attack, placeBlock, sleep } from "./world.js";
export {
  PropertyRegistry,
  checkPropertyPermission,
  assertMineAllowed,
  permissionFailure,
  sameBlock,
  looksProtected,
  isOrdinaryResource,
  type PropertyKind,
  type PropertyRecord,
  type PermissionAction,
  type PermissionContext,
  type PermissionDecision,
} from "./property.js";
export { FishingCycleCoordinator, type FishingBotState, type BobberEntity } from "./fishing-cycle.js";
