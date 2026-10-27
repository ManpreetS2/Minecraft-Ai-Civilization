/**
 * Seeded eight-axis personality generation (charter § personality).
 *
 * Distribution: each trait is Irwin–Hall n=4 of U(0,1), scaled to [0, 100] and rounded.
 * Mean ≈ 50; extremes rarer than mid-range. Deterministic for a recorded seed + citizen id.
 *
 * Traits are tendencies for cognition context only — they must NOT force planner actions.
 */

export const PERSONALITY_AXES = [
  "workEthic",
  "aggression",
  "socialTrust",
  "empathy",
  "curiosity",
  "riskTolerance",
  "sociability",
  "leadershipDrive",
] as const;

export type PersonalityAxis = (typeof PERSONALITY_AXES)[number];

export type PersonalityTraits = Record<PersonalityAxis, number>;

export type PersonalityRecord = {
  seed: string;
  version: 1;
  generatedAt: string;
  traits: PersonalityTraits;
};

const AXIS_LABELS: Record<PersonalityAxis, string> = {
  workEthic: "work ethic",
  aggression: "aggression",
  socialTrust: "social trust",
  empathy: "empathy",
  curiosity: "curiosity",
  riskTolerance: "risk tolerance",
  sociability: "sociability",
  leadershipDrive: "leadership drive",
};

/** FNV-1a 32-bit hash → unsigned int seed for PRNG. */
export function hashSeed(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Mulberry32 PRNG returning [0, 1). */
export function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function sampleTrait(rng: () => number): number {
  let sum = 0;
  for (let i = 0; i < 4; i++) sum += rng();
  const raw = (sum / 4) * 100;
  return Math.round(Math.min(100, Math.max(0, raw)));
}

/**
 * Generate personality for a citizen. Uses `${masterSeed}:${citizenId}:personality-v1`
 * so independent citizens vary under the same demo seed without hardcoding names.
 */
export function generatePersonality(masterSeed: string, citizenId: string, at = new Date().toISOString()): PersonalityRecord {
  const material = `${masterSeed.trim()}:${citizenId}:personality-v1`;
  const rng = mulberry32(hashSeed(material));
  const traits = {} as PersonalityTraits;
  for (const axis of PERSONALITY_AXES) {
    traits[axis] = sampleTrait(rng);
  }
  return {
    seed: masterSeed.trim(),
    version: 1,
    generatedAt: at,
    traits,
  };
}

export function isPersonalityRecord(value: unknown): value is PersonalityRecord {
  if (!value || typeof value !== "object") return false;
  const rec = value as Record<string, unknown>;
  if (rec.version !== 1 || typeof rec.seed !== "string" || typeof rec.generatedAt !== "string") return false;
  if (!rec.traits || typeof rec.traits !== "object") return false;
  const traits = rec.traits as Record<string, unknown>;
  for (const axis of PERSONALITY_AXES) {
    const n = traits[axis];
    if (typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > 100) return false;
  }
  return true;
}

/** Concise neutral tendency text for cognition prompts — never imperative. */
export function formatPersonalityTendencies(traits: PersonalityTraits): string {
  const parts = PERSONALITY_AXES.map((axis) => `${AXIS_LABELS[axis]} ${traits[axis]}`);
  return `Personality tendencies (0–100, not commands): ${parts.join("; ")}. Prefer goals consistent with these leanings when multiple options are reasonable; do not treat high/low scores as hard rules.`;
}

export function parsePersonalityJson(raw: string | null | undefined): PersonalityRecord | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isPersonalityRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}
