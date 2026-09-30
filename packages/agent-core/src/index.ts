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
