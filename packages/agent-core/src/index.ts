export { AgentManager, type DashboardSnapshot } from "./manager.js";
export { CivilizationStore, computeNeeds } from "./store.js";
export { assignSettlementNeeds, planCitizen, type PlannedTask } from "./planner.js";
export { starterHut, materialList } from "./blueprint.js";
export { executePlan } from "./executor.js";
export {
  planHousing,
  applyClaim,
  eligibleHouses,
  sortByDistance,
  distance3,
  type HouseRecord,
  type HousingCitizen,
  type HousingPlan,
  type HousingWorld,
} from "./housing.js";
export { applyBrainMigrations, listAppliedMigrations, BRAIN_MIGRATION_V2 } from "./brain-migrations.js";
export { BrainPersistence, type VerifiedTransferBrainEvent, type BrainEffectKind } from "./brain-persistence.js";
export { CitizenBrainAdapter, type AdapterObserveInput, type NormalizedIntention } from "./citizen-brain-adapter.js";
