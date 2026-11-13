 
// Round 5 / Mission 1: malformed signed input must never crash the validator and never yield VERIFIED / clean acceptance.
// Hostile lines are built as TEXT, with a correct hash for the exact bytes, so only the validator's own parse/bind path is exercised.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { liveJournal } from "../../v94/lib/live.js";
import { ROSTER } from "../../v94/lib/rich.js";
import { adaptRecorderJournal, validateExperimentEvidence } from "../../../experiments/evidence-validator/src/index.js";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const chain = (bodies: string[]): string[] => { // bodies are '{...' without closing brace; previousHash is chained by hand
  let prev = ""; return bodies.map((b, i) => { const body = b.replace("@PREV@", prev).replace("@SEQ@", String(i + 1)); const h = sha(`${body}}`); prev = h; return `${body},"hash":"${h}"}`; });
};
const START = `{"experimentId":"exp-m","seq":@SEQ@,"at":"2026-11-05T12:00:00.000Z","previousHash":"@PREV@","kind":"start","recordingAudience":"operator_only","mode":"offline"`;
const tick = (extra = "") => `{"experimentId":"exp-m","seq":@SEQ@,"at":"2026-11-05T12:00:01.000Z","previousHash":"@PREV@","kind":"tick"${extra}`;
function go(lines: unknown, rows?: unknown) {
  let adapted: ReturnType<typeof adaptRecorderJournal> | undefined;
  let res: ReturnType<typeof validateExperimentEvidence> | undefined;
  const t = Date.now();
  expect(() => { adapted = adaptRecorderJournal(lines as never); }).not.toThrow();
  expect(() => { res = validateExperimentEvidence({ rawJournalLines: lines as never, journalRows: (rows ?? adapted!.journalRows) as never }); }).not.toThrow();
  expect(Date.now() - t).toBeLessThan(5_000);
  return res!;
}
const notVerified = (r: ReturnType<typeof go>) => { expect(r.overallStatus).not.toBe("VERIFIED"); expect(r.summary.verifiedActions).toBe(0); };

describe("malformed signed input: no crash, no acceptance", () => {
  const hostile: Array<[string, string[]]> = [
    ["not JSON at all", ["not json"]],
    ["empty line", [""]],
    ["JSON null / number / string / array rows", ["null", "123", '"x"', "[]", "[1,2]"]],
    ["truncated row", ['{"experimentId":"exp-m","seq":1,"kind":"sta']],
    ["kind is not a string", chain([START.replace('"kind":"start"', '"kind":42'), tick()])],
    ["kind is empty string", chain([START.replace('"kind":"start"', '"kind":""')])],
    ["unknown row kind, correct hash", chain([START, tick().replace('"kind":"tick"', '"kind":"future_kind"')])],
    ["seq is a string / negative / float / 1e999", chain([START.replace("@SEQ@", '"one"'), tick().replace("@SEQ@", "-5"), tick().replace("@SEQ@", "1.5"), tick().replace("@SEQ@", "1e999")])],
    ["duplicate keys (kind twice)", chain([START, tick().replace('"kind":"tick"', '"kind":"tick","kind":"start"')])],
    ["__proto__ / constructor / prototype keys as signed metadata", chain([START + ',"__proto__":{"polluted":true},"constructor":{"prototype":{"p":1}}', tick(',"prototype":1')])],
    ["BOM prefix", ["ï»¿" + chain([START])[0]!]],
    ["lone surrogates and NULs in strings", chain([START + ',"note":"\\ud800\\u0000"', tick(',"x":"\\udfff"')])],
    ["10 000 sibling unknown keys (as text)", chain([START + "," + Array.from({ length: 10_000 }, (_, i) => `"k${i}":${i}`).join(",")])],
    ["20 000-deep array metadata (as text)", chain([START + `,"d":${"[".repeat(20000)}1${"]".repeat(20000)}`])],
    ["20 000-deep OBJECT metadata (as text)", chain([START + `,"d":${'{"a":'.repeat(20000)}1${"}".repeat(20000)}`])],
    ["2 MB single string", chain([START + `,"big":"${"a".repeat(2_000_000)}"`])],
    ["hash is wrong / missing / non-string", [chain([START])[0]!.replace(/"hash":"[0-9a-f]{64}"/, '"hash":"00"'), chain([START])[0]!.replace(/,"hash":"[0-9a-f]{64}"/, ""), chain([START])[0]!.replace(/"hash":"[0-9a-f]{64}"/, '"hash":7')]],
  ];
  for (const [name, lines] of hostile) it(`${name}: never throws, never VERIFIED`, () => notVerified(go(lines)));

  it("non-array / null / non-string rawJournalLines are rejected without throwing", () => {
    for (const bad of [null, undefined, 5, "x", {}, [null], [5], [{}]]) {
      let r: unknown; expect(() => { r = validateExperimentEvidence({ rawJournalLines: bad as never, journalRows: [] as never }); }).not.toThrow(); expect((r as { overallStatus: string } | undefined)?.overallStatus).not.toBe("VERIFIED");
    }
  });
  it("caller rows that disagree with the signed raw lines (extra, missing, reordered, null, wrong type) are never accepted", () => {
    const lines = chain([START, tick(), tick()]); const a = adaptRecorderJournal(lines).journalRows as unknown[];
    for (const rows of [[], [...a, a[0]], a.slice(0, 1), [a[2], a[1], a[0]], [null, ...a], [5, ...a], "x", null, undefined, [...a].reverse()]) {
      const r = go(lines, rows); expect(r.overallStatus).not.toBe("VERIFIED");
    }
  });
  it("positive control: a realistic well-formed journal (QA builder, real tick fields) has no schema violation and no crash", () => {
    const l = liveJournal({ citizens: ROSTER }); const r = go(l.lines);
    expect(r.violations.filter((v) => v.code === "RAW_JOURNAL_SCHEMA_VIOLATION" || v.code === "RAW_JOURNAL_RESOURCE_LIMIT")).toEqual([]);
  });
});
