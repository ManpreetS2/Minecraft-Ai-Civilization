import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export type VerificationClass = 'offline' | 'live' | 'both';
export type Status = 'NOT_IMPLEMENTED' | 'IMPLEMENTED_UNVERIFIED' | 'OFFLINE_PASS' | 'LIVE_PASS' | 'BLOCKED';
export interface Criterion {
  id: string; sourceSection: string; description: string; verification: VerificationClass;
  procedure: string; status: Status; testedRepository: string | null; sourceSha: string | null;
  evidenceReference: string | null; testCommand: string | null; exitResult: number | null;
  review: string | null; blocker: string | null; milestone: 'Gate A' | 'Gate B';
}
export interface Evidence {
  criterionId: string; repository: string; sourceSha: string; command: string; exitCode: number;
  mode: 'offline-fixture' | 'isolated-live' | 'public-live'; artifactPath: string; sha256: string;
  reviewer: string; reviewStatus: 'approved' | 'pending' | 'rejected';
  liveValidation?: { artifactPath: string; sha256: string };
}
export interface Artifact {
  criterionId: string; repository: string; sourceSha: string; command: string; exitCode: number;
  mode: Evidence['mode']; outcome: 'PASS' | 'FAIL' | 'NOT_PROVEN';
  assertions: Array<{ name: string; passed: boolean }>;
}
export interface Catalog { criteria: Criterion[]; denominatorReviewed: boolean; offlineDenominatorReviewed?: boolean; liveDenominatorReviewed?: boolean; }
export interface EvaluationInput { catalog: Catalog; evidence: Evidence[]; repository: string; candidateSha: string; trustedReviewers: string[]; }
const sha = /^[a-f0-9]{40}$/;
const digest = /^[a-f0-9]{64}$/;

