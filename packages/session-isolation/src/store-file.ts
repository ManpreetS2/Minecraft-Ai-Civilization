import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { assertSessionId, isValidSessionId } from "./config.js";
import { isSessionError, SessionError } from "./errors.js";
import { parseSnapshot } from "./snapshot.js";
import type { SessionSnapshot, SessionStore } from "./types.js";

function storeError(action: string, cause: unknown): SessionError {
  const message = cause instanceof Error ? cause.message : String(cause);
  return new SessionError("STORE_ERROR", `session store ${action} failed: ${message}`, { cause });
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "ENOENT";
}

/** One `<dir>/<sessionId>.json` per session. Writes go to a temp file, then rename (atomic on one filesystem). */
export function createJsonFileSessionStore(dir: string): SessionStore {
  const fileFor = (sessionId: string): string => {
    assertSessionId(sessionId); // rejects "../x" and "a/b" before any path is built
    return join(dir, `${sessionId}.json`);
  };
  return {
    async save(snapshot: SessionSnapshot): Promise<void> {
      const target = fileFor(snapshot.sessionId);
      const temp = join(dir, `${snapshot.sessionId}.${randomUUID()}.tmp`);
      try {
        await mkdir(dir, { recursive: true });
        await writeFile(temp, `${JSON.stringify(snapshot)}\n`, "utf8");
        await rename(temp, target);
      } catch (error) {
        await rm(temp, { force: true }).catch(() => undefined);
        throw storeError("save", error);
      }
    },
    async load(sessionId: string): Promise<SessionSnapshot | undefined> {
      const file = fileFor(sessionId);
      let text: string;
      try {
        text = await readFile(file, "utf8");
      } catch (error) {
        if (isMissing(error)) return undefined;
        throw storeError("load", error);
      }
      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch (error) {
        throw new SessionError("SNAPSHOT_CORRUPT", "persisted snapshot is not valid JSON", { sessionId, cause: error });
      }
      try {
        const parsed = parseSnapshot(raw);
        if (parsed.sessionId !== sessionId) {
          throw new SessionError("SNAPSHOT_CORRUPT", "persisted snapshot sessionId does not match its file", { sessionId });
        }
        return parsed;
      } catch (error) {
        throw isSessionError(error) ? error : storeError("load", error);
      }
    },
    async list(): Promise<readonly string[]> {
      try {
        const names = await readdir(dir);
        return names
          .filter((name) => name.endsWith(".json"))
          .map((name) => name.slice(0, -".json".length))
          .filter((id) => isValidSessionId(id))
          .sort();
      } catch (error) {
        if (isMissing(error)) return [];
        throw storeError("list", error);
      }
    },
    async delete(sessionId: string): Promise<void> {
      const file = fileFor(sessionId);
      try {
        await rm(file, { force: true });
      } catch (error) {
        throw storeError("delete", error);
      }
    },
  };
}
