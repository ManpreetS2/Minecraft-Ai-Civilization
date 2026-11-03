export { MinecraftBody } from "./minecraft-body.js";
export { BodyLock, DuplicateBodyError, pidAlive } from "./body-lock.js";
export { activePathCount, configureMovements, followPlayer, lastPathDurationMs, loadPathfinder, moveToPosition, startFollowing } from "./pathing.js";
export { TargetBlacklist, cellKey, movedEnough, nearbyOffsets, recoveryAttempts, shouldBlacklistTarget } from "./path-recovery.js";
export {
  planWaterSafety,
  findShoreCandidates,
  detectInWater,
  detectSubmerged,
  classifyFluid,
  isWaterBlock,
  isLavaBlock,
  WaterRecoverySession,
  MAX_SWIM_STEPS,
  type BodyWaterState,
  type WaterSafetyDecision,
  type ShoreCandidate,
  type WaterCell,
  type WaterSessionPhase,
} from "./water-safety.js";
