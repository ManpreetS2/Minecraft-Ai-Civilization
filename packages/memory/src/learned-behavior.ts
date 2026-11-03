import type { LearnedDimension, LearnedTendency } from "@civ/shared";

export type BehaviorEvidence = {
  dimension: LearnedDimension;
  /** +1 supportive of high end, -1 supportive of low end. */
  direction: -1 | 1;
  weight?: number;
  at: string; // ISO
};

const DIMENSIONS: LearnedDimension[] = [
  "help_tendency",
  "risk_tolerance",
  "persistence",
  "social_initiation",
  "solo_vs_coop",
  "resource_sharing",
  "familiar_location_bias",
];

export type LearnedBehaviorOptions = {
  now?: number;
  /** Half-life for evidence decay (default 3 days). */
  halfLifeMs?: number;
};

/**
 * Bounded learned-behavior summary from observed choices.
 * No permanent traits at init. One action ≠ permanent label.
 */
export function summarizeLearnedBehavior(
  evidence: BehaviorEvidence[],
  options: LearnedBehaviorOptions = {},
): LearnedTendency[] {
  const now = options.now ?? Date.now();
  const halfLife = options.halfLifeMs ?? 3 * 24 * 60 * 60 * 1000;
  const out: LearnedTendency[] = [];

  for (const dimension of DIMENSIONS) {
    const rows = evidence.filter((e) => e.dimension === dimension);
    if (rows.length === 0) {
      out.push({
        dimension,
        score: 0,
        confidence: 0,
        evidenceCount: 0,
        lastUpdatedAt: new Date(now).toISOString(),
      });
      continue;
    }

    let weighted = 0;
    let mass = 0;
    let last = 0;
    for (const row of rows) {
      const t = Date.parse(row.at);
      const age = Number.isFinite(t) ? Math.max(0, now - t) : 0;
      const decay = Math.exp(-age / halfLife);
      const w = (row.weight ?? 1) * decay;
      weighted += row.direction * w;
      mass += w;
      if (t > last) last = t;
    }

    const score = mass > 0 ? clamp(weighted / mass, -1, 1) : 0;
    // Confidence grows with effective evidence mass, never 1.0 from a single event.
    const confidence = clamp(1 - Math.exp(-mass / 3), 0, 0.95);
    out.push({
      dimension,
      score: round2(score),
      confidence: round2(confidence),
      evidenceCount: rows.length,
      lastUpdatedAt: new Date(last || now).toISOString(),
    });
  }
  return out;
}

export function applyContradictoryEvidence(
  evidence: BehaviorEvidence[],
  dimension: LearnedDimension,
  at: string,
): BehaviorEvidence[] {
  // Helper for tests / callers: flip direction of a new observation.
  return [...evidence, { dimension, direction: -1, at, weight: 1.2 }];
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