/** Artifact hashes detect changes, not fabricated artifacts. A trusted independent reviewer is required. */
export function validateEvidence(e: Evidence, c: Criterion, input: EvaluationInput, kind: 'offline' | 'live'): string[] {
  const errors: string[] = [];
  if (!sha.test(e.sourceSha) || !sha.test(input.candidateSha) || e.sourceSha !== input.candidateSha) errors.push('source SHA does not match integrated candidate');
  if (!e.repository || e.repository !== input.repository) errors.push('repository mismatch');
  if (e.criterionId !== c.id) errors.push('criterion mismatch');
  if (!e.command.trim() || e.exitCode !== 0) errors.push('executable check or successful exit missing');
  if (kind === 'live' && e.mode !== 'isolated-live' && e.mode !== 'public-live') errors.push('simulation or unknown mode cannot establish live acceptance');
  if (kind === 'live' && c.id === 'B-DURATION' && e.mode !== 'public-live') errors.push('public duration requires public-live evidence');
  if (kind === 'offline' && e.mode !== 'offline-fixture') errors.push('offline acceptance requires offline fixture evidence');
  if (e.reviewStatus !== 'approved' || !e.reviewer || !input.trustedReviewers.includes(e.reviewer)) errors.push('trusted independent review missing');
  if (!digest.test(e.sha256)) errors.push('artifact digest invalid');
  try {
    const bytes = readFileSync(e.artifactPath);
    if (createHash('sha256').update(bytes).digest('hex') !== e.sha256) errors.push('artifact digest mismatch');
    const a = JSON.parse(bytes.toString('utf8')) as Partial<Artifact>;
    if (a.criterionId !== e.criterionId || a.repository !== e.repository || a.sourceSha !== e.sourceSha || a.command !== e.command || a.exitCode !== e.exitCode || a.mode !== e.mode) errors.push('artifact provenance mismatch');
    if (a.outcome !== 'PASS' || !Array.isArray(a.assertions) || a.assertions.length === 0 || !a.assertions.every(x => typeof x?.name === 'string' && x.name.trim() && x.passed === true)) errors.push('structured passing assertions missing');
  } catch { errors.push('artifact unavailable or invalid'); }
  if (kind === 'live') {
    try {
      if (!e.liveValidation || !digest.test(e.liveValidation.sha256)) throw new Error('missing live validation');
      const bytes = readFileSync(e.liveValidation.artifactPath);
      if (createHash('sha256').update(bytes).digest('hex') !== e.liveValidation.sha256) throw new Error('validator digest mismatch');
      const validation = JSON.parse(bytes.toString('utf8'));
      if (validation.repository !== e.repository || validation.sourceSha !== e.sourceSha || validation.mode !== e.mode || validation.simulated !== false || validation.verdict !== 'PASS' || validation.reviewer !== e.reviewer || !Array.isArray(validation.criterionIds) || !validation.criterionIds.includes(c.id) || validation.evidenceSha256 !== e.sha256) throw new Error('validator provenance mismatch');
    } catch { errors.push('independently reviewed live validator artifact missing or invalid'); }
  }
  return errors;
}
export function evaluate(input: EvaluationInput) {
  const ids = input.catalog.criteria.map(c => c.id);
  const catalogValid = ids.length > 0 && new Set(ids).size === ids.length && input.catalog.criteria.every(c => c.id.trim() && c.sourceSection.trim() && c.description.trim() && c.procedure.trim());
  const results = input.catalog.criteria.map(c => {
    const check = (kind: 'offline' | 'live') => {
      const candidates = input.evidence.filter(e => e.criterionId === c.id);
      const failures = candidates.map(e => validateEvidence(e, c, input, kind));
      const acceptedIndex = failures.findIndex(f => f.length === 0);
      return { verdict: acceptedIndex >= 0 ? 'PASS' : candidates.length ? 'FAIL' : 'NOT PROVEN', evidenceReference: acceptedIndex >= 0 ? candidates[acceptedIndex]!.artifactPath : null, reasons: acceptedIndex >= 0 ? [] : candidates.length ? failures.flat() : ['evidence missing'] };
    };
    return { criterion: c, offline: c.verification !== 'live' ? check('offline') : null, live: c.verification !== 'offline' ? check('live') : null };
  });
  const progress = (kind: 'offline' | 'live') => {
    const relevant = results.filter(r => r[kind] !== null);
    const passed = relevant.filter(r => r[kind]?.verdict === 'PASS').length;
    const reviewed = kind === 'offline' ? input.catalog.offlineDenominatorReviewed : input.catalog.liveDenominatorReviewed;
    const measurable = (reviewed ?? input.catalog.denominatorReviewed) && catalogValid && relevant.length > 0;
    return { passed, total: relevant.length, percentage: measurable ? 100 * passed / relevant.length : null, measurement: measurable ? 'MEASURABLE' : 'NOT MEASURABLE' };
  };
  const milestones = (['Gate A', 'Gate B'] as const).map(gate => {
    const relevant = results.filter(r => r.criterion.milestone === gate && r.live !== null);
    const passed = relevant.filter(r => r.live?.verdict === 'PASS').length;
    return { gate, passed, total: relevant.length, accepted: (input.catalog.liveDenominatorReviewed ?? input.catalog.denominatorReviewed) && catalogValid && relevant.length > 0 && passed === relevant.length };
  });
  return { repository: input.repository, candidateSha: input.candidateSha, catalogValid, offline: progress('offline'), live: progress('live'), milestones, milestoneCount: { passed: milestones.filter(m => m.accepted).length, total: 2 }, results };
}
export function markdown(result: ReturnType<typeof evaluate>): string {
  const progress = (name: string, p: typeof result.offline) => `- ${name}: ${p.passed}/${p.total}; ${p.percentage === null ? 'NOT MEASURABLE' : `${p.percentage.toFixed(1)}%`}`;
  return [`# V1 acceptance`, `Candidate: ${result.repository} @ ${result.candidateSha}`, '', progress('Offline', result.offline), progress('Live', result.live), `- Milestones: ${result.milestoneCount.passed}/2`, ...result.milestones.map(m => `- ${m.gate}: ${m.passed}/${m.total} live criteria`), '', ...result.results.map(r => `- ${r.criterion.id}: offline ${r.offline?.verdict ?? 'N/A'}, live ${r.live?.verdict ?? 'N/A'}; evidence ${r.offline?.evidenceReference ?? r.live?.evidenceReference ?? 'missing'}; blocker ${r.criterion.blocker ?? 'none recorded'}; ${[...(r.offline?.reasons ?? []), ...(r.live?.reasons ?? [])].join('; ')}`)].join('\n') + '\n';
}

