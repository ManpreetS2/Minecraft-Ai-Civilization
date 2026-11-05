import { createHash } from "node:crypto";
import type { HashChainAudit } from "./types.js";

export function verifyHashChain(lines: readonly string[]): HashChainAudit {
  if (lines.length === 0) {
    return {
      valid: false,
      totalRows: 0,
      error: "Hash chain is empty (no records to verify)",
    };
  }

  let priorHash = "";

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i]!.trim();
    if (!rawLine) continue;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(rawLine) as Record<string, unknown>;
    } catch {
      return {
        valid: false,
        totalRows: lines.length,
        brokenSeq: i + 1,
        error: `Row ${i + 1} contains invalid JSON`,
      };
    }

    const expectedSeq = i + 1;
    if (parsed.seq !== expectedSeq) {
      return {
        valid: false,
        totalRows: lines.length,
        brokenSeq: expectedSeq,
        error: `Row ${expectedSeq} sequence mismatch: expected ${expectedSeq}, got ${String(parsed.seq)}`,
      };
    }

    if (parsed.previousHash !== priorHash) {
      return {
        valid: false,
        totalRows: lines.length,
        brokenSeq: expectedSeq,
        error: `Row ${expectedSeq} previousHash mismatch: expected '${priorHash}', got '${String(parsed.previousHash)}'`,
      };
    }

    const { hash, ...withoutHash } = parsed;
    const computedHash = createHash("sha256")
      .update(JSON.stringify(withoutHash))
      .digest("hex");

    if (hash !== computedHash) {
      return {
        valid: false,
        totalRows: lines.length,
        brokenSeq: expectedSeq,
        error: `Row ${expectedSeq} hash tampering detected: recorded '${String(hash)}' != computed '${computedHash}'`,
      };
    }

    priorHash = String(hash);
  }

  return {
    valid: true,
    totalRows: lines.length,
  };
}
