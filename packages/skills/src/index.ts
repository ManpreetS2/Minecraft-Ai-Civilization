export type { SkillContext } from "./context.js";
export { moveTo, followEntity, followEntityLive, flee, wander } from "./movement.js";
export { observeNearby, findBlock, findBlockCandidates } from "./observe.js";
export { mineBlock, collectItem, classifyStaleTarget } from "./gather.js";
export { collectResource } from "./collect.js";
export { obtainItem, recipeFor, missingPrerequisites, prerequisiteChain } from "./obtain.js";
export {
  mineKnownOre,
  evaluateMiningRequest,
  evaluateExcavation,
  classifyOreTarget,
  assertPermittedStorage,
  clampMiningBounds,
  isOreExposed,
  hasLineOfSight,
  isWithinMiningBounds,
  MINING_RADIUS_CAP,
  MINING_ACTION_CAP,
  type MiningRequest,
  type MiningDecision,
  type OreSighting,
} from "./mine.js";
export {
  planOreSearch,
  proposeBoundedTunnel,
  refuseUncontrolledStripMine,
  searchWaypointAtBand,
  TUNNEL_LENGTH_CAP,
  type OreSearchPlan,
  type TunnelProposal,
} from "./ore-search.js";
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
export {
  harvestCrop,
  harvestCropAt,
  harvestPlot,
  inspectFarm,
  evaluateFarmPreconditions,
  workFarmPlot,
  plantCrop,
  tillAndPlant,
  tillAndPlantPlot,
  tillSoil,
  findTillablePlot,
  inspectCrop,
  isMatureCrop,
  cropAge,
  cropKindFromBlock,
  plotCells,
  selectHydratedPlot,
  soilHydratedByWater,
  CROP_BLOCKS,
  TILLABLE_SOIL,
  type CropKind,
  type FarmInspection,
  type FarmWorkRequest,
} from "./farm.js";
export {
  fishAtShore,
  evaluateFishingRequest,
  findShoreCasts,
  clampFishingBounds,
  fishingCatchCount,
  snapshotCatchCounts,
  fishingHomeStop,
  isFishingBiteSound,
  pickNearestBobber,
  isFishingBobberName,
  FISHING_RADIUS_CAP,
  FISHING_CAST_CAP,
  FISHING_BITE_GRACE_MS,
  type FishingRequest,
  type FishingDecision,
  type ShoreCast,
  type WorldGetter,
} from "./fish.js";
export { optionalWorkInterrupted, cancelledThisCitizen } from "./optional-work.js";
export {
  runMineflayerFishCycle,
  rodCommandForEvent,
  shouldBindSpawnedBobber,
  chooseBoundBobber,
  isOwnBiteParticle,
  isOwnBobberBiting,
  type FishCyclePhase,
  type FishableBot,
} from "./mineflayer-fish-cycle.js";
export {
  fishQuotaAtShore,
  runFishQuotaLoop,
  createCitizenFishLedger,
  creditCatch,
  applyDeposit,
  depositableFromInventory,
  fishQuotaVerdict,
  evaluateFishQuotaStop,
  standsSeparated,
  sessionsOverlap,
  evaluateTwoBotConcurrency,
  snapshotQuotaCounts,
  quotaFishCount,
  rodUsable,
  clampFishQuotaBounds,
  FISH_QUOTA_TARGET,
  FISH_QUOTA_MAX_ATTEMPTS,
  FISH_QUOTA_ITEMS,
  TWO_FISH_MIN_STAND_SEPARATION,
  TWO_FISH_MAX_STAND_SEPARATION,
  type CitizenFishLedger,
  type CitizenFishRole,
  type FishQuotaRequest,
  type FishQuotaResult,
} from "./fish-quota.js";
export { smeltItem, preferredFuel, smeltsPerFuelUnit, fuelUnitsNeeded } from "./furnace.js";
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
  createBuildSession,
  advanceBlueprintBuild,
  resumeBlueprintBuild,
  validateBuiltStructure,
  selectBlueprintSite,
  decideStructureAction,
  scanRecognizedStructures,
  knownFromSession,
  revalidateSession,
  type BuildSession,
  type BuildAdvance,
} from "./blueprint-build.js";
export type { KnownStructureRecord } from "@civ/minecraft-knowledge";
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
