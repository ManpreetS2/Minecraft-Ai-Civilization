import dgram from "node:dgram";
import dns from "node:dns";
import net from "node:net";

/**
 * Test-time guard against real network traffic. It patches the Node entry points that HTTP, HTTPS, TLS, HTTP/2,
 * fetch (undici) and WebSocket reach through (`net.Socket.prototype.connect`), plus UDP sends and DNS lookups.
 * It is not a process-level sandbox: native addons, child processes and code that captured an unpatched reference
 * before installation can bypass it. Each blocked attempt is recorded and thrown, and `assertNoBlockedAttempts`
 * (run after every test) fails the test even if the caller swallowed the error.
 */

export type BlockedAttempt = { transport: string; target: string };

const blocked: BlockedAttempt[] = [];
let installed = false;

export class OfflineNetworkGuardError extends Error {
  constructor(attempt: BlockedAttempt) {
    super(`offline test guard blocked ${attempt.transport} to ${attempt.target}`);
    this.name = "OfflineNetworkGuardError";
  }
}

export function blockedAttempts(): readonly BlockedAttempt[] {
  return blocked;
}

export function clearBlockedAttempts(): void {
  blocked.length = 0;
}

/** Throws if anything was blocked since the last clear, then clears so one attempt fails exactly one test. */
export function assertNoBlockedAttempts(): void {
  if (blocked.length === 0) return;
  const summary = blocked.map((a) => `${a.transport} -> ${a.target}`).join("; ");
  clearBlockedAttempts();
  throw new Error(`offline test guard: blocked non-loopback network attempt(s): ${summary}`);
}

export function isLoopbackHost(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  const mapped = h.startsWith("::ffff:") ? h.slice(7) : h;
  if (net.isIPv4(mapped)) return mapped.split(".")[0] === "127";
  return h === "::1" || h === "0:0:0:0:0:0:0:1";
}

function block(transport: string, target: string): never {
  const attempt = { transport, target };
  blocked.push(attempt);
  throw new OfflineNetworkGuardError(attempt);
}

/** Returns the host a `Socket.connect` call targets, "ipc" for a path, or undefined if the arguments are unreadable. */
function connectTarget(args: unknown[]): string | undefined {
  // net.connect and friends hand Socket#connect an already-normalized `[options, callback]` array.
  const [first, second] = Array.isArray(args[0]) ? (args[0] as unknown[]) : args;
  if (typeof first === "number" || (typeof first === "string" && /^\d+$/.test(first))) {
    return typeof second === "string" ? second : "localhost";
  }
  if (typeof first === "string") return "ipc";
  if (first && typeof first === "object") {
    const o = first as { path?: unknown; host?: unknown; hostname?: unknown };
    if (typeof o.path === "string") return "ipc";
    const host = o.host ?? o.hostname;
    if (host === undefined || host === null) return "localhost";
    return typeof host === "string" ? host : undefined;
  }
  return undefined;
}

function connectedAddress(socket: dgram.Socket): string | undefined {
  try {
    return socket.remoteAddress().address;
  } catch {
    return undefined;
  }
}

function hostOfUrlLike(input: unknown): string | undefined {
  try {
    if (typeof input === "string" || input instanceof URL) return new URL(input).hostname;
    if (input && typeof input === "object" && "url" in input) return new URL(String((input as { url: unknown }).url)).hostname;
  } catch {
    return undefined;
  }
  return undefined;
}

export function installOfflineNetworkGuard(): void {
  if (installed) return;
  installed = true;

  const originalConnect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function patchedConnect(this: net.Socket, ...args: unknown[]) {
    const target = connectTarget(args);
    if (target !== "ipc" && (target === undefined || !isLoopbackHost(target))) {
      block("socket connect", target ?? "unreadable connect arguments");
    }
    return (originalConnect as (...a: unknown[]) => net.Socket).apply(this, args);
  } as typeof net.Socket.prototype.connect;

  // sendto on an unconnected UDP socket has no connect step, so check each send.
  const originalSend = dgram.Socket.prototype.send as (...a: unknown[]) => void;
  dgram.Socket.prototype.send = function patchedSend(this: dgram.Socket, ...args: unknown[]) {
    // send(msg, [offset, length,] [port [, address]] [, callback]): the address is the first string after the message.
    const address = args.slice(1).find((a): a is string => typeof a === "string");
    const target = address ?? connectedAddress(this);
    if (target === undefined || !isLoopbackHost(target)) block("udp send", target ?? "unconnected socket");
    return originalSend.apply(this, args);
  } as typeof dgram.Socket.prototype.send;
  const originalDgramConnect = dgram.Socket.prototype.connect as (...a: unknown[]) => void;
  dgram.Socket.prototype.connect = function patchedDgramConnect(this: dgram.Socket, ...args: unknown[]) {
    const address = typeof args[1] === "string" ? args[1] : "localhost";
    if (!isLoopbackHost(address)) block("udp connect", address);
    return originalDgramConnect.apply(this, args);
  } as typeof dgram.Socket.prototype.connect;

  const originalLookup = dns.lookup as (...a: unknown[]) => unknown;
  (dns as { lookup: unknown }).lookup = function patchedLookup(hostname: unknown, ...rest: unknown[]) {
    if (typeof hostname === "string" && hostname !== "" && !net.isIP(hostname) && !isLoopbackHost(hostname)) {
      block("dns lookup", hostname);
    }
    return originalLookup(hostname, ...rest);
  };
  const originalPromiseLookup = dns.promises.lookup as (...a: unknown[]) => Promise<unknown>;
  (dns.promises as { lookup: unknown }).lookup = async function patchedPromiseLookup(hostname: unknown, ...rest: unknown[]) {
    if (typeof hostname === "string" && hostname !== "" && !net.isIP(hostname) && !isLoopbackHost(hostname)) {
      block("dns lookup", hostname);
    }
    return originalPromiseLookup(hostname, ...rest);
  };
  for (const method of ["resolve", "resolve4", "resolve6", "resolveAny", "resolveMx", "resolveTxt", "resolveSrv"] as const) {
    const original = (dns as unknown as Record<string, (...a: unknown[]) => unknown>)[method];
    if (typeof original !== "function") continue;
    (dns as unknown as Record<string, unknown>)[method] = (hostname: unknown, ...rest: unknown[]) => {
      if (typeof hostname !== "string" || !isLoopbackHost(hostname)) block(`dns ${method}`, String(hostname));
      return original(hostname, ...rest);
    };
  }

  // fetch is checked up front for a clear message. Its sockets would also be caught by the connect patch.
  const originalFetch = globalThis.fetch;
  if (typeof originalFetch === "function") {
    globalThis.fetch = async function patchedFetch(input: Parameters<typeof fetch>[0], init?: RequestInit) {
      const host = hostOfUrlLike(input);
      if (host === undefined || !isLoopbackHost(host)) block("fetch", host ?? "unreadable URL");
      return originalFetch(input, init);
    } as typeof fetch;
  }
}
