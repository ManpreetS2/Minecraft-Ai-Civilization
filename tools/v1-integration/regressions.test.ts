import { describe, expect, it } from 'vitest';
import { runChestRegressions, type ChestRegressionAdapter } from './regressions.js';
/** A controlled contract double, not a runtime implementation. */
function fake(defect?: 'former-owner' | 'former-grantee' | 'failed-withdrawal'): ChestRegressionAdapter {
  let communities: Record<string, string> = {}; let grant = false; let stock: number | undefined;
  const allowed = (actor: string) => actor === 'owner' ? communities.owner === 'north' || defect === 'former-owner' : actor === 'grantee' && grant && (communities.grantee === 'north' || defect === 'former-grantee');
  return {
    async reset() { communities = { owner: 'north', grantee: 'north', rival: 'south' }; grant = false; stock = undefined; },
    async grant(actor, recipient) { if (actor !== 'owner' || recipient !== 'grantee') return false; grant = true; return true; },
    async changeCommunity(actor, community) { communities[actor] = community; },
    async write(actor, count) { if (!allowed(actor)) return false; stock = count; return true; },
    async read(actor) { return allowed(actor) ? stock : undefined; },
    async withdrawFromEmpty() { if (defect !== 'failed-withdrawal') stock = 0; return false; },
  };
}
describe('chest regression adapter contract, using controlled doubles', () => {
  it('marks unavailable integrated adapter BLOCKED', async () => { expect((await runChestRegressions()).every(r => r.verdict === 'BLOCKED')).toBe(true); });
  it('accepts legitimate access and all fixed behavior in the double', async () => { expect((await runChestRegressions(fake())).every(r => r.verdict === 'PASS')).toBe(true); });
  it.each(['former-owner', 'former-grantee', 'failed-withdrawal'] as const)('detects %s', async defect => {
    const results = await runChestRegressions(fake(defect));
    expect(results.find(r => r.id === defect)?.verdict).toBe('FAIL');
  });
});
