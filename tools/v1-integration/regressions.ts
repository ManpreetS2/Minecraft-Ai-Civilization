/** Independent QA reproduction: windows-backup PR #50, head f443bb386c1adfc5ce6f9d7c3d69de14c3a58aa1. */
export const chestRegressionContracts = [
  { id: 'former-owner', setup: 'Owner grants teammate; owner changes community; teammate updates chest observation.', assertion: 'Former owner cannot read or write the old community observation; current authorized teammate retains access.' },
  { id: 'former-grantee', setup: 'Owner grants teammate; grantee changes community.', assertion: 'Former grantee cannot read or write observations through stale membership; owner retains access.' },
  { id: 'failed-withdrawal', setup: 'Recorded positive stock followed by a physically observed empty chest and failed withdrawal.', assertion: 'Failure is not success and stale positive stock is invalidated or marked unknown; historical records remain.' },
] as const;
export interface ChestRegressionAdapter {
  /** Reset a disposable fixture: owner and grantee in north, rival in south, chest owned by owner. */
  reset(): Promise<void>;
  grant(actor: string, recipient: string): Promise<boolean>;
  changeCommunity(actor: string, community: 'north' | 'south'): Promise<void>;
  write(actor: string, count: number): Promise<boolean>;
  read(actor: string): Promise<number | undefined>;
  /** Simulate physical chest empty; return the executor's reported success. */
  withdrawFromEmpty(actor: string): Promise<boolean>;
}
export type RegressionResult = { id: string; verdict: 'PASS' | 'FAIL' | 'BLOCKED'; detail: string };
/** Adapter must use actual integrated store and executor for runtime evidence; doubles test this contract only. */
export async function runChestRegressions(adapter?: ChestRegressionAdapter): Promise<RegressionResult[]> {
  if (!adapter) return chestRegressionContracts.map(c => ({ id: c.id, verdict: 'BLOCKED', detail: 'Integrated chest/store/executor adapter unavailable' }));
  const cases: Array<[string, () => Promise<void>]> = [
    ['former-owner', async () => {
      requireCheck(await adapter.grant('owner', 'grantee'), 'legitimate grant refused');
      requireCheck(await adapter.write('grantee', 4), 'legitimate grantee write refused');
      await adapter.changeCommunity('owner', 'south');
      requireCheck(await adapter.write('grantee', 9), 'remaining grantee write refused');
      requireCheck(await adapter.read('owner') === undefined, 'former owner retained access');
      requireCheck(!(await adapter.write('owner', 99)), 'former owner retained write access');
      requireCheck(await adapter.read('grantee') === 9, 'legitimate grantee lost access');
    }],
    ['former-grantee', async () => {
      requireCheck(await adapter.grant('owner', 'grantee'), 'legitimate grant refused');
      requireCheck(await adapter.write('owner', 4), 'owner write refused');
      requireCheck(await adapter.read('grantee') === 4, 'legitimate grantee read refused');
      requireCheck(await adapter.read('rival') === undefined, 'ungranted rival read access');
      await adapter.changeCommunity('grantee', 'south');
      requireCheck(await adapter.read('grantee') === undefined, 'former grantee retained access');
      requireCheck(!(await adapter.write('grantee', 99)), 'former grantee retained write access');
      requireCheck(await adapter.read('owner') === 4, 'owner lost access');
    }],
    ['failed-withdrawal', async () => {
      requireCheck(await adapter.write('owner', 4), 'owner write refused');
      requireCheck(!(await adapter.withdrawFromEmpty('owner')), 'failed withdrawal reported success');
      const current = await adapter.read('owner');
      requireCheck(current === undefined || current === 0, 'stale positive stock treated as current');
    }],
  ];
  const result: RegressionResult[] = [];
  for (const [id, run] of cases) {
    try { await adapter.reset(); await run(); result.push({ id, verdict: 'PASS', detail: 'Adapter assertions satisfied' }); }
    catch (error) { result.push({ id, verdict: 'FAIL', detail: error instanceof Error ? error.message : String(error) }); }
  }
  return result;
}
function requireCheck(condition: boolean, detail: string): void { if (!condition) throw new Error(detail); }
