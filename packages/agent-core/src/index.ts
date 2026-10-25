export { AgentManager, type DashboardSnapshot, type AgentManagerHooks } from "./manager.js";
export { CivilizationStore, computeNeeds, type StoreWriteResult, type StoreReadResult } from "./store.js";
export { assignSettlementNeeds, planCitizen, type PlannedTask } from "./planner.js";
export { starterHut, materialList } from "./blueprint.js";
export {
  executePlan,
  gatherFood,
  countInventoryFood,
  finalizeFoodGather,
  persistConstructionProgress,
  persistConfirmed,
  completionMemoryForTask,
  type FoodGatherSuccess,
} from "./executor.js";
export {
  GOAL_ACTION_MAP,
  DEFERRED_GOALS,
  dispatchCognitionGoal,
  assertGoalMapComplete,
  EXECUTOR_ACTIONS,
  isDeferredGoal,
  deferredCapabilityResult,
} from "./goal-dispatch.js";
export { OperationTracker, type DrainResult } from "./lifecycle.js";
