/**
 * SEC-001: the server-side contract for directed speech.
 *
 * Mineflayer's bot.whisper() sends `/tell <name> <text>`. Whether that command exists for this player is decided by the
 * server, so it is read from the `declare_commands` packet rather than assumed: the server sends each player a command
 * tree, and the root's literal children are the commands the server chose to offer that player.
 */
export const WHISPER_COMMAND = "tell";

export const VALID_USERNAME = /^[A-Za-z0-9_]{1,16}$/;

const LITERAL_NODE = 1;

type CommandNode = {
  flags?: { command_node_type?: unknown };
  children?: unknown;
  extraNodeData?: { name?: unknown } | null;
};

/** Root command names from a `declare_commands` packet; undefined when the packet cannot be read (fails closed). */
export function declaredRootCommands(packet: unknown): ReadonlySet<string> | undefined {
  if (!packet || typeof packet !== "object") return undefined;
  const { nodes, rootIndex } = packet as { nodes?: unknown; rootIndex?: unknown };
  if (!Array.isArray(nodes) || typeof rootIndex !== "number") return undefined;
  const root = nodes[rootIndex] as CommandNode | undefined;
  if (!root || !Array.isArray(root.children)) return undefined;
  const names = new Set<string>();
  for (const index of root.children) {
    const node = typeof index === "number" ? (nodes[index] as CommandNode | undefined) : undefined;
    const name = node?.extraNodeData?.name;
    if (node?.flags?.command_node_type === LITERAL_NODE && typeof name === "string") names.add(name);
  }
  return names;
}

/**
 * Text is an argument of /tell. Control characters cannot be sent, and the message argument expands entity selectors
 * for a sender with permission (citizens have been opped on the dev world), so `@a` must not reach the parser.
 */
export function sanitizeWhisperText(message: string): string {
  return message
    .replace(/\p{Cc}+/gu, " ")
    .replace(/@(?=[a-z]\b|[a-z]\[)/g, "@ ")
    .trim()
    .slice(0, 200);
}
