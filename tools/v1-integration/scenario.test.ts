import { describe, expect, it, vi } from 'vitest';
import { createIndependentOfflineRuntime } from '../../apps/orchestrator/src/independent-offline-runtime.js';
import { buildFixture } from './fixtures.js';
import { runScenario } from './scenario.js';
describe('offline composition scenario', () => {
  it.each([2, 4] as const)('routes %i citizens through scripted models and preserves private memory after reopening disposable SQLite', async count => {
    const run = await runScenario({ count, goal: 'gather_wood' });
    expect(run.sourceSha).toMatch(/^[a-f0-9]{40}$/); expect(run.mode).toBe('offline-fixture');
    expect(new Set(run.citizens.map(c => c.id)).size).toBe(count);
    expect(run.providers.filter(p => p.family === 'gpt')).toHaveLength(count / 2);
    expect(run.providers.filter(p => p.family === 'claude')).toHaveLength(count / 2);
    for (const p of run.providers) { expect(p.requests).toBeGreaterThan(0); expect(p.sessionId).toBeTruthy(); expect(p.model).toBeTruthy(); expect(p.requests).toBeLessThanOrEqual(3); expect(p.ownMemorySeen).toBe(true); expect(p.leakedMemoryIds).toEqual([]); expect(run.inventoryBefore[p.citizenId]).toBe(0); expect(run.inventoryAfter[p.citizenId]).toBeGreaterThan(0); }
    expect(new Set(run.providers.map(p => p.sessionId)).size).toBe(count); expect(run.restart.citizens).toEqual(run.citizens); expect(run.restart.memoryPreserved).toBe(true); expect(run.unproven).toContain('session persistence across process restart');
    expect(run.decisionTransport).toBe('scripted-in-process');
    expect(run.evidenceSummary.attempted).toBe(count);
    expect(run.evidenceSummary.verified).toBe(count);
    expect(run.actions).toHaveLength(count);
    expect(run.actions.every(a => a.decisionTransport === 'scripted-in-process' && a.originPosition !== null && a.observedSuccess === true)).toBe(true);
    expect(run.evidenceJournalSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(run.unproven).toContain('Paper serverGameTick');
  }, 60_000);
  it('refuses injected body, network and database options before startup', async () => {
    for (const injected of [{ createBody: () => { throw Error('called'); } }, { host: 'example.com', port: 25565 }, { databasePath: 'production.sqlite' }, { transport: 'real' }]) await expect(runScenario({ count: 2, goal: 'observe', ...injected } as never)).rejects.toThrow(/Only count, scripted goal/);
  });
  it('exposes the lower composition root createBody trust boundary without network access', async () => {
    const fx = buildFixture(2, 'observe'); const callback = vi.fn(fx.args.createBody); const network = vi.spyOn(globalThis, 'fetch');
    let root: ReturnType<typeof createIndependentOfflineRuntime> | undefined;
    try { root = createIndependentOfflineRuntime({ ...fx.args, createBody: callback }); await root.manager.start(undefined, { deferTicks: true }); expect(callback).toHaveBeenCalledTimes(2); expect(network).not.toHaveBeenCalled(); }
    finally { if (root) await root.manager.stop(); await fx.manager.stop(); if (fx.store.isOpen()) fx.store.close(); fx.restoreNavigation(); fx.cleanup(); network.mockRestore(); }
  }, 30_000);
});

