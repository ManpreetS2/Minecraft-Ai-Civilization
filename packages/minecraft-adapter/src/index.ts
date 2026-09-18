export { MinecraftBody } from "./minecraft-body.js";
export { patchMineflayerCrafting } from "./craft-patch.js";
export { BodyLock, DuplicateBodyError, pidAlive } from "./body-lock.js";
export {
  activePathCount,
  configureMovements,
  followPlayer,
  lastPathDurationMs,
  loadPathfinder,
  moveToPosition,
  moveToLookAtBlock,
  moveToGetToBlock,
  movementAllowsDig,
  NORMAL_NAVIGATION_CAN_DIG,
  pathMetrics,
  startFollowing,
  type MovementProfile,
} from "./pathing.js";
export { TargetBlacklist, cellKey, isProtectedFromPathfinder, movedEnough, nearbyOffsets, recoveryAttempts, shouldBlacklistTarget } from "./path-recovery.js";
export { occupancyYieldCount, occupantNear, registerOccupancy, clearOccupancy } from "./occupancy.js";
export { deriveConnectionHealth, emptyTelemetry, isKeepaliveTimeout, type ConnectionTelemetry } from "./connection-health.js";
export {
  navigationBackend,
  setNavigationBackend,
  createNavigationBackend,
  MineflayerPathfinderBackend,
  MineflayerBaritoneBackend,
  type NavigationBackend,
} from "./navigation.js";
export {
  canOccupyFeet,
  canStandOn,
  findReachableInteractionPosition,
  findReachableMiningPosition,
  findReachablePlacementPosition,
  hasHeadroom,
  interactionCandidates,
  rankedInteractionPositions,
  isWalkableStanding,
} from "./interaction.js";
export { probeReachability, scoreResourceTarget } from "./path-probe.js";
export { rankResourceTargets, pickBestResourceTarget, type ResourceCandidate } from "./targets.js";
export { NAV_SCENARIOS, backendsUnderTest, describeHarness, type NavBenchmarkRow } from "./nav-benchmark.js";
