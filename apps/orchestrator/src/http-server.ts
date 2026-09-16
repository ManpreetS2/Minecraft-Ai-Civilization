import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { extname, resolve } from "node:path";
import { WebSocketServer } from "ws";
import type { AgentManager } from "@civ/agent-core";
import {
  adaptDirective,
  buildObserverView,
  DirectiveBoard,
  loadConfig,
  workspaceRoot,
  type AppConfig,
  type HumanDirective,
} from "@civ/shared";
import { requestCitizenStop, requestDirectiveCancel, requestDirectiveFollow } from "./directive-apply.js";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".ico": "image/x-icon",
};

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "content-type",
};

export function startDashboardServer(manager: AgentManager, host: string, port: number): Promise<string> {
  const publicDir = resolve(workspaceRoot(), "apps/dashboard/public");
  const config = loadConfig();
  const board = new DirectiveBoard(config.HUMAN_DIRECTIVES_ENABLED);
  const startedAt = new Date();
  const enrich = () => enrichSnapshot(manager, board, config, startedAt);

  const server = createServer((req, res) => {
    void handle(req, res, manager, publicDir, board, enrich);
  });
  const wss = new WebSocketServer({ server, path: "/ws" });
  const unsubscribe = manager.events.on((event) => {
    const payload = JSON.stringify({ type: "event", event, snapshot: enrich() });
    for (const client of wss.clients) {
      if (client.readyState === 1) client.send(payload);
    }
  });

  server.on("close", () => unsubscribe());

  return new Promise((resolveReady) => {
    server.listen(port, host, () => {
      resolveReady(`http://127.0.0.1:${port}`);
    });
  });
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  manager: AgentManager,
  publicDir: string,
  board: DirectiveBoard,
  enrich: () => unknown,
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS);
    res.end();
    return;
  }

  if (url.pathname === "/api/snapshot") {
    json(res, enrich());
    return;
  }
  if (url.pathname === "/api/health") {
    json(res, { ok: true });
    return;
  }
  if (url.pathname === "/api/citizens") {
    json(res, manager.getSnapshot().citizens);
    return;
  }
  if (url.pathname === "/api/perf") {
    json(res, manager.getSnapshot().performance);
    return;
  }
  if (url.pathname === "/api/events") {
    json(res, manager.getSnapshot().events);
    return;
  }
  if (url.pathname === "/api/settlement") {
    json(res, manager.getSnapshot().settlement);
    return;
  }
  if (url.pathname === "/api/directives" && req.method === "GET") {
    json(res, listDirectives(manager, board));
    return;
  }
  if (url.pathname === "/api/directives" && req.method === "POST") {
    const body = await readJson(req);
    if (!body.ok) {
      json(res, { ok: false, error: body.error }, 400);
      return;
    }
    const issued = issueDirective(manager, board, body.value);
    if (!issued.ok) {
      json(res, issued, issued.status ?? 400);
      return;
    }
    json(res, { ok: true, directive: issued.directive, snapshot: enrich() });
    return;
  }

  const cancelMatch = url.pathname.match(/^\/api\/directives\/([^/]+)\/cancel$/);
  if (cancelMatch && req.method === "POST") {
    const cancelled = cancelDirective(manager, board, cancelMatch[1] ?? "");
    if (!cancelled.ok) {
      json(res, cancelled, cancelled.status ?? 404);
      return;
    }
    json(res, { ok: true, directive: cancelled.directive, snapshot: enrich() });
    return;
  }

  const stopMatch = url.pathname.match(/^\/api\/citizens\/([^/]+)\/stop$/);
  if (stopMatch && req.method === "POST") {
    const citizenId = decodeURIComponent(stopMatch[1] ?? "");
    const stopped = stopCitizen(manager, board, citizenId);
    if (!stopped.ok) {
      json(res, stopped, stopped.status ?? 404);
      return;
    }
    json(res, { ok: true, snapshot: enrich() });
    return;
  }

  let filePath = resolve(publicDir, url.pathname === "/" ? "index.html" : url.pathname.slice(1));
  if (!filePath.startsWith(publicDir) || !existsSync(filePath)) {
    filePath = resolve(publicDir, "index.html");
  }
  if (!existsSync(filePath)) {
    res.writeHead(404);
    res.end("dashboard missing");
    return;
  }
  const body = readFileSync(filePath);
  res.writeHead(200, { "content-type": MIME[extname(filePath)] ?? "application/octet-stream" });
  res.end(body);
}

function enrichSnapshot(manager: AgentManager, board: DirectiveBoard, config: AppConfig, startedAt: Date): unknown {
  const snapshot = manager.getSnapshot() as ReturnType<AgentManager["getSnapshot"]> & {
    runId?: string;
    permadeath?: boolean;
    humanDirectivesEnabled?: boolean;
    directives?: unknown[];
  };
  const observer = buildObserverView(snapshot, {
    directives: listDirectives(manager, board),
    directivesEnabled: snapshot.humanDirectivesEnabled ?? config.HUMAN_DIRECTIVES_ENABLED,
    runId: snapshot.runId || config.SIM_RUN_ID || `dev-${formatRunId(startedAt)}`,
    permanentDeath: snapshot.permadeath ?? config.SIM_PERMADEATH_ENABLED,
  });
  return {
    ...snapshot,
    presentedEvents: observer.presentedEvents,
    observer,
    directives: observer.directives,
    directivesEnabled: observer.directivesEnabled,
  };
}

