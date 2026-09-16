import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { extname, resolve } from "node:path";
import { WebSocketServer } from "ws";
import type { AgentManager } from "@civ/agent-core";
import { workspaceRoot } from "@civ/shared";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".ico": "image/x-icon",
};

export function startDashboardServer(manager: AgentManager, host: string, port: number): Promise<string> {
  const publicDir = resolve(workspaceRoot(), "apps/dashboard/public");

  const server = createServer((req, res) => {
    void handle(req, res, manager, publicDir);
  });
  const wss = new WebSocketServer({ server, path: "/ws" });
  const unsubscribe = manager.events.on((event) => {
    const payload = JSON.stringify({ type: "event", event, snapshot: manager.getSnapshot() });
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
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (url.pathname === "/api/snapshot") {
    json(res, manager.getSnapshot());
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

function json(res: ServerResponse, value: unknown): void {
  res.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*" });
  res.end(JSON.stringify(value));
}
