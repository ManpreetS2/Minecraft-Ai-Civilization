export type { SkillContext } from "./context.js";
export { moveTo, followEntity, followEntityLive, flee, wander } from "./movement.js";
export { observeNearby, findBlock, findBlockCandidates } from "./observe.js";
export { mineBlock, collectItem, classifyStaleTarget } from "./gather.js";
export { collectResource } from "./collect.js";
export { obtainItem, recipeFor, missingPrerequisites, prerequisiteChain } from "./obtain.js";
export {
  craftItem,
  eatFood,
  equipItem,
  depositItems,
  withdrawItems,
  inventoryCount,
  listInventory,
  hasItem,
  inventorySpace,
  edibleItems,
  toolsOwned,
  buildingItems,
  canFitDrop,
  snapshotInventory,
  freeCapacity,
  canReceive,
  compactInventoryFacts,
  reserveItems,
  releaseReservation,
  availableUnreservedCount,
  clearReservations,
  durabilityFromItem,
  toolDurabilityFacts,
} from "./inventory.js";
export { dropItem, approachAndCollect, pickupDroppedItem } from "./share.js";
export { attack, placeBlock, sleep } from "./world.js";
export {
  evaluateFunctionalPlacement,
  isFunctionalItem,
  worldGetterFromBot,
  type PlacementIntent,
  type PlacementPurpose,
} from "./placement.js";
export { equipForBlock } from "./tools.js";
export { openDoor, openFenceGate } from "./doors.js";
export { classifySkill, type SkillStatus } from "./skill-result.js";
export { climbLadder } from "./climb.js";
export { attackHostile, fleeCreeper, huntAnimal, isAttackAllowed } from "./combat.js";
export { harvestCrop, plantCrop, tillAndPlant, isMatureCrop, CROP_BLOCKS, type CropKind } from "./farm.js";
export { smeltItem, preferredFuel } from "./furnace.js";
export { tradeWithVillager } from "./trade.js";
export {
  executeStructure,
  verifyStructure,
  probeShelter,
  probeFort,
  classifyStructureBlock,
  type StructurePlan,
} from "./structure.js";
export {
  unequip,
  dropStack,
  depositItem,
  withdrawItem,
  setQuickBarSlot,
  heldItem,
  findStacks,
  countItem,
  transferItemToCitizen,
} from "./inventory-service.js";
export { ItemReservationBook } from "./inventory-reservations.js";
export {
  navigateTo,
  navigateNear,
  approachBlock,
  collectItemDrop,
  breakBlock,
  equipTool,
  openContainer,
  transferItem,
  returnToSettlement,
  assistProject,
  closeDoor,
} from "./library.js";
