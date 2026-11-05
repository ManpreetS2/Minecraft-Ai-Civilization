import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { evaluate, markdown } from './engine.js';
import type { Criterion, Evidence, EvaluationInput } from './engine.js';
const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
const sha = 'a'.repeat(40);
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'v1-acceptance-')); dirs.push(dir);
  const c: Criterion = { id: 'A', milestone: 'Gate A', sourceSection: 'Gate A', description: 'Isolation', verification: 'both', procedure: 'Run check', status: 'IMPLEMENTED_UNVERIFIED', testedRepository: null, sourceSha: null, evidenceReference: null, testCommand: null, exitResult: null, review: null, blocker: null };
  const e: Evidence = { criterionId: 'A', repository: 'repo', sourceSha: sha, command: 'pnpm test', exitCode: 0, mode: 'offline-fixture', artifactPath: join(dir, 'result.json'), sha256: '', reviewer: 'qa', reviewStatus: 'approved' };
  const write = (overrides: Record<string, unknown> = {}) => { const bytes = JSON.stringify({ criterionId: e.criterionId, repository: e.repository, sourceSha: e.sourceSha, command: e.command, exitCode: e.exitCode, mode: e.mode, outcome: 'PASS', assertions: [{ name: 'isolation', passed: true }], ...overrides }); writeFileSync(e.artifactPath, bytes); e.sha256 = createHash('sha256').update(bytes).digest('hex'); };
  write();
  const input: EvaluationInput = { catalog: { criteria: [c], denominatorReviewed: true }, evidence: [e], repository: 'repo', candidateSha: sha, trustedReviewers: ['qa'] };
  return { input, e, write };
}
describe('acceptance provenance', () => {
  it('rejects fabricated PASS without structured assertions', () => { const f = fixture(); f.write({ assertions: [] }); expect(evaluate(f.input).offline.passed).toBe(0); });
  it('rejects missing evidence and artifact', () => { const f = fixture(); f.input.evidence = []; expect(evaluate(f.input).results[0]?.offline?.verdict).toBe('NOT PROVEN'); f.input.evidence = [f.e]; f.e.artifactPath += '.missing'; expect(evaluate(f.input).offline.passed).toBe(0); });
  it('rejects wrong SHA and independent branch evidence', () => { const f = fixture(); f.e.sourceSha = 'b'.repeat(40); f.write(); expect(evaluate(f.input).offline.passed).toBe(0); f.e.sourceSha = 'bad'; expect(evaluate(f.input).offline.passed).toBe(0); });
  it('rejects simulated live evidence', () => { const f = fixture(); expect(evaluate(f.input).live.passed).toBe(0); });
  it('does not measure an unreviewed denominator', () => { const f = fixture(); f.input.catalog.denominatorReviewed = false; expect(evaluate(f.input).offline.percentage).toBeNull(); expect(markdown(evaluate(f.input))).toContain('NOT MEASURABLE'); });
  it('accepts matching reviewed artifact and changes progress only with accepted evidence', () => { const f = fixture(); expect(evaluate(f.input).offline.passed).toBe(1); f.e.reviewStatus = 'pending'; expect(evaluate(f.input).offline.passed).toBe(0); f.e.reviewStatus = 'approved'; expect(evaluate(f.input).offline.percentage).toBe(100); });
  it('rejects tampered artifacts and untrusted reviewers', () => { const f = fixture(); writeFileSync(f.e.artifactPath, '{}'); expect(evaluate(f.input).offline.passed).toBe(0); f.write(); f.e.reviewer = 'untrusted'; expect(evaluate(f.input).offline.passed).toBe(0); });
  it('accepts live evidence only across the independent validator trust boundary', () => {
    const f = fixture(); f.e.mode = 'isolated-live'; f.write();
    expect(evaluate(f.input).live.passed).toBe(0);
    const path = f.e.artifactPath + '.validator';
    const bytes = JSON.stringify({ repository: f.e.repository, sourceSha: sha, mode: f.e.mode, simulated: false, verdict: 'PASS', reviewer: 'qa', criterionIds: ['A'], evidenceSha256: f.e.sha256 });
    writeFileSync(path, bytes); f.e.liveValidation = { artifactPath: path, sha256: createHash('sha256').update(bytes).digest('hex') };
    expect(evaluate(f.input).live.passed).toBe(1); expect(evaluate(f.input).offline.passed).toBe(0);
    f.e.liveValidation.sha256 = '0'.repeat(64); expect(evaluate(f.input).live.passed).toBe(0);
  });
  it('keeps denominator review separate and counts completed gates', () => {
    const f = fixture(); f.input.catalog.offlineDenominatorReviewed = true; f.input.catalog.liveDenominatorReviewed = false;
    const result = evaluate(f.input);
    expect(result.offline.measurement).toBe('MEASURABLE'); expect(result.live.measurement).toBe('NOT MEASURABLE');
    expect(result.milestoneCount).toEqual({ passed: 0, total: 2 });
    expect(markdown(result)).toContain(f.e.artifactPath);
  });
});
