import net from "node:net";
import { spawn } from "node:child_process";
import { createEvent, workspaceRoot, type AppConfig, type EventBus } from "@civ/shared";

export async function ensurePaper(config: AppConfig, events?: EventBus): Promise<boolean> {
  if (await portOpen(config.MINECRAFT_HOST, config.MINECRAFT_PORT)) {
    events?.emit(createEvent("PaperServerReady", { alreadyRunning: true }));
    return true;
  }
  if (!config.AUTO_START_PAPER) {
    return false;
  }
  const cwd = `${workspaceRoot()}/server`;
  const child = spawn("java", ["-Xms4G", "-Xmx4G", "-jar", "paper.jar", "--nogui"], {
    cwd,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (await portOpen(config.MINECRAFT_HOST, config.MINECRAFT_PORT)) {
      events?.emit(createEvent("PaperServerReady", { started: true, pid: child.pid }));
      return true;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}

export function portOpen(host: string, port: number, timeoutMs = 1500): Promise<boolean> {
  return new Promise((resolvePort) => {
    const socket = net.connect({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      resolvePort(false);
    }, timeoutMs);
    socket.on("connect", () => {
      clearTimeout(timer);
      socket.end();
      resolvePort(true);
    });
    socket.on("error", () => {
      clearTimeout(timer);
      resolvePort(false);
    });
  });
}
