export const CITIZEN_NAMES = ["Atlas", "Maya", "Theo", "Ava", "Kai"] as const;
export type CitizenName = (typeof CITIZEN_NAMES)[number];

export type CitizenStatus =
  | "offline"
  | "connecting"
  | "online"
  | "dead"
  | "error"
  | "idle"
  | "respawning";

export type ConnectionHealth = "CONNECTED" | "DEGRADED" | "RECONNECTING" | "OFFLINE";

export type DecisionSource = "reflex" | "planner" | "llm";

export type SettlementNeed =
  | "NEED_FOOD"
  | "NEED_WOOD"
  | "NEED_STONE"
  | "NEED_TOOLS"
  | "NEED_BEDS"
  | "NEED_HOUSING"
  | "NEED_STORAGE";

export type InventoryItem = {
  name: string;
  count: number;
  slot?: number;
};

export type PlayerInfo = {
  username: string;
  uuid?: string;
  position?: { x: number; y: number; z: number };
  distance?: number;
};

export type NearbyEntity = {
  id: number;
  name: string;
  type: string;
  hostile: boolean;
  position: { x: number; y: number; z: number };
  distance: number;
};

export type BodyObservation = {
  username: string;
  connected: boolean;
  spawned: boolean;
  dimension?: string;
  position?: { x: number; y: number; z: number };
  health?: number;
  food?: number;
  saturation?: number;
  oxygen?: number;
  gameTime?: number;
  isNight?: boolean;
  raining?: boolean;
  inventory: InventoryItem[];
  players: PlayerInfo[];
  nearby: NearbyEntity[];
  heldItem?: string;
};

export type CitizenRecord = {
  id: string;
  name: string;
  minecraftUsername: string;
  createdAt: string;
  status: CitizenStatus;
  lastKnownPosition?: { x: number; y: number; z: number };
  health?: number;
  hunger?: number;
  occupation?: string;
  homeId?: string;
  currentGoal?: string;
  currentTask?: string;
  currentAction?: string;
  decisionSource?: DecisionSource;
  reason?: string;
  diedAt?: string;
  deathPosition?: { x: number; y: number; z: number };
};

export type Relationship = {
  citizenId: string;
  otherId: string;
  trust: number;
  affection: number;
  respect: number;
  resentment: number;
  familiarity: number;
};

export type MemoryKind = "recent" | "episodic" | "social" | "world";

export type MemoryRecord = {
  id: string;
  citizenId: string;
  kind: MemoryKind;
  content: string;
  importance: number;
  createdAt: string;
  relatedCitizenId?: string;
};

export type SettlementState = {
  id: string;
  name: string;
  food: number;
  wood: number;
  stone: number;
  beds: number;
  housingCapacity: number;
  tools: number;
  shelterComplete: boolean;
  storage?: { x: number; y: number; z: number };
  origin?: { x: number; y: number; z: number };
  construction?: ConstructionState;
  needs: SettlementNeed[];
};

export type ConstructionState = {
  blueprintId: string;
  startedAt: string;
  totalBlocks: number;
  placedBlocks: number;
  complete: boolean;
};

export const HOSTILE_MOB_NAMES = new Set([
  "zombie",
  "skeleton",
  "creeper",
  "spider",
  "cave_spider",
  "enderman",
  "witch",
  "slime",
  "drowned",
  "husk",
  "stray",
  "phantom",
  "pillager",
  "vindicator",
  "ravager",
  "warden",
  "bogged",
]);

export const FOOD_ITEM_NAMES = new Set([
  "bread",
  "apple",
  "golden_apple",
  "cooked_beef",
  "cooked_porkchop",
  "cooked_chicken",
  "cooked_mutton",
  "cooked_cod",
  "cooked_salmon",
  "cooked_rabbit",
  "beef",
  "porkchop",
  "chicken",
  "mutton",
  "carrot",
  "potato",
  "baked_potato",
  "beetroot",
  "melon_slice",
  "sweet_berries",
  "glow_berries",
  "cookie",
  "pumpkin_pie",
  "mushroom_stew",
  "rabbit_stew",
]);

export const LOG_BLOCK_NAMES = [
  "oak_log",
  "birch_log",
  "spruce_log",
  "jungle_log",
  "acacia_log",
  "dark_oak_log",
  "mangrove_log",
  "cherry_log",
  "pale_oak_log",
];

export const DEFAULT_CITIZENS: Array<{ name: CitizenName; id: string }> = [
  { name: "Atlas", id: "citizen_atlas" },
  { name: "Maya", id: "citizen_maya" },
  { name: "Theo", id: "citizen_theo" },
  { name: "Ava", id: "citizen_ava" },
  { name: "Kai", id: "citizen_kai" },
];
