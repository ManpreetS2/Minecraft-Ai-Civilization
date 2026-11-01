import { assertSessionId } from "./config.js";
import { deepClone, parseSnapshot } from "./snapshot.js";
import type { SessionSnapshot, SessionStore } from "./types.js";

export function createInMemorySessionStore(): SessionStore {
  const saved = new Map<string, SessionSnapshot>();
  return {
    async save(snapshot: SessionSnapshot): Promise<void> {
      assertSessionId(snapshot.sessionId);
      saved.set(snapshot.sessionId, deepClone(snapshot));
    },
    async load(sessionId: string): Promise<SessionSnapshot | undefined> {
      assertSessionId(sessionId);
      const found = saved.get(sessionId);
      return found === undefined ? undefined : parseSnapshot(deepClone(found));
    },
    async list(): Promise<readonly string[]> {
      return [...saved.keys()].sort();
    },
    async delete(sessionId: string): Promise<void> {
      assertSessionId(sessionId);
      saved.delete(sessionId);
    },
  };
}
