export type WorldStateFacts = {
  hunger?: number;
  health?: number;
  hasPersonalFood?: boolean;
  hasPickaxe?: boolean;
  nearbyThreat?: boolean;
  directiveId?: string;
  projectComplete?: boolean;
  settlementNeeds?: string[];
  currentGoal?: string;
  urgentEventId?: string;
};

function band(value: number | undefined, size: number): string {
  if (value == null || !Number.isFinite(value)) return "na";
  return String(Math.floor(value / size) * size);
}

/**
 * Compact hash of decision-relevant facts only.
 * Do not hash lifetime history, recipes, or all citizens.
 */
export function hashWorldState(facts: WorldStateFacts): string {
  const parts = [
    `h:${band(facts.hunger, 4)}`,
    `hp:${band(facts.health, 4)}`,
    `food:${facts.hasPersonalFood ? 1 : 0}`,
    `pick:${facts.hasPickaxe ? 1 : 0}`,
    `threat:${facts.nearbyThreat ? 1 : 0}`,
    `dir:${facts.directiveId ?? ""}`,
    `proj:${facts.projectComplete ? 1 : 0}`,
    `needs:${[...(facts.settlementNeeds ?? [])].sort().join(",")}`,
    `goal:${facts.currentGoal ?? ""}`,
    `evt:${facts.urgentEventId ?? ""}`,
  ];
  return simpleHash(parts.join("|"));
}

export function simpleHash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i += 1) {
    h = (h * 33) ^ text.charCodeAt(i);
  }
  return (h >>> 0).toString(16);
}

export function factsFromView(view: {
  hunger?: number;
  health?: number;
  inventory?: Array<{ name: string; count: number }>;
  nearbyHostiles?: Array<{ name: string; distance: number }>;
}, extra: Partial<WorldStateFacts> = {}): WorldStateFacts {
  const inventory = view.inventory ?? [];
  return {
    hunger: view.hunger,
    health: view.health,
    hasPersonalFood: inventory.some((item) => item.count > 0 && isEdible(item.name)),
    hasPickaxe: inventory.some((item) => item.count > 0 && /pickaxe/i.test(item.name)),
    nearbyThreat: (view.nearbyHostiles ?? []).some((h) => h.distance < 8),
    ...extra,
  };
}

export function isEdible(name: string): boolean {
  return /steak|bread|apple|beef|pork|chicken|mutton|cod|salmon|carrot|potato|berry|pie|stew/i.test(name);
}
