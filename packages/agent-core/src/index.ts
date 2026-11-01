export { AgentManager, type AgentManagerHooks, type DashboardSnapshot } from "./manager.js";
export { CivilizationStore, computeNeeds, type StoreReadResult, type StoreWriteResult } from "./store.js";
export {
  buildCitizenContextPack,
  ensureCitizenPersonality,
  filterMemoriesForCitizen,
  type CitizenContextPack,
} from "./citizen-context.js";
export { OperationTracker, type DrainResult } from "./operation-tracker.js";
export {
  GOAL_ACTION_MAP,
  INTERNAL_PLANNER_ACTIONS,
  MODEL_PLAN_ENRICHMENT_ACTIONS,
  assertGoalMapComplete,
  cognitionReachableActions,
  deferredCapabilityResult,
  dispatchCognitionGoal,
  enforceModelOriginatedPlan,
  isAllowlistedExecutorAction,
  isCognitionReachableAction,
  isDeferredGoal,
  isInternalPlannerActionName,
  resolveModelGoalForPlanner,
  validateModelOriginatedPlan,
} from "./goal-dispatch.js";
export {
  completionMemoryForTask,
  countInventoryFood,
  finalizeFoodGather,
  persistConfirmed,
} from "./executor.js";
export {
  assignSettlementNeeds,
  assignWorkRoles,
  experimentWorkAssignment,
  planCitizen,
  shouldBackoffModelProposal,
  shouldOverrideModelForSafety,
  type ModelDecisionProvenance,
  type PlannedTask,
} from "./planner.js";
export { starterHut, materialList } from "./blueprint.js";
export { executePlan } from "./executor.js";
export {
  claimHome,
  leaveHome,
  markHomeInaccessible,
  resolveHomeSleepTarget,
  resolveStorageTarget,
  assertChestAccess,
  type CitizenHome,
  type ClaimHomeRequest,
  type HomeMembership,
  type HomeRecord,
  type StorageAccess,
} from "./homes.js";
export { parseResetArgs, resetDevelopmentState } from "./dev-reset.js";
export { planCraft, nextCraftStep, recipeNeedsTable } from "./recipes.js";
export { ClaimBoard, ReservationBook } from "./claims.js";
export {
  evaluateCitizenCurfew,
  shouldAbortActiveWorkForCurfew,
  curfewDidNotCompleteWork,
  workHandoffToCurfew,
  claimedHomeDestination,
  planCurfewBedtimeAction,
} from "./curfew-runtime.js";
export { executeSleepAtHome } from "./home-ops.js";
export { waitInsideHomeUntilSleepTime } from "./wait-inside-home.js";
export {
  persistCitizenHomeClaim,
  evaluateClaimHomeAction,
  listAvailableHomes,
  nearestClaimableHome,
  WORLD_LAB_CLAIMABLE_HOMES,
  WORLD_LAB_AUDITED_FURNITURE,
  HOME_CLAIM_REACH_BLOCKS,
  type CatalogHome,
} from "./available-homes.js";
export {
  housingOpportunity,
  nearestEligibleHome,
  catalogHomeDistance,
  housingTravelTarget,
  travelTowardHousingResult,
  ATLAS_POND_LAST_POS,
} from "./home-discovery.js";
export { authorizedWorkStorage } from "./activity-choice.js";
export { isTestFixtureChest, TEST_FIXTURE_CHESTS, WORLD_LAB_COMMUNAL_CHEST } from "./test-fixtures.js";
export {
  lastOutcomeFrom,
  persistCitizenLastOutcome,
  loadCitizenLastOutcome,
  cancelCitizenWork,
  physicalWorkComplete,
  RETRYABLE_FAILURE_LIMIT,
} from "./task-recovery.js";
export {
  assertMayBreakBlock,
  assertMayPlaceOver,
  assertMayUseChest,
  classifyChestKnowledge,
  skipProtectedPropertyCell,
} from "./property-safety.js";
export {
  planBuildStructure,
  createStructureProjectFromPreflight,
  applyWorldReconcileToSession,
  dispatchCitizenBuildIntention,
  executeBuildStructurePlan,
  plannedTaskForConstructionProject,
  cancelConstructionProject,
  authorizedInventoryForCitizen,
  projectsMatchIntention,
  constructionProjectId,
  type BuildStructureProject,
  type BuildStructureIntention,
  type BuildStructurePreflight,
  type ConstructionDispatchResult,
  type ConstructionDispatchPhase,
} from "./build-structure.js";
export { buildShelter, standingInWater, emitProjectCreated } from "./construction.js";
export { selectConstructionSite, type SiteSelectResult, type SiteCandidate } from "./construction-site-select.js";
export {
  planConstructionProcurement,
  releaseConstructionReservations,
  reserveProcurementBite,
  type ProcurementPlan,
} from "./construction-procurement.js";
export {
  runWorkshopCabinOfflineAcceptance,
  simulatePlaceNext,
  seedFlatPad,
  cancelAndCleanup,
  type EndToEndOfflineResult,
} from "./construction-offline-engine.js";
export {
  createConstructionEvidenceLog,
  inventoryDelta,
  evidenceHeaderMarkdown,
  ensureEvidenceDir,
  type ConstructionEvidenceEvent,
  type ConstructionEvidenceLog,
  type EvidencePhase,
} from "./construction-evidence.js";
export {
  createShelterProject,
  transitionProject,
  scanBlueprint,
  materialsReady,
  type SettlementProject,
  type ProjectStatus,
} from "./projects.js";

export { CommunityPhysicalState, communityPhysicalState, physicalBlockKey, physicalMigrationReport,
  type PhysicalSnapshot, type PhysicalAsset, type PhysicalAssetKind } from "./community-physical-state.js";
