import net from "node:net";

const AUTH = 3;
const EXEC = 2;

function encode(id: number, type: number, payload: string): Buffer {
  const body = Buffer.alloc(10 + Buffer.byteLength(payload));
  body.writeInt32LE(id, 0);
  body.writeInt32LE(type, 4);
  body.write(payload, 8, "utf8");
  const header = Buffer.alloc(4);
  header.writeInt32LE(body.length, 0);
  return Buffer.concat([header, body]);
}

export class RconClient {
  private socket: net.Socket;
  private buf = Buffer.alloc(0);
  private nextId = 1;
  private readonly waiters = new Map<number, { resolve: (text: string) => void; reject: (error: Error) => void }>();

  private constructor(socket: net.Socket) {
    this.socket = socket;
    socket.on("data", (chunk) => {
      this.buf = Buffer.concat([this.buf, chunk]);
      while (this.buf.length >= 4) {
        const size = this.buf.readInt32LE(0);
        if (size < 8 || this.buf.length < size + 4) break;
        const id = this.buf.readInt32LE(4);
        const payload = this.buf.subarray(12, 4 + size - 2).toString("utf8").replace(/\0+$/, "");
        this.buf = this.buf.subarray(4 + size);
        const waiter = this.waiters.get(id) ?? (id === -1 ? undefined : this.waiters.get(id));
        if (id === -1) {
          for (const pending of this.waiters.values()) pending.reject(new Error("RCON auth failed"));
          this.waiters.clear();
          continue;
        }
        if (waiter) {
          this.waiters.delete(id);
          waiter.resolve(payload);
        }
      }
    });
  }

  static connect(host: string, port: number, password: string, timeoutMs = 4000): Promise<RconClient> {
    return new Promise((resolve, reject) => {
      const socket = net.connect({ host, port });
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error(`RCON connect timed out ${host}:${port}`));
      }, timeoutMs);
      socket.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      socket.once("connect", () => {
        const client = new RconClient(socket);
        const id = client.nextId++;
        client.wait(id, timeoutMs).then(
          () => {
            clearTimeout(timer);
            resolve(client);
          },
          (error) => {
            clearTimeout(timer);
            socket.destroy();
            reject(error);
          },
        );
        socket.write(encode(id, AUTH, password));
      });
    });
  }

  async command(command: string, timeoutMs = 5000): Promise<string> {
    const id = this.nextId++;
    const pending = this.wait(id, timeoutMs);
    this.socket.write(encode(id, EXEC, command));
    return pending;
  }

  close(): void {
    this.socket.destroy();
  }

  private wait(id: number, timeoutMs: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(id);
        reject(new Error("RCON command timed out"));
      }, timeoutMs);
      this.waiters.set(id, {
        resolve: (text) => {
          clearTimeout(timer);
          resolve(text);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
    });
  }
}

export async function tryRcon(host: string, port: number, password: string): Promise<RconClient | undefined> {
  try {
    return await RconClient.connect(host, port, password);
  } catch {
    return undefined;
  }
}
