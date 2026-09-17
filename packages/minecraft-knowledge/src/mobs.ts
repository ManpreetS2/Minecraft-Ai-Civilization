export type EntityAttitude = "HOSTILE" | "PASSIVE" | "NEUTRAL" | "UTILITY" | "OTHER";

export type ThreatInfo = {
  name: string;
  attitude: EntityAttitude;
  threat: "none" | "melee" | "ranged" | "explosion" | "situational";
  notes: string;
};

const KNOWN: Record<string, ThreatInfo> = {
  creeper: { name: "creeper", attitude: "HOSTILE", threat: "explosion", notes: "Explodes if it stays close enough to a citizen." },
  zombie: { name: "zombie", attitude: "HOSTILE", threat: "melee", notes: "Melee undead. Burns in sunlight." },
  husk: { name: "husk", attitude: "HOSTILE", threat: "melee", notes: "Desert zombie variant." },
  drowned: { name: "drowned", attitude: "HOSTILE", threat: "melee", notes: "Aquatic zombie; may throw tridents." },
  skeleton: { name: "skeleton", attitude: "HOSTILE", threat: "ranged", notes: "Ranged bow attack. Burns in sunlight." },
  stray: { name: "stray", attitude: "HOSTILE", threat: "ranged", notes: "Slowness arrows." },
  spider: { name: "spider", attitude: "HOSTILE", threat: "situational", notes: "Hostile in darkness; can climb walls." },
  cave_spider: { name: "cave_spider", attitude: "HOSTILE", threat: "melee", notes: "Poisonous melee spider." },
  witch: { name: "witch", attitude: "HOSTILE", threat: "ranged", notes: "Throws harmful potions." },
  phantom: { name: "phantom", attitude: "HOSTILE", threat: "melee", notes: "Attacks sleepless players at night." },
  enderman: { name: "enderman", attitude: "NEUTRAL", threat: "situational", notes: "Neutral until provoked by looking or attacking." },
  iron_golem: { name: "iron_golem", attitude: "UTILITY", threat: "situational", notes: "Powerful village defender; not automatically hostile to citizens." },
  villager: { name: "villager", attitude: "PASSIVE", threat: "none", notes: "Non-hostile NPC. Presence does not transfer property." },
  cow: { name: "cow", attitude: "PASSIVE", threat: "none", notes: "Passive food animal." },
  pig: { name: "pig", attitude: "PASSIVE", threat: "none", notes: "Passive food animal." },
  sheep: { name: "sheep", attitude: "PASSIVE", threat: "none", notes: "Passive animal." },
  chicken: { name: "chicken", attitude: "PASSIVE", threat: "none", notes: "Passive food animal." },
  wolf: { name: "wolf", attitude: "NEUTRAL", threat: "situational", notes: "Neutral unless attacked." },
  player: { name: "player", attitude: "OTHER", threat: "none", notes: "Another connected body." },
};

export function knownThreat(entityName: string): ThreatInfo | undefined {
  const key = entityName.toLowerCase().replace(/^minecraft:/, "");
  return KNOWN[key];
}

export function getThreatInfo(entityName: string): ThreatInfo {
  const key = entityName.toLowerCase().replace(/^minecraft:/, "");
  return (
    KNOWN[key] ?? {
      name: key,
      attitude: "OTHER",
      threat: "none",
      notes: "No specialized mechanic recorded.",
    }
  );
}

export function classifyHazard(name: string): { kind: "block" | "entity" | "unknown"; dangerous: boolean; reason: string } {
  const entity = KNOWN[name.toLowerCase()];
  if (entity) {
    return {
      kind: "entity",
      dangerous: entity.attitude === "HOSTILE" || entity.threat !== "none",
      reason: entity.notes,
    };
  }
  return { kind: "unknown", dangerous: false, reason: "No recorded hazard." };
}
