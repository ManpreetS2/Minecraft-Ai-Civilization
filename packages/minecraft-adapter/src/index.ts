export { MinecraftBody } from "./minecraft-body.js";
export { declaredRootCommands, sanitizeWhisperText, WHISPER_COMMAND } from "./server-commands.js";
export { patchMineflayerCrafting } from "./craft-patch.js";
export { BodyLock, DuplicateBodyError, pidAlive } from "./body-lock.js";
export {
  activePathCount,
  configureMovements,
  invalidateMovementCache,
  followPlayer,
  lastPathDurationMs,
  loadPathfinder,
  installSharedNavigator,
  moveToPosition,
  moveToLookAtBlock,
  moveToGetToBlock,
  movementAllowsDig,
  NORMAL_NAVIGATION_CAN_DIG,
  pathMetrics,
  startFollowing,
  type MovementProfile,
} from "./pathing.js";
export {
  chooseStandingDestination,
  formatTerrainReport,
  inspectLocalTerrain,
  localEscape,
  localEscapeCells,
  type LocalTerrainReport,
  type TerrainKind,
} from "./local-escape.js";
export { TargetBlacklist, cellKey, isProtectedFromPathfinder, movedEnough, nearbyOffsets, recoveryAttempts, shouldBlacklistTarget } from "./path-recovery.js";
export { occupancyYieldCount, occupantNear, registerOccupancy, clearOccupancy } from "./occupancy.js";
export {
  deriveConnectionHealth,
  emptyTelemetry,
  isKeepaliveTimeout,
  isTransportReset,
  keepalivePolicy,
  armShutdownClient,
  type ConnectionTelemetry,
} from "./connection-health.js";
export {
  navigationBackend,
  setNavigationBackend,
  createNavigationBackend,
  MineflayerPathfinderBackend,
  MineflayerBaritoneBackend,
  type NavigationBackend,
} from "./navigation.js";
export {
  BLOCK_INTERACT_REACH,
  blockInteractDistance,
  canOccupyFeet,
  canStandOn,
  isWithinBlockReach,
  findReachableInteractionPosition,
  findReachableMiningPosition,
  findReachablePlacementPosition,
  hasHeadroom,
  hasJumpHeadroom,
  interactionCandidates,
  rankedInteractionPositions,
  isWalkableStanding,
  isVerifiedStanding,
  isWalkSurface,
} from "./interaction.js";
export {
  arrivalAccepted,
  attemptStepJump,
  evaluateStepJump,
  inspectAdjacentDoor,
  isMovementStall,
  jumpProgressed,
  landingVerified,
  jumpApproachTicks,
  movementActivity,
  releaseMovementControls,
  stallRecoveryBudget,
  STEP_JUMP_LIMITS,
  tryOpenAdjacentDoor,
  waitUntilOnGround,
  walkForward,
  needsJumpRunUp,
  isTwoBlockObstruction,
  type DoorResolution,
  type MovementActivity,
  type StepJumpDecision,
} from "./step-jump.js";
export {
  currentPlayerInput,
  installModernMovement,
  writePlayerInput,
  writePlayerLoaded,
  writeTickEnd,
} from "./movement-sync.js";
export {
  LocalTerrainMemory,
  edgeKey,
  isTreePart,
  terrainMemory,
  type ObservedBlock,
} from "./terrain-memory.js";
export {
  isObservedTwoBlockObstacle,
  observedStepExclusion,
  planTwoBlockDetour,
  twoBlockRecovery,
  segmentHitsColumn,
  obstacleCellFrom,
  type TwoBlockRecovery,
} from "./obstacle-detour.js";
export {
  citizenInheritsSharedAutoJump,
  sharedAutoJumpPolicy,
  SHARED_AUTO_JUMP,
} from "./shared-auto-jump.js";
export {
  bypassCells,
  cellIsUnsafeToEnter,
  classifyHazardName,
  attemptHazardBridge,
  evaluateHazardBridge,
  hazardAhead,
  headingToward,
  isSafeDetour,
  pathContainsUnsafeCell,
  planHazardRecovery,
  retreatCell,
  retreatCellIfVerified,
  retreatFromHazard,
  sameLevelWalkGraph,
  towardHazardColumn,
  MAX_HAZARD_REROUTES,
  MAX_HAZARD_BYPASS_TRIES,
  SAFE_FALL_MAX_DROP,
  SAME_LEVEL_MAX_STEPS,
  type HazardSighting,
  type HazardRecoveryPlan,
} from "./hazard-nav.js";
export {
  STALL_RECOVERY_BUFFER_MS,
  WALK_MS_PER_BLOCK,
  estimateTravelMs,
  evaluateReturnHome,
  evaluateLateDayBedtime,
  curfewWorkInterrupted,
  msUntilBedtime,
  msUntilVanillaSleep,
  vanillaSleepTimeValid,
  vanillaMorning,
  vanillaNightWindowEnded,
  NIGHT_START_TICK,
  SUNSET_START_TICK,
  VANILLA_NIGHT_START_TICK,
  VANILLA_NIGHT_END_TICK,
  CURFEW_SAFETY_MARGIN_MS,
  type ReturnHomePlan,
  type ReturnHomeEtaKind,
  type LateDayBedtimePlan,
} from "./travel-home.js";
export { executeReturnHome, type ReturnHomeLiveResult } from "./return-home-nav.js";
export {
  alreadyInsideClaimedHome,
  atClaimedEntrance,
  cellCenter,
  enterClaimedHouse,
  shouldSkipInteriorApproach,
  type EnterHomeResult,
} from "./enter-home.js";
export { probeReachability, scoreResourceTarget } from "./path-probe.js";
export { rankResourceTargets, pickBestResourceTarget, type ResourceCandidate } from "./targets.js";
export { NAV_SCENARIOS, backendsUnderTest, describeHarness, type NavBenchmarkRow } from "./nav-benchmark.js";
export { loadToolPlugin, equipToolForBlock } from "./tool-plugin.js";
