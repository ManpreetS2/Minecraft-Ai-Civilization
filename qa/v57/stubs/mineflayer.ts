// QA stub: replaces the real `mineflayer` package for EVERY importer under this config, so no test here can open a socket.
type Factory = (options: unknown) => unknown;
const slot = globalThis as unknown as { __qaCreateBot?: Factory };
const createBot: Factory = (options) => {
  if (!slot.__qaCreateBot) throw new Error("QA stub: createBot called without a test-provided factory (refusing to touch the network)");
  return slot.__qaCreateBot(options);
};
export default { createBot };
export { createBot };
