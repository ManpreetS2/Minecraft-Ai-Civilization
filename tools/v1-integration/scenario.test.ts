import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createIndependentOfflineRuntime } from '../../apps/orchestrator/src/independent-offline-runtime.js';
import { buildFixture } from './fixtures.js';
import { runScenario } from './scenario.js';
describe('offline composition scenario', () => {
  it.each([2, 4] as const)('routes %i citizens through scripted models and preserves private memory after reopening disposable SQLite', async count => {
    const evidenceDirectory = mkdtempSync(join(tmpdir(), 'v1-evidence-'));
    const run = await runScenario({ count, goal: 'gather_wood', evidenceDirectory });
    expect(run.sourceSha).toMatch(/^[a-f0-9]{40}$/); expect(run.mode).toBe('offline-fixture');
    expect(new Set(run.citizens.map(c => c.id)).size).toBe(count);
    expect(run.providers.filter(p => p.family === 'gpt')).toHaveLength(count / 2);
    expect(run.providers.filter(p => p.family === 'claude')).toHaveLength(count / 2);
    for (const p of run.providers) { expect(p.requests).toBeGreaterThan(0); expect(p.sessionId).toBeTruthy(); expect(p.model).toBeTruthy(); expect(p.requests).toBeLessThanOrEqual(3); expect(p.ownMemorySeen).toBe(true); expect(p.leakedMemoryIds).toEqual([]); expect(run.inventoryBefore[p.citizenId]).toBe(0); expect(run.inventoryAfter[p.citizenId]).toBeGreaterThan(0); }
    expect(new Set(run.providers.map(p => p.sessionId)).size).toBe(count); expect(run.restart.citizens).toEqual(run.citizens); expect(run.restart.memoryPreserved).toBe(true); expect(run.unproven).toContain('session persistence across process restart');
    expect(run.decisionTransport).toBe('scripted-in-process');
    expect(run.evidenceSummary.attempted).toBe(count * 3);
    expect(run.evidenceSummary.verified).toBe(count * 3);
    expect(run.actions).toHaveLength(count * 3);
    expect(run.actions.every(a => a.decisionTransport === 'scripted-in-process' && a.originPosition !== null && a.observedSuccess === true)).toBe(true);
    expect(run.actions.every(a => a.decisionSource !== 'model' && a.expectedDelta.oak_log === 1 && a.inventoryDelta?.oak_log === 1)).toBe(true);
    expect(run.actions.some(a => a.decisionSource === 'scripted')).toBe(true);
    for (const citizen of run.citizens) {
      const own = run.actions.filter(a => a.citizenId === citizen.id);
      expect(own).toHaveLength(3);
      expect(new Set(own.map(a => a.attemptId)).size).toBe(3);
      expect(new Set(own.map(a => a.eventId)).size).toBe(3);
      expect(own.reduce((sum, a) => sum + (a.inventoryDelta?.oak_log ?? 0), 0)).toBe(run.inventoryAfter[citizen.id]);
    }
    const rows = readFileSync(run.evidenceJournalPath!, 'utf8').trim().split('\n').map(line => JSON.parse(line) as { kind: string; attemptId?: string; decisionEventId?: string; decisionSource?: string; decisionTransport?: string });
    expect(rows[0]?.decisionTransport).toBe('scripted-in-process');
    const firstAttempt = rows.findIndex(row => row.kind === 'action_attempt');
    const lastTick = rows.map(row => row.kind).lastIndexOf('tick');
    expect(firstAttempt).toBeGreaterThan(rows.findIndex(row => row.kind === 'tick'));
    expect(firstAttempt).toBeLessThan(lastTick);
    for (const action of run.actions) {
      const attempt = rows.find(row => row.kind === 'action_attempt' && row.attemptId === action.attemptId);
      const observation = rows.find(row => row.kind === 'action_observation' && row.attemptId === action.attemptId);
      expect(attempt?.decisionEventId).toBe(action.eventId);
      expect(attempt?.decisionSource).not.toBe('model');
      expect(rows.indexOf(observation!)).toBeGreaterThan(rows.indexOf(attempt!));
    }
    rmSync(evidenceDirectory, { recursive: true, force: true });
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