type DirectiveHost = AgentManager & {
  issueDirective?: (input: { target: string; mode: string; instruction: string }) =>
    | { ok: true; directives: unknown[] }
    | { ok: false; reason?: string; error?: string; status?: number };
  cancelDirective?: (id: string) => unknown;
  stopCitizen?: (nameOrId: string) => { ok: boolean; reason?: string; status?: number };
  listDirectives?: () => unknown[];
};

function host(manager: AgentManager): DirectiveHost {
  return manager as DirectiveHost;
}

function listDirectives(manager: AgentManager, board: DirectiveBoard): HumanDirective[] {
  const runtime = host(manager);
  const raw = runtime.listDirectives?.() ?? (manager.getSnapshot() as { directives?: unknown[] }).directives ?? board.list();
  return raw.map((row) => adaptDirective(row)).filter((row): row is HumanDirective => Boolean(row));
}

function issueDirective(
  manager: AgentManager,
  board: DirectiveBoard,
  body: Record<string, unknown>,
): { ok: true; directive: HumanDirective } | { ok: false; error: string; status?: number } {
  const instruction = String(body.instruction ?? body.rawText ?? "");
  const mode = String(body.mode ?? "DIRECTIVE");
  const runtime = host(manager);
  if (runtime.issueDirective) {
    const target = String(body.target ?? (Array.isArray(body.targetIds) ? body.targetIds[0] : "everyone"));
    const result = runtime.issueDirective({ target, mode, instruction });
    if (!result.ok) return { ok: false, error: result.error ?? result.reason ?? "Directive rejected.", status: result.status };
    const directive = adaptDirective(result.directives[0] ?? result.directives.at?.(-1));
    if (!directive) return { ok: false, error: "Runtime accepted the directive but returned no record.", status: 500 };
    return { ok: true, directive };
  }
  const citizens = manager.list().map((c) => ({ id: c.record.id, name: c.record.name }));
  const created = board.create({
    rawText: instruction,
    mode,
    selectedIds: parseSelectedIds(body, citizens),
    citizens,
  });
  if (!created.ok) return created;
  requestDirectiveFollow(manager, created.directive);
  return created;
}

function cancelDirective(
  manager: AgentManager,
  board: DirectiveBoard,
  id: string,
): { ok: true; directive: HumanDirective } | { ok: false; error: string; status?: number } {
  const runtime = host(manager);
  if (runtime.cancelDirective) {
    const result = runtime.cancelDirective(id);
    const directive = adaptDirective(result);
    if (!directive) return { ok: false, error: "Directive not found.", status: 404 };
    return { ok: true, directive };
  }
  const cancelled = board.cancel(id);
  if (!cancelled.ok) return cancelled;
  requestDirectiveCancel(manager, cancelled.directive);
  return cancelled;
}

function stopCitizen(
  manager: AgentManager,
  board: DirectiveBoard,
  citizenId: string,
): { ok: true } | { ok: false; error: string; status?: number } {
  const runtime = host(manager);
  if (runtime.stopCitizen) {
    const result = runtime.stopCitizen(citizenId);
    if (!result.ok) return { ok: false, error: result.reason ?? "Citizen not found.", status: result.status ?? 404 };
    return { ok: true };
  }
  if (!requestCitizenStop(manager, citizenId)) return { ok: false, error: "Citizen not found.", status: 404 };
  board.cancelForCitizen(citizenId);
  return { ok: true };
}

function parseSelectedIds(
  body: Record<string, unknown>,
  citizens: Array<{ id: string; name: string }>,
): string[] {
  if (Array.isArray(body.targetIds)) return body.targetIds.map(String);
  const target = String(body.target ?? "");
  if (!target || /^(everyone|\*|all)$/i.test(target)) return [];
  const match = citizens.find(
    (c) => c.id === target || c.name.toLowerCase() === target.toLowerCase() || c.id === `citizen_${target.toLowerCase()}`,
  );
  return match ? [match.id] : [target];
}

function formatRunId(startedAt: Date): string {
  const iso = startedAt.toISOString().slice(0, 13).replace("T", "-");
  return iso;
}

async function readJson(req: IncomingMessage): Promise<{ ok: true; value: Record<string, unknown> } | { ok: false; error: string }> {
  const raw = await readBody(req, 8_192);
  if (!raw.trim()) return { ok: true, value: {} };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, error: "Expected a JSON object." };
    }
    return { ok: true, value: parsed as Record<string, unknown> };
  } catch {
    return { ok: false, error: "Invalid JSON." };
  }
}

function readBody(req: IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        req.destroy();
        resolve("");
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function json(res: ServerResponse, value: unknown, status = 200): void {
  res.writeHead(status, { "content-type": "application/json", ...CORS });
  res.end(JSON.stringify(value));
}
