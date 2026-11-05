import { execFileSync } from 'node:child_process';
import { CivilizationStore } from '../../packages/agent-core/src/index.js';
import { createEvent } from '../../packages/shared/src/index.js';
import { createIndependentOfflineRuntime } from '../../apps/orchestrator/src/independent-offline-runtime.js';
import { buildFixture } from './fixtures.js';

export interface ScenarioInput { count: 2 | 4; goal: 'observe' | 'gather_wood'; }
/** Controlled fake-world exercise; this records simulated outcomes, not live Minecraft evidence. */
export async function runScenario(input: ScenarioInput) {
  if (!input || ![2, 4].includes(input.count) || !['observe', 'gather_wood'].includes(input.goal) || Object.keys(input).some(k => !['count', 'goal'].includes(k))) throw new Error('Only count and scripted goal fixture data are accepted');
  const sourceSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const fixture = buildFixture(input.count, input.goal);
  let restarted: ReturnType<typeof createIndependentOfflineRuntime> | undefined;
  let reopened: CivilizationStore | undefined;
  try {
    await fixture.manager.start(undefined, { deferTicks: true });
    const citizens = fixture.manager.list().map(c => ({ id: c.record.id, username: c.record.minecraftUsername }));
    for (const c of citizens) {
      const secret = `PRIVATE-${c.id}`;
      const event = createEvent('TaskCompleted', { summary: secret, visibility: { class: 'actor_private' } }, c.id);
      fixture.manager.events.emit(event);
      fixture.store.addMemory({ id: `memory-${c.id}`, citizenId: c.id, kind: 'episodic', content: secret, importance: 1, createdAt: new Date().toISOString() }, { sourceEventId: event.id });
    }
    const before = Object.fromEntries([...fixture.bodies].map(([id, body]) => [id, body.count('oak_log')]));
    for (let step = 0; step < 3; step++) {
      await Promise.all(fixture.manager.list().map(c => fixture.manager['tickCitizen'](c, fixture.store.getSettlement(), [], undefined)));
      const deadline = Date.now() + 20_000;
      while (fixture.manager.pendingOps() > 0) {
        if (Date.now() > deadline) throw new Error('offline scenario pending work did not settle');
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }
    const after = Object.fromEntries([...fixture.bodies].map(([id, body]) => [id, body.count('oak_log')]));
    const routing = fixture.assignments.map(a => {
      const calls = a.family === 'gpt' ? fixture.openai.calls.filter(call => call.apiKey === `synthetic-${a.credential.env}`).map(call => call.body) : (fixture.claude.get(a.citizenId)?.calls ?? []).map(call => JSON.stringify(call));
      const evidence = fixture.registry.evidenceLog().filter(e => e.citizenId === a.citizenId);
      return { citizenId: a.citizenId, family: a.family, model: evidence[0]?.model ?? null, sessionId: evidence[0]?.sessionId ?? null, requests: calls.length, ownMemorySeen: calls.some(call => call.includes(`PRIVATE-${a.citizenId}`)), leakedMemoryIds: citizens.filter(other => other.id !== a.citizenId && calls.some(call => call.includes(`PRIVATE-${other.id}`))).map(other => other.id) };
    });
    await fixture.manager.stop(); await fixture.manager.stop();
    reopened = new CivilizationStore(fixture.databasePath);
    restarted = createIndependentOfflineRuntime({ ...fixture.args, store: reopened });
    await restarted.manager.start(undefined, { deferTicks: true });
    const restart = { citizens: restarted.manager.list().map(c => ({ id: c.record.id, username: c.record.minecraftUsername })), memoryPreserved: citizens.every(c => reopened!.getMemories(c.id).some(m => m.content === `PRIVATE-${c.id}`)), storage: 'reopened disposable SQLite database; in-memory session store' };
    return { sourceSha, mode: 'offline-fixture' as const, citizens, providers: routing, inventoryBefore: before, inventoryAfter: after, restart, unproven: ['real model decisions', 'session persistence across process restart', 'respawn', 'live Minecraft'] };
  } finally { if (restarted) await restarted.manager.stop(); await fixture.manager.stop(); if (fixture.store.isOpen()) fixture.store.close(); if (reopened?.isOpen()) reopened.close(); fixture.restoreNavigation(); fixture.cleanup(); }
}
