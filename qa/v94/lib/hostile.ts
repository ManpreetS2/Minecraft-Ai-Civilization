import { richLive } from "./rich.js";
import { attest, paramsFor, validateLive, digestOf, type Live } from "./live.js";
import { clone, reseal, type Row } from "./journal.js";
import { RICH_FINALS, ROSTER } from "./rich.js";
export { richLive, RICH_FINALS, ROSTER };
/** Rebuild a signed journal (rows resealed, attestation recomputed over the NEW raw lines) after editing RAW rows; parsed rows = the edited raw rows, so the binding passes. */
export function resign(l: Live, edit: (rows: Row[]) => void): Live & { rows: Row[] } {
  const rows = clone(l.rows) as Row[]; edit(rows); const s = reseal(rows);
  return { ...l, rows: s.rows, lines: s.lines } as Live & { rows: Row[] };
}
export function validateSigned(l: Live, extra: Record<string, unknown> = {}) {
  return validateLive(l, attest(paramsFor(l, { evidenceDigest: digestOf(l.lines) })), { finalInventories: RICH_FINALS, citizens: ROSTER, ...extra });
}
